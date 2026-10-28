import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import { Pool } from "pg";

const schema = `forum_test_${randomUUID().replaceAll("-", "")}`;
const control = new Pool({ connectionString: process.env.DATABASE_URL });
const connection = new URL(process.env.DATABASE_URL);
connection.searchParams.set("options", `-c search_path=${schema},public`);
process.env.DATABASE_URL = connection.toString();
const { pool, query, runMigrations } = await import("../src/db.ts");
const { registerSetupRoutes } = await import("../src/routes/setup.ts");
const { registerAuthRoutes } = await import("../src/routes/auth.ts");
const { registerAdminRoutes } = await import("../src/routes/admin.ts");
const { registerForumRoutes } = await import("../src/routes/forum.ts");
const { registerReviewRoutes } = await import("../src/routes/reviews.ts");
const { registerNotificationRoutes } =
  await import("../src/routes/notifications.ts");
const { registerMediaRoutes } = await import("../src/routes/media.ts");
const { purgeExpiredPosts } = await import("../src/posts.ts");
const app = Fastify();
const password = randomUUID();
let owner,
  member,
  reviewer,
  other,
  category,
  secondCategory,
  uploadRoot,
  normalGroup;
const headers = (user) =>
  user ? { authorization: `Bearer ${user.token}` } : {};
const request = (method, url, payload, user = owner) =>
  app.inject({ method, url, payload, headers: headers(user) });
const content = (text = "测试正文") => ({
  blocks: [{ type: "paragraph", data: { text } }],
});
const post = (user = member, categoryId = category.id, body = content()) =>
  request(
    "POST",
    "/api/posts",
    { title: "审核测试帖子", categoryId, body },
    user,
  );
async function register(username) {
  const result = await request(
    "POST",
    "/api/auth/register",
    {
      username,
      email: `${username}@example.test`,
      displayName: username,
      password,
    },
    null,
  );
  assert.equal(result.statusCode, 201, result.body);
  return result.json();
}
async function specialPermissions(permissions, user = member) {
  await query(
    "DELETE FROM group_memberships WHERE user_uid = $1 AND group_id IN (SELECT id FROM user_groups WHERE name = '审核特例组')",
    [user.user.uid],
  );
  await query("DELETE FROM user_groups WHERE name = '审核特例组'");
  const group = (
    await request("POST", "/api/admin/groups", {
      name: "审核特例组",
      groupType: "special",
      permissions,
    })
  ).json();
  await request("POST", `/api/admin/groups/${group.id}/memberships`, {
    userUid: user.user.uid,
  });
}
before(async () => {
  await control.query(`CREATE SCHEMA ${schema}`);
  await runMigrations();
  uploadRoot = await mkdtemp(join(tmpdir(), "forum-review-"));
  await app.register(jwt, { secret: randomUUID() });
  await app.register(multipart);
  await registerSetupRoutes(app);
  await registerAuthRoutes(app);
  await registerAdminRoutes(app);
  await registerForumRoutes(app);
  await registerReviewRoutes(app);
  await registerNotificationRoutes(app);
  await registerMediaRoutes(app, uploadRoot);
  owner = (
    await request(
      "POST",
      "/api/setup/initialize",
      {
        username: "owner",
        email: "owner@example.test",
        displayName: "管理员",
        password,
      },
      null,
    )
  ).json();
  member = await register("member");
  reviewer = await register("reviewer");
  other = await register("other");
  const categories = (await request("GET", "/api/categories")).json();
  category = categories[0];
  secondCategory = categories[1];
  const groups = (await request("GET", "/api/admin/groups")).json();
  normalGroup = groups.find((g) => g.is_default);
  const reviewGroup = (
    await request("POST", "/api/admin/groups", {
      name: "审核员组",
      groupType: "special",
      permissions: ["posts.review"],
    })
  ).json();
  await request("POST", `/api/admin/groups/${reviewGroup.id}/memberships`, {
    userUid: reviewer.user.uid,
  });
});
after(async () => {
  await app.close();
  await pool.end();
  await control.query(`DROP SCHEMA ${schema} CASCADE`);
  await control.end();
  if (uploadRoot) await rm(uploadRoot, { recursive: true, force: true });
});

test("review precedence: global, category, bypass, mandatory, conflicting and expired groups", async () => {
  assert.equal((await post()).json().post.status, "published");
  assert.equal(
    (
      await request("PATCH", `/api/admin/categories/${category.id}`, {
        requiresReview: true,
      })
    ).statusCode,
    200,
  );
  assert.equal((await post()).json().post.status, "pending");
  assert.equal(
    (await post(member, secondCategory.id)).json().post.status,
    "published",
  );
  await specialPermissions(["posts.bypass_review"]);
  assert.equal((await post()).json().post.status, "published");
  await request("PATCH", "/api/admin/review-settings", { requireReview: true });
  assert.equal(
    (await post(member, secondCategory.id)).json().post.status,
    "published",
  );
  await specialPermissions(["posts.require_review"]);
  assert.equal(
    (await post(member, secondCategory.id)).json().post.status,
    "pending",
  );
  await specialPermissions(["posts.bypass_review", "posts.require_review"]);
  assert.equal((await post()).json().post.status, "pending");
  await query(
    "UPDATE group_memberships SET expires_at = NOW() - INTERVAL '1 day' WHERE user_uid = $1 AND group_id IN (SELECT id FROM user_groups WHERE name = '审核特例组')",
    [member.user.uid],
  );
  await request("PATCH", "/api/admin/review-settings", {
    requireReview: false,
  });
  assert.equal(
    (await post(member, secondCategory.id)).json().post.status,
    "published",
  );
  assert.equal(
    (
      await request(
        "PATCH",
        "/api/admin/review-settings",
        { requireReview: true },
        reviewer,
      )
    ).statusCode,
    403,
  );
  await runMigrations();
  assert.equal(
    (await request("GET", "/api/admin/review-settings")).json()
      .posts_require_review,
    false,
  );
});

test("pending privacy, reviewer metadata and approval cannot be bypassed by post managers", async () => {
  const created = (await post()).json().post;
  assert.equal(created.status, "pending");
  assert.equal(
    (await request("GET", `/api/posts/${created.id}`, undefined, null))
      .statusCode,
    404,
  );
  assert.equal(
    (await request("GET", `/api/posts/${created.id}`, undefined, other))
      .statusCode,
    404,
  );
  assert.equal(
    (await request("GET", `/api/posts/${created.id}`, undefined, member))
      .statusCode,
    200,
  );
  assert.equal(
    (
      await request(
        "GET",
        `/api/admin/reviews/${created.id}`,
        undefined,
        member,
      )
    ).statusCode,
    403,
  );
  const detail = await request(
    "GET",
    `/api/admin/reviews/${created.id}`,
    undefined,
    reviewer,
  );
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().author_ip, "127.0.0.1");
  assert.ok(detail.json().groups.includes(normalGroup.name));
  assert.deepEqual(detail.json().body, content());
  for (const status of ["published", "hidden"])
    assert.equal(
      (await request("PATCH", `/api/admin/posts/${created.id}`, { status }))
        .statusCode,
      409,
    );
  const decision = await request(
    "POST",
    `/api/admin/reviews/${created.id}/decision`,
    { action: "approve" },
    reviewer,
  );
  assert.equal(decision.statusCode, 200, decision.body);
  const published = await request(
    "GET",
    `/api/posts/${created.id}`,
    undefined,
    null,
  );
  assert.equal(published.statusCode, 200);
  assert.equal(published.json().post.author_ip, undefined);
  assert.equal(
    (
      await request(
        "POST",
        `/api/admin/reviews/${created.id}/decision`,
        { action: "reject", reason: "重复" },
        reviewer,
      )
    ).statusCode,
    409,
  );
});

test("hidden posts disappear from every list but remain readable by URL with replies and likes", async () => {
  const created = (await post(member, secondCategory.id)).json().post;
  await request("PATCH", `/api/admin/posts/${created.id}`, {
    status: "hidden",
  });
  for (const url of [
    "/api/posts",
    "/api/posts?sort=popular",
    `/api/posts?category=${secondCategory.id}`,
    "/api/posts?q=审核测试",
  ]) {
    assert.ok(
      !(await request("GET", url, undefined, null))
        .json()
        .some((p) => p.id === created.id),
      url,
    );
  }
  assert.equal(
    (await request("GET", `/api/posts/${created.id}`, undefined, null))
      .statusCode,
    200,
  );
  assert.equal(
    (
      await request(
        "POST",
        `/api/posts/${created.id}/replies`,
        { body: content() },
        other,
      )
    ).statusCode,
    201,
  );
  assert.equal(
    (
      await request("POST", `/api/posts/${created.id}/like`, undefined, other)
    ).json().liked,
    true,
  );
});

test("admin deletion stays outside author trash and only administrators can restore the original status", async () => {
  const created = (await post(member, secondCategory.id)).json().post;
  await request("PATCH", `/api/admin/posts/${created.id}`, {
    status: "hidden",
  });
  assert.equal(
    (
      await request(
        "DELETE",
        `/api/admin/posts/${created.id}`,
        undefined,
        member,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (await request("DELETE", `/api/admin/posts/${created.id}`)).statusCode,
    200,
  );
  assert.equal(
    (await request("GET", `/api/posts/${created.id}`, undefined, member))
      .statusCode,
    404,
  );
  assert.ok(
    !(await request("GET", "/api/me/trash", undefined, member))
      .json()
      .some((p) => p.id === created.id),
  );
  assert.equal(
    (await request("GET", `/api/me/trash/${created.id}`, undefined, member))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await request(
        "POST",
        `/api/me/trash/${created.id}/restore`,
        undefined,
        member,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await request(
        "POST",
        `/api/admin/deleted-posts/${created.id}/restore`,
        undefined,
        member,
      )
    ).statusCode,
    403,
  );
  await purgeExpiredPosts();
  assert.ok(
    (await request("GET", "/api/admin/deleted-posts"))
      .json()
      .some((p) => p.id === created.id),
  );
  const restored = await request(
    "POST",
    `/api/admin/deleted-posts/${created.id}/restore`,
  );
  assert.equal(restored.json().status, "hidden");
  assert.equal(
    (await request("GET", `/api/posts/${created.id}`, undefined, null))
      .statusCode,
    200,
  );
  await request("DELETE", `/api/me/posts/${created.id}`, undefined, member);
  assert.ok(
    (await request("GET", "/api/me/trash", undefined, member))
      .json()
      .some((p) => p.id === created.id),
  );
});

test("announcements target all users, groups or one user and read state is private", async () => {
  assert.equal(
    (
      await request(
        "POST",
        "/api/admin/notifications",
        { title: "越权", body: "内容", audience: { type: "all" } },
        member,
      )
    ).statusCode,
    403,
  );
  const sent = await request("POST", "/api/admin/notifications", {
    title: "社区公告",
    body: "第一行\n第二行",
    audience: { type: "group", id: normalGroup.id },
  });
  assert.equal(sent.statusCode, 201, sent.body);
  assert.equal(sent.json().recipientCount, 4);
  const id = sent.json().id;
  assert.equal(
    (
      await request("GET", "/api/me/notifications/unread", undefined, member)
    ).json().count,
    1,
  );
  assert.equal(
    (await request("POST", `/api/me/notifications/${id}/read`, undefined, null))
      .statusCode,
    401,
  );
  await request("POST", `/api/me/notifications/${id}/read`, undefined, member);
  assert.equal(
    (
      await request("GET", "/api/me/notifications/unread", undefined, member)
    ).json().count,
    0,
  );
  assert.equal(
    (
      await request("GET", "/api/me/notifications/unread", undefined, other)
    ).json().count,
    1,
  );
  const personal = await request("POST", "/api/admin/notifications", {
    title: "个人通知",
    body: "你好",
    audience: { type: "user", id: member.user.uid },
  });
  assert.equal(personal.json().recipientCount, 1);
  assert.equal(
    (
      await request(
        "POST",
        `/api/me/notifications/${personal.json().id}/read`,
        undefined,
        owner,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await request("POST", "/api/admin/notifications", {
        title: "全站通知",
        body: "你好",
        audience: { type: "all" },
      })
    ).json().recipientCount,
    4,
  );
  await request("POST", "/api/me/notifications/read-all", undefined, member);
  assert.equal(
    (
      await request("GET", "/api/me/notifications/unread", undefined, member)
    ).json().count,
    0,
  );
});

test("rejection and account bans notify the author atomically; duplicate decisions do not notify twice", async () => {
  const rejected = (await post()).json().post;
  assert.equal(
    (
      await request(
        "POST",
        `/api/admin/reviews/${rejected.id}/decision`,
        { action: "reject" },
        reviewer,
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await request(
        "POST",
        `/api/admin/reviews/${rejected.id}/decision`,
        { action: "reject", reason: "请补充来源" },
        reviewer,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (await request("GET", `/api/posts/${rejected.id}`, undefined, null))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await request("GET", `/api/posts/${rejected.id}`, undefined, member)
    ).json().post.status,
    "rejected",
  );
  const notices = (
    await request("GET", "/api/me/notifications", undefined, member)
  ).json();
  assert.ok(
    notices.some(
      (n) => n.post_id === rejected.id && n.body.includes("请补充来源"),
    ),
  );
  const banned = (await post()).json().post;
  const banResponse = await request(
    "POST",
    `/api/admin/reviews/${banned.id}/decision`,
    { action: "ban", reason: "违规内容", banMinutes: 30 },
    reviewer,
  );
  assert.equal(banResponse.statusCode, 200, banResponse.body);
  assert.equal(
    (await request("GET", "/api/auth/me", undefined, member)).statusCode,
    401,
  );
  const banNotice = await query(
    "SELECT n.body FROM notifications n JOIN notification_recipients r ON r.notification_id = n.id WHERE n.post_id = $1 AND r.user_uid = $2",
    [banned.id, member.user.uid],
  );
  assert.equal(banNotice.rowCount, 1);
  assert.match(banNotice.rows[0].body, /违规内容/);
  assert.equal(
    (
      await request(
        "POST",
        `/api/admin/reviews/${banned.id}/decision`,
        { action: "ban", reason: "重复", banMinutes: 30 },
        reviewer,
      )
    ).statusCode,
    409,
  );
  await query("UPDATE users SET banned_until = NULL WHERE uid = $1", [
    member.user.uid,
  ]);
  await query("UPDATE posts SET status = 'pending' WHERE id = $1", [banned.id]);
  await query("UPDATE posts SET author_uid = $2 WHERE id = $1", [
    banned.id,
    owner.user.uid,
  ]);
  assert.equal(
    (
      await request(
        "POST",
        `/api/admin/reviews/${banned.id}/decision`,
        { action: "ban", reason: "保护管理员", banMinutes: 30 },
        reviewer,
      )
    ).statusCode,
    409,
  );
});

test("deleting one or several author images replaces only their references and preserves avatar protection", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWioAAAAASUVORK5CYII=",
    "base64",
  );
  async function upload() {
    const boundary = "forum-review-boundary";
    const result = await app.inject({
      method: "POST",
      url: "/api/me/media",
      headers: {
        ...headers(member),
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n`,
        ),
        png,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    assert.equal(result.statusCode, 201, result.body);
    return result.json();
  }
  const first = await upload(),
    second = await upload(),
    third = await upload();
  const image = (url) => ({
    type: "image",
    data: { file: { url }, caption: "原图片说明" },
  });
  const created = (
    await post(member, secondCategory.id, {
      blocks: [
        {
          ...image(first.url),
          data: { file: { url: first.url }, caption: first.url },
        },
        image(`http://localhost:5173${second.url}`),
        image(third.url),
      ],
    })
  ).json().post;
  const reply = await request(
    "POST",
    `/api/posts/${created.id}/replies`,
    { body: { blocks: [image(first.url)] } },
    other,
  );
  assert.equal(reply.statusCode, 201);
  assert.equal(
    (await request("DELETE", `/api/me/media/${first.id}`, undefined, other))
      .statusCode,
    404,
  );
  await request("DELETE", `/api/me/media/${first.id}`, undefined, member);
  let detail = (
    await request("GET", `/api/posts/${created.id}`, undefined, null)
  ).json();
  assert.equal(detail.post.body.blocks[0].data.file.url, "/deleted-image.png");
  assert.equal(
    detail.post.body.blocks[1].data.file.url,
    `http://localhost:5173${second.url}`,
  );
  assert.equal(detail.post.body.blocks[0].data.caption, first.url);
  assert.equal(
    detail.replies[0].body.blocks[0].data.file.url,
    "/deleted-image.png",
  );
  await request("DELETE", `/api/me/media/${second.id}`, undefined, member);
  detail = (
    await request("GET", `/api/posts/${created.id}`, undefined, null)
  ).json();
  assert.equal(detail.post.body.blocks[1].data.file.url, "/deleted-image.png");
  assert.equal(detail.post.body.blocks[2].data.file.url, third.url);
  await query("UPDATE users SET avatar_url = $2 WHERE uid = $1", [
    member.user.uid,
    third.url,
  ]);
  assert.equal(
    (await request("DELETE", `/api/me/media/${third.id}`, undefined, member))
      .statusCode,
    409,
  );
});
