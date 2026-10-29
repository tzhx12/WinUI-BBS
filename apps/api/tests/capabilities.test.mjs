import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import { Pool } from "pg";
const schema = `forum_test_${randomUUID().replaceAll("-", "")}`;
const control = new Pool({ connectionString: process.env.DATABASE_URL });
const url = new URL(process.env.DATABASE_URL);
url.searchParams.set("options", `-c search_path=${schema},public`);
process.env.DATABASE_URL = url.toString();
const { pool, query, runMigrations } = await import("../src/db.ts");
const { registerSetupRoutes } = await import("../src/routes/setup.ts");
const { registerAuthRoutes } = await import("../src/routes/auth.ts");
const { registerAdminRoutes } = await import("../src/routes/admin.ts");
const { registerForumRoutes } = await import("../src/routes/forum.ts");
const { registerInvitationRoutes } =
  await import("../src/routes/invitations.ts");
const { registerMediaRoutes } = await import("../src/routes/media.ts");
const app = Fastify(),
  remote = Fastify(),
  password = randomUUID();
let admin,
  member,
  other,
  uploadRoot,
  remoteBase,
  detailCalls = 0,
  imageCalls = 0;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWioAAAAASUVORK5CYII=",
  "base64",
);
const gif = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);
const headers = (user) => ({ authorization: `Bearer ${user.token}` });
async function request(method, url, body, user = admin) {
  return app.inject({ method, url, headers: headers(user), payload: body });
}
async function register(name, code) {
  return app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      username: name,
      email: `${name}@example.test`,
      displayName: name,
      password,
      invitationCode: code,
    },
  });
}
async function upload(
  user,
  collection = "library",
  packId = "",
  buffer = png,
  endpoint,
  mimeType = "image/png",
) {
  const boundary = "forum-test-boundary";
  return app.inject({
    method: "POST",
    url:
      endpoint ||
      `/api/me/media?collection=${collection}${packId ? `&packId=${packId}` : ""}`,
    headers: {
      ...headers(user),
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: ${mimeType}\r\n\r\n`,
      ),
      buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
}
const setLimits = async (limits, remoteConfig) => {
  const current = (await request("GET", "/api/admin/media-settings")).json();
  return request("PATCH", "/api/admin/media-settings", {
    mediaLimits: { ...current.media_limits, ...limits },
    remoteEmoji: remoteConfig || current.remote_emoji,
  });
};
before(async () => {
  await control.query(`CREATE SCHEMA ${schema}`);
  await runMigrations();
  await query("UPDATE app_settings SET setting_value=jsonb_set(setting_value, '{directLibraryUploads}', 'true'::jsonb) WHERE setting_key='content_limits'");
  uploadRoot = await mkdtemp(join(tmpdir(), "forum-media-"));
  await app.register(jwt, { secret: randomUUID() });
  await app.register(multipart, {
    limits: { fileSize: 100 * 1024 ** 2, files: 1 },
  });
  await registerSetupRoutes(app);
  await registerAuthRoutes(app);
  await registerAdminRoutes(app);
  await registerForumRoutes(app, uploadRoot);
  await registerInvitationRoutes(app);
  await registerMediaRoutes(app, uploadRoot);
  admin = (
    await app.inject({
      method: "POST",
      url: "/api/setup/initialize",
      payload: {
        username: "owner",
        email: "owner@example.test",
        displayName: "管理员",
        password,
      },
    })
  ).json();
  member = (await register("member")).json();
  other = (await register("other")).json();
  remote.get("/list", async () => ({
    data: {
      all_packages: [
        {
          id: 1,
          text: "测试表情",
          type: 3,
          url: `${remoteBase}/image.png`,
          UrlType: -1,
        },
      ],
    },
  }));
  remote.get("/info", async () => {
    detailCalls++;
    return {
      id: 1,
      text: "测试表情",
      emote: [
        {
          text: "开心",
          type: 3,
          url: `${remoteBase}/image.png`,
          gif_url: `${remoteBase}/image.gif`,
        },
      ],
    };
  });
  remote.get("/image.png", async (_req, reply) => {
    imageCalls++;
    return reply.type("image/png").send(png);
  });
  remote.get("/image.gif", async (_req, reply) => {
    imageCalls++;
    return reply.type("image/gif").send(gif);
  });
  await remote.listen({ host: "127.0.0.1", port: 0 });
  remoteBase = `http://127.0.0.1:${remote.server.address().port}`;
});
after(async () => {
  await app.close();
  await remote.close();
  await pool.end();
  await control.query(`DROP SCHEMA ${schema} CASCADE`);
  await control.end();
  await rm(uploadRoot, { recursive: true, force: true });
});
test("registration settings, invite use limits, rollback and concurrent redemption", async () => {
  assert.equal(
    (
      await request("PATCH", "/api/admin/settings", {
        siteUrl: "https://forum.example.test",
        registrationEnabled: false,
      })
    ).statusCode,
    200,
  );
  assert.equal((await register("closed")).statusCode, 403);
  assert.equal(
    (
      await request("PATCH", "/api/admin/settings", {
        siteUrl: "javascript:bad",
      })
    ).statusCode,
    400,
  );
  await request("PATCH", "/api/admin/settings", {
    registrationEnabled: true,
    registrationMode: "invite",
  });
  assert.equal((await register("missing")).statusCode, 400);
  const created = (
    await request("POST", "/api/admin/invitations", { quantity: 1, maxUses: 2 })
  ).json()[0];
  assert.equal((await register("member", created.code)).statusCode, 409);
  assert.equal(
    (
      await query("SELECT used_count FROM invitations WHERE id=$1", [
        created.id,
      ])
    ).rows[0].used_count,
    0,
  );
  assert.equal((await register("invited_one", created.code)).statusCode, 201);
  assert.equal((await register("invited_two", created.code)).statusCode, 201);
  assert.equal((await register("invited_three", created.code)).statusCode, 400);
  const single = (
    await request("POST", "/api/admin/invitations", { quantity: 1, maxUses: 1 })
  ).json()[0];
  const results = await Promise.all([
    register("race_one", single.code),
    register("race_two", single.code),
  ]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 400]);
  const disabled = (
    await request("POST", "/api/admin/invitations", { quantity: 1, maxUses: 1 })
  ).json()[0];
  await request("PATCH", `/api/admin/invitations/${disabled.id}`, {
    isEnabled: false,
  });
  assert.equal((await register("disabled", disabled.code)).statusCode, 400);
  assert.equal(
    (
      await request(
        "POST",
        "/api/admin/invitations",
        { quantity: 1, maxUses: 1 },
        member,
      )
    ).statusCode,
    403,
  );
  await request("PATCH", "/api/admin/settings", { registrationMode: "open" });
  assert.equal((await register("open_again")).statusCode, 201);
});
test("level invitation rewards issue once and remain available to the user", async () => {
  const rule = (
    await request("POST", "/api/admin/invitation-rules", {
      minimumLevel: 3,
      quantity: 2,
    })
  ).json();
  assert.equal(
    (await request("GET", "/api/me/invitations", undefined, member)).json()
      .length,
    0,
  );
  await request("PATCH", `/api/admin/users/${member.user.uid}`, { level: 3 });
  assert.equal(
    (
      await query(
        "SELECT COUNT(*)::int AS count FROM invitations WHERE created_by=$1",
        [member.user.uid],
      )
    ).rows[0].count,
    2,
  );
  await Promise.all([
    request("GET", "/api/auth/me", undefined, member),
    request("GET", "/api/me/invitations", undefined, member),
  ]);
  const codes = (
    await request("GET", "/api/me/invitations", undefined, member)
  ).json();
  assert.equal(codes.length, 2);
  assert.ok(codes.every((c) => c.max_uses === 1));
  await request("PATCH", `/api/admin/invitation-rules/${rule.id}`, {
    isEnabled: false,
  });
  assert.equal(
    (await request("GET", "/api/me/invitations", undefined, member)).json()
      .length,
    2,
  );
});
test("check-in, posting and replying grant invitations as soon as the level changes", async () => {
  for (const minimumLevel of [4, 5, 6])
    await request("POST", "/api/admin/invitation-rules", {
      minimumLevel,
      quantity: 1,
    });
  await query("UPDATE experience_rules SET points=100");
  assert.equal(
    (await request("POST", "/api/check-in", undefined, member)).statusCode,
    200,
  );
  assert.equal(
    (
      await query(
        "SELECT COUNT(*)::int AS count FROM invitations WHERE created_by=$1",
        [member.user.uid],
      )
    ).rows[0].count,
    3,
  );
  const category = (await request("GET", "/api/categories")).json()[0];
  const post = await request(
    "POST",
    "/api/posts",
    {
      categoryId: category.id,
      title: "测试自动等级奖励",
      body: { blocks: [{ type: "paragraph", data: { text: "测试内容" } }] },
    },
    member,
  );
  assert.equal(post.statusCode, 201);
  assert.equal(
    (
      await query(
        "SELECT COUNT(*)::int AS count FROM invitations WHERE created_by=$1",
        [member.user.uid],
      )
    ).rows[0].count,
    4,
  );
  assert.equal(
    (
      await request(
        "POST",
        `/api/posts/${post.json().post.id}/replies`,
        {
          body: { blocks: [{ type: "paragraph", data: { text: "测试回复" } }] },
        },
        member,
      )
    ).statusCode,
    201,
  );
  assert.equal(
    (
      await query(
        "SELECT COUNT(*)::int AS count FROM invitations WHERE created_by=$1",
        [member.user.uid],
      )
    ).rows[0].count,
    5,
  );
});

test("default limits, group overrides, upload ownership and atomic capacity enforcement", async () => {
  const initial = (
    await request("GET", "/api/me/media-usage", undefined, member)
  ).json();
  assert.deepEqual(initial.limits, {
    storageBytes: 1024 ** 3,
    imageBytes: 20 * 1024 ** 2,
    emojiPackCount: 20,
    emojiImagesPerPack: 150,
    emojiImageBytes: 3 * 1024 ** 2,
  });
  const group = (
    await request("POST", "/api/admin/groups", {
      name: "媒体测试组",
      groupType: "special",
      permissions: ["media.use"],
      mediaLimits: {
        storageBytes: png.length * 2,
        imageBytes: png.length - 1,
        emojiPackCount: 1,
        emojiImagesPerPack: 1,
        emojiImageBytes: png.length,
      },
    })
  ).json();
  await request("POST", `/api/admin/groups/${group.id}/memberships`, {
    userUid: member.user.uid,
  });
  assert.equal((await upload(member)).statusCode, 413);
  await request("PATCH", `/api/admin/groups/${group.id}`, {
    mediaLimits: {
      storageBytes: png.length * 2,
      imageBytes: png.length,
      emojiPackCount: 1,
      emojiImagesPerPack: 1,
      emojiImageBytes: png.length,
    },
  });
  const first = (await upload(member)).json();
  assert.ok(first.id);
  assert.equal(
    (
      await request(
        "PATCH",
        `/api/me/media/${first.id}`,
        { altText: "偷改" },
        other,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (await request("DELETE", `/api/me/media/${first.id}`, undefined, other))
      .statusCode,
    404,
  );
  const results = await Promise.all([upload(member), upload(member)]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 409]);
  assert.equal(
    (await request("GET", "/api/me/media-usage", undefined, member)).json()
      .usedBytes,
    png.length * 2,
  );
  assert.equal(
    (await request("GET", "/api/me/media", undefined, other)).json().length,
    0,
  );
  await request("DELETE", `/api/me/media/${first.id}`, undefined, member);
  const pack = (
    await request("POST", "/api/me/emoji-packs", { name: "个人表情" }, member)
  ).json();
  assert.equal(
    (await request("POST", "/api/me/emoji-packs", { name: "超过组数" }, member))
      .statusCode,
    409,
  );
  assert.equal((await upload(other, "emoji", pack.id)).statusCode, 404);
  assert.equal((await upload(member, "emoji", pack.id)).statusCode, 201);
  assert.equal((await upload(member, "emoji", pack.id)).statusCode, 409);
  assert.equal(
    (
      await request(
        "GET",
        `/api/me/emoji-packs/${pack.id}/images`,
        undefined,
        other,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (await request("GET", "/api/emoji-packs"))
      .json()
      .some((p) => p.id === pack.id),
    false,
  );
  assert.equal(
    (await request("GET", "/api/emoji-packs", undefined, member))
      .json()
      .find((p) => p.id === pack.id).emojis.length,
    1,
  );
  await request("DELETE", `/api/me/emoji-packs/${pack.id}`, undefined, member);
  assert.equal(
    (await request("GET", "/api/me/media-usage", undefined, member)).json()
      .uploadedPacks,
    0,
  );
  await request(
    "DELETE",
    `/api/admin/groups/${group.id}/memberships/${member.user.uid}`,
  );
});
test("remote static and animated downloads share cached files without consuming personal storage", async () => {
  assert.equal(
    (await request("GET", "/api/me/remote-emoji/packages", undefined, member))
      .statusCode,
    403,
  );
  await setLimits(
    {},
    { enabled: true, sourceUrl: remoteBase, apiUrl: remoteBase },
  );
  const search = (
    await request(
      "GET",
      "/api/me/remote-emoji/packages?q=测试",
      undefined,
      member,
    )
  ).json();
  assert.equal(search.total, 1);
  const detail = (
    await request("GET", "/api/me/remote-emoji/packages/1", undefined, member)
  ).json();
  assert.equal(detail.hasAnimated, true);
  const before = (
    await request("GET", "/api/me/media-usage", undefined, member)
  ).json().usedBytes;
  const calls = detailCalls,
    images = imageCalls;
  const [one, two] = await Promise.all([
    request(
      "POST",
      "/api/me/remote-emoji/import",
      { remoteId: 1, variant: "static" },
      member,
    ),
    request(
      "POST",
      "/api/me/remote-emoji/import",
      { remoteId: 1, variant: "static" },
      other,
    ),
  ]);
  assert.equal(one.statusCode, 201);
  assert.equal(two.statusCode, 201);
  assert.equal(one.json().id, two.json().id);
  assert.equal(detailCalls - calls, 1);
  assert.equal(imageCalls - images, 1);
  assert.equal(
    (await request("GET", "/api/me/media-usage", undefined, member)).json()
      .usedBytes,
    before,
  );
  const animated = await request(
    "POST",
    "/api/me/remote-emoji/import",
    { remoteId: 1, variant: "animated" },
    member,
  );
  assert.equal(animated.statusCode, 201);
  assert.notEqual(animated.json().id, one.json().id);
  const assets = (
    await request(
      "GET",
      `/api/me/emoji-packs/${animated.json().id}/images`,
      undefined,
      member,
    )
  ).json();
  assert.equal(assets[0].mime_type, "image/gif");
  await request(
    "DELETE",
    `/api/me/emoji-packs/${one.json().id}`,
    undefined,
    member,
  );
  assert.equal(
    (
      await request(
        "GET",
        `/api/me/emoji-packs/${one.json().id}/images`,
        undefined,
        other,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await query(
        "SELECT COUNT(*)::int AS count FROM media_assets WHERE remote_cached",
      )
    ).rows[0].count,
    2,
  );
  assert.ok((await readdir(uploadRoot)).some((file) => file.endsWith(".gif")));
  await setLimits(
    {},
    { enabled: false, sourceUrl: remoteBase, apiUrl: remoteBase },
  );
  assert.equal(
    (
      await request(
        "POST",
        "/api/me/remote-emoji/import",
        { remoteId: 1, variant: "static" },
        member,
      )
    ).statusCode,
    403,
  );
});
test("profile updates preserve identity and change the login username with duplicate validation", async () => {
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: "/api/me/profile",
        payload: { username: "anonymous" },
      })
    ).statusCode,
    401,
  );
  for (const username of ["ab", "invalid user", "用户名称", "x".repeat(33)])
    assert.equal(
      (await request("PATCH", "/api/me/profile", { username }, member))
        .statusCode,
      400,
    );
  assert.equal(
    (await request("PATCH", "/api/me/profile", { username: "OWNER" }, member))
      .statusCode,
    409,
  );
  assert.equal(
    (
      await request(
        "PATCH",
        "/api/me/profile",
        { username: "attacker", uid: other.user.uid },
        member,
      )
    ).statusCode,
    400,
  );
  const before = (
    await request("GET", "/api/auth/me", undefined, member)
  ).json();
  const result = await request(
    "PATCH",
    "/api/me/profile",
    { username: " Member_Updated " },
    member,
  );
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().username, "member_updated");
  const after = (
    await request("GET", "/api/auth/me", undefined, member)
  ).json();
  assert.equal(after.uid, before.uid);
  assert.equal(after.uuid, before.uuid);
  assert.equal(after.displayName, before.displayName);
  assert.equal(after.email, before.email);
  assert.equal(after.username, "member_updated");
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { identity: "member_updated", password },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { identity: "member", password },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (await request("GET", "/api/auth/me", undefined, other)).json().username,
    "other",
  );
});

test("username cooldown is atomic, keeps failed changes free and leaves nickname changes independent", async () => {
  const profile = () =>
    request("GET", "/api/auth/me", undefined, member).then((result) =>
      result.json(),
    );
  const timestamp = async () =>
    (
      await query("SELECT username_changed_at FROM users WHERE uid=$1", [
        member.user.uid,
      ])
    ).rows[0].username_changed_at.toISOString();
  const before = await profile();
  assert.ok(before.usernameChangeAvailableAt);
  const changedAt = await timestamp();
  assert.equal(
    (
      await request(
        "PATCH",
        "/api/me/profile",
        { username: before.username.toUpperCase() },
        member,
      )
    ).statusCode,
    200,
  );
  assert.equal(await timestamp(), changedAt);
  const duplicate = await request(
    "PATCH",
    "/api/me/profile",
    { username: "OWNER" },
    member,
  );
  assert.equal(duplicate.statusCode, 409);
  assert.match(duplicate.body, /此用户名已被使用/);
  const blocked = await request(
    "PATCH",
    "/api/me/profile",
    { username: "member_too_soon" },
    member,
  );
  assert.equal(blocked.statusCode, 409);
  assert.match(blocked.body, /180/);
  assert.equal((await profile()).username, before.username);
  assert.equal(await timestamp(), changedAt);
  for (const displayName of ["新昵称甲", "新昵称乙"]) {
    assert.equal(
      (await request("PATCH", "/api/me/profile", { displayName }, member))
        .statusCode,
      200,
    );
    const updated = await profile();
    assert.equal(updated.displayName, displayName);
    assert.equal(updated.username, before.username);
    assert.equal(updated.uid, before.uid);
    assert.equal(await timestamp(), changedAt);
  }
  for (const displayName of ["", " ", "字".repeat(49)])
    assert.equal(
      (await request("PATCH", "/api/me/profile", { displayName }, member))
        .statusCode,
      400,
    );
  assert.equal(
    (
      await request(
        "PATCH",
        "/api/me/profile",
        { username: "owner", displayName: "不应保存" },
        member,
      )
    ).statusCode,
    409,
  );
  assert.equal((await profile()).displayName, "新昵称乙");
  const posts = (await request("GET", "/api/posts", undefined, member))
    .json()
    .filter((post) => post.author_uid === member.user.uid);
  assert.ok(posts.length);
  assert.ok(posts.every((post) => post.display_name === "新昵称乙"));
  await query(
    "UPDATE users SET username_changed_at=NOW()-INTERVAL '179 days' WHERE uid=$1",
    [member.user.uid],
  );
  assert.equal(
    (
      await request(
        "PATCH",
        "/api/me/profile",
        { username: "member_before_limit" },
        member,
      )
    ).statusCode,
    409,
  );
  await query(
    "UPDATE users SET username_changed_at=NOW()-INTERVAL '180 days' WHERE uid=$1",
    [member.user.uid],
  );
  assert.equal((await profile()).usernameChangeAvailableAt, null);
  assert.equal(
    (
      await request(
        "PATCH",
        "/api/me/profile",
        { username: "member_after_limit" },
        member,
      )
    ).statusCode,
    200,
  );
  await query(
    "UPDATE users SET username_changed_at=NOW()-INTERVAL '180 days' WHERE uid=$1",
    [member.user.uid],
  );
  const race = await Promise.all(
    ["member_race_one", "member_race_two"].map((username) =>
      request("PATCH", "/api/me/profile", { username }, member),
    ),
  );
  assert.deepEqual(
    race.map((response) => response.statusCode).sort(),
    [200, 409],
  );
});

test("only active management group memberships bypass the username cooldown", async () => {
  const privileged = (
    await request("POST", "/api/admin/groups", {
      name: "仅有用户管理权限",
      groupType: "special",
      permissions: ["users.manage"],
    })
  ).json();
  await request("POST", `/api/admin/groups/${privileged.id}/memberships`, {
    userUid: member.user.uid,
  });
  assert.equal(
    (
      await request(
        "PATCH",
        "/api/me/profile",
        { username: "privileged_not_manager" },
        member,
      )
    ).statusCode,
    409,
  );
  const management = (
    await request("POST", "/api/admin/groups", {
      name: "改名豁免管理组",
      groupType: "management",
      permissions: [
        "users.manage",
        "posts.create",
        "replies.create",
        "media.use",
      ],
    })
  ).json();
  await request("POST", `/api/admin/groups/${management.id}/memberships`, {
    userUid: other.user.uid,
  });
  for (const username of ["other_manager_one", "other_manager_two"])
    assert.equal(
      (await request("PATCH", "/api/me/profile", { username }, other))
        .statusCode,
      200,
    );
  assert.equal(
    (await request("GET", "/api/auth/me", undefined, other)).json()
      .usernameChangeAvailableAt,
    null,
  );
  const duplicate = await request(
    "PATCH",
    "/api/me/profile",
    { username: "OWNER" },
    other,
  );
  assert.equal(duplicate.statusCode, 409);
  assert.match(duplicate.body, /此用户名已被使用/);
  await request("POST", `/api/admin/groups/${management.id}/memberships`, {
    userUid: other.user.uid,
    expiresAt: new Date(Date.now() - 60000).toISOString(),
  });
  assert.equal(
    (
      await request(
        "PATCH",
        "/api/me/profile",
        { username: "expired_manager" },
        other,
      )
    ).statusCode,
    409,
  );
  assert.ok(
    (await request("GET", "/api/auth/me", undefined, other)).json()
      .usernameChangeAvailableAt,
  );
  await request(
    "DELETE",
    `/api/admin/groups/${management.id}/memberships/${other.user.uid}`,
  );
  await request(
    "DELETE",
    `/api/admin/groups/${privileged.id}/memberships/${member.user.uid}`,
  );
});

test("avatar uploads persist, reject invalid uploads and protect the active avatar from deletion", async () => {
  const first = await upload(member, "library", "", png, "/api/me/avatar");
  assert.equal(first.statusCode, 201);
  const firstUrl = first.json().avatarUrl;
  assert.equal(
    (await request("GET", "/api/auth/me", undefined, member)).json().avatarUrl,
    firstUrl,
  );
  assert.equal(
    (await request("GET", "/api/auth/me", undefined, other)).json().avatarUrl,
    null,
  );
  const images = (
    await request("GET", "/api/me/media", undefined, member)
  ).json();
  const firstImage = images.find((image) => image.url === firstUrl);
  assert.ok(firstImage);
  assert.equal(
    (
      await request(
        "DELETE",
        `/api/me/media/${firstImage.id}`,
        undefined,
        member,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (await upload(member, "library", "", png, "/api/me/avatar", "text/plain"))
      .statusCode,
    415,
  );
  const filesBefore = await readdir(uploadRoot);
  await setLimits({ imageBytes: png.length - 1 });
  assert.equal(
    (await upload(member, "library", "", png, "/api/me/avatar")).statusCode,
    413,
  );
  await setLimits({ imageBytes: 20 * 1024 ** 2 });
  const usedBytes = (
    await request("GET", "/api/me/media-usage", undefined, member)
  ).json().usedBytes;
  await setLimits({ storageBytes: usedBytes });
  assert.equal(
    (await upload(member, "library", "", png, "/api/me/avatar")).statusCode,
    409,
  );
  assert.deepEqual(await readdir(uploadRoot), filesBefore);
  assert.equal(
    (await request("GET", "/api/auth/me", undefined, member)).json().avatarUrl,
    firstUrl,
  );
  await setLimits({ storageBytes: 1024 ** 3 });
  const replaced = await upload(member, "library", "", png, "/api/me/avatar");
  assert.equal(replaced.statusCode, 201);
  assert.notEqual(replaced.json().avatarUrl, firstUrl);
  assert.equal(
    (
      await request(
        "DELETE",
        `/api/me/media/${firstImage.id}`,
        undefined,
        member,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (await request("GET", "/api/auth/me", undefined, member)).json().avatarUrl,
    replaced.json().avatarUrl,
  );
  const posts = (await request("GET", "/api/posts", undefined, member)).json();
  assert.ok(
    posts
      .filter((post) => post.author_uid === member.user.uid)
      .every((post) => post.avatar_url === replaced.json().avatarUrl),
  );
});

test("revoking media permission survives restart migrations and blocks upload endpoints", async () => {
  const groups = (await request("GET", "/api/admin/groups")).json();
  const ordinary = groups.find((g) => g.is_default);
  await request("PATCH", `/api/admin/groups/${ordinary.id}`, {
    permissions: ["posts.create", "replies.create"],
  });
  await runMigrations();
  await query("UPDATE app_settings SET setting_value=jsonb_set(setting_value, '{directLibraryUploads}', 'true'::jsonb) WHERE setting_key='content_limits'");
  assert.equal(
    (await request("GET", "/api/me/media", undefined, other)).statusCode,
    403,
  );
  assert.equal((await upload(other)).statusCode, 403);
  assert.equal(
    (await upload(other, "library", "", png, "/api/me/avatar")).statusCode,
    201,
  );
});
const categoryId = async () =>
  (await request("GET", "/api/categories")).json()[0].id;
async function createTestPost(title, user = member, minimumReaderLevel = 0) {
  return request(
    "POST",
    "/api/posts",
    {
      categoryId: await categoryId(),
      title,
      minimumReaderLevel,
      body: {
        blocks: [
          { type: "paragraph", data: { text: "用于帖子生命周期验收的正文" } },
        ],
      },
    },
    user,
  );
}
test("reader-level permissions are explicit and disappear when the membership expires", async () => {
  const current = (
    await request("GET", "/api/auth/me", undefined, member)
  ).json();
  assert.ok(!current.permissions.includes("posts.set_reader_level"));
  assert.equal(
    (await createTestPost("无权限设置阅读等级", member, 1)).statusCode,
    403,
  );
  const plain = await createTestPost("普通用户公开帖子");
  assert.equal(plain.statusCode, 201);
  const group = (
    await request("POST", "/api/admin/groups", {
      name: "阅读等级设置组",
      groupType: "special",
      permissions: ["posts.set_reader_level"],
    })
  ).json();
  await request("POST", `/api/admin/groups/${group.id}/memberships`, {
    userUid: member.user.uid,
  });
  const limited = await createTestPost("授权用户设置阅读等级", member, 2);
  assert.equal(limited.statusCode, 201);
  assert.equal(
    (await app.inject({ url: `/api/posts/${limited.json().post.id}` }))
      .statusCode,
    403,
  );
  await request("POST", `/api/admin/groups/${group.id}/memberships`, {
    userUid: member.user.uid,
    expiresAt: new Date(Date.now() - 60000).toISOString(),
  });
  assert.equal(
    (await createTestPost("过期组不能设置等级", member, 1)).statusCode,
    403,
  );
  assert.equal(
    (
      await request(
        "DELETE",
        `/api/me/posts/${limited.json().post.id}`,
        undefined,
        member,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await request(
        "POST",
        `/api/me/trash/${limited.json().post.id}/restore`,
        undefined,
        member,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await request(
        "GET",
        `/api/posts/${limited.json().post.id}`,
        undefined,
        member,
      )
    ).json().post.minimum_reader_level,
    2,
  );
});

test("recycling a post is private, preserves discussion data and restores the original moderation status", async () => {
  const created = await createTestPost("自己的帖子进入回收站");
  assert.equal(created.statusCode, 201);
  const id = created.json().post.id;
  await request(
    "POST",
    `/api/posts/${id}/replies`,
    {
      body: { blocks: [{ type: "paragraph", data: { text: "已存在的回复" } }] },
    },
    other,
  );
  await request("POST", `/api/posts/${id}/like`, undefined, other);
  await request("GET", `/api/posts/${id}`, undefined, member);
  const before = (
    await request("GET", "/api/auth/me", undefined, member)
  ).json().experience;
  const categoriesBefore = (await request("GET", "/api/categories")).json();
  assert.equal(
    (await request("DELETE", `/api/me/posts/${id}`, undefined, other))
      .statusCode,
    404,
  );
  assert.equal(
    (await request("DELETE", `/api/me/posts/${id}`)).statusCode,
    404,
  );
  const removed = await request(
    "DELETE",
    `/api/me/posts/${id}`,
    undefined,
    member,
  );
  assert.equal(removed.statusCode, 200);
  assert.equal(
    new Date(removed.json().purge_after) - new Date(removed.json().deleted_at),
    30 * 86400000,
  );
  assert.equal(
    (await request("DELETE", `/api/me/posts/${id}`, undefined, member))
      .statusCode,
    404,
  );
  for (const user of [member, other, admin])
    assert.equal(
      (await request("GET", `/api/posts/${id}`, undefined, user)).statusCode,
      404,
    );
  assert.equal((await app.inject({ url: `/api/posts/${id}` })).statusCode, 404);
  assert.equal(
    (await request("GET", "/api/me/posts", undefined, member))
      .json()
      .some((post) => post.id === id),
    false,
  );
  assert.equal(
    (await request("GET", "/api/admin/posts"))
      .json()
      .some((post) => post.id === id),
    false,
  );
  assert.equal(
    (await request("PATCH", `/api/admin/posts/${id}`, { status: "published" }))
      .statusCode,
    404,
  );
  const categoriesAfter = (await request("GET", "/api/categories")).json();
  const category = categoriesAfter.find(
    (item) => item.id === categoriesBefore[0].id,
  );
  assert.equal(
    Number(category.post_count),
    Number(categoriesBefore[0].post_count) - 1,
  );
  assert.equal(
    (await request("GET", "/api/me/trash", undefined, member))
      .json()
      .some((post) => post.id === id),
    true,
  );
  for (const user of [other, admin]) {
    assert.equal(
      (await request("GET", "/api/me/trash", undefined, user))
        .json()
        .some((post) => post.id === id),
      false,
    );
    assert.equal(
      (await request("GET", `/api/me/trash/${id}`, undefined, user)).statusCode,
      404,
    );
    assert.equal(
      (await request("POST", `/api/me/trash/${id}/restore`, undefined, user))
        .statusCode,
      404,
    );
  }
  const detail = (
    await request("GET", `/api/me/trash/${id}`, undefined, member)
  ).json();
  assert.equal(detail.replies.length, 1);
  assert.equal(detail.likeCount, 1);
  assert.equal(detail.post.view_count, 1);
  assert.equal(
    (
      await request(
        "POST",
        `/api/posts/${id}/replies`,
        {
          body: {
            blocks: [{ type: "paragraph", data: { text: "不应接受的新回复" } }],
          },
        },
        other,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (await request("POST", `/api/posts/${id}/like`, undefined, other)).json()
      .liked,
    false,
  );
  assert.equal(
    (
      await request("POST", `/api/me/trash/${id}/restore`, undefined, member)
    ).json().status,
    "published",
  );
  const restored = (
    await request("GET", `/api/posts/${id}`, undefined, member)
  ).json();
  assert.equal(restored.replies.length, 1);
  assert.equal(restored.likeCount, 1);
  assert.equal(restored.post.view_count, 1);
  for (const status of ["hidden", "pending"]) {
    await request("PATCH", `/api/admin/posts/${id}`, { status });
    await request("DELETE", `/api/me/posts/${id}`, undefined, member);
    assert.equal(
      (
        await request("POST", `/api/me/trash/${id}/restore`, undefined, member)
      ).json().status,
      status,
    );
    assert.equal(
      (await app.inject({ url: `/api/posts/${id}` })).statusCode,
      status === "hidden" ? 200 : 404,
    );
  }
  assert.equal(
    (await request("GET", "/api/auth/me", undefined, member)).json().experience,
    before,
  );
});

test("retention settings apply to new deletions and expiry purges dependent records", async () => {
  assert.equal(
    (await request("PATCH", "/api/admin/settings", { trashRetentionDays: 0 }))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await request(
        "PATCH",
        "/api/admin/settings",
        { trashRetentionDays: 7 },
        member,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await request("PATCH", "/api/admin/settings", {
        siteTitle: "Forum",
        siteUrl: "",
        registrationEnabled: true,
        registrationMode: "open",
        trashRetentionDays: 7,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await request("PATCH", "/api/admin/settings", {
        siteUrl: "not-a-url",
        trashRetentionDays: 7,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await request("GET", "/api/admin/settings")).json().trash_retention_days,
    7,
  );
  const id = (await createTestPost("到期回收站清理帖子")).json().post.id;
  await request(
    "POST",
    `/api/posts/${id}/replies`,
    { body: { blocks: [{ type: "paragraph", data: { text: "到期回复" } }] } },
    other,
  );
  await request("POST", `/api/posts/${id}/like`, undefined, other);
  await request("GET", `/api/posts/${id}`, undefined, member);
  const deleted = (
    await request("DELETE", `/api/me/posts/${id}`, undefined, member)
  ).json();
  assert.equal(
    new Date(deleted.purge_after) - new Date(deleted.deleted_at),
    7 * 86400000,
  );
  await request("PATCH", "/api/admin/settings", { trashRetentionDays: 14 });
  assert.equal(
    (await request("GET", `/api/me/trash/${id}`, undefined, member)).json().post
      .purge_after,
    deleted.purge_after,
  );
  await query(
    "UPDATE posts SET purge_after=NOW()-INTERVAL '1 minute' WHERE id=$1",
    [id],
  );
  assert.equal(
    (await request("GET", "/api/me/trash", undefined, member))
      .json()
      .some((post) => post.id === id),
    false,
  );
  assert.equal(
    (await request("GET", `/api/me/trash/${id}`, undefined, member)).statusCode,
    404,
  );
  assert.equal(
    (await request("POST", `/api/me/trash/${id}/restore`, undefined, member))
      .statusCode,
    404,
  );
  const { purgeExpiredPosts } = await import("../src/posts.ts");
  await purgeExpiredPosts();
  for (const table of ["posts", "replies", "post_likes", "post_views"]) {
    const column = table === "posts" ? "id" : "post_id";
    assert.equal(
      (
        await query(
          `SELECT COUNT(*)::int AS count FROM ${table} WHERE ${column}=$1`,
          [id],
        )
      ).rows[0].count,
      0,
    );
  }
  await request("PATCH", "/api/admin/settings", { trashRetentionDays: 30 });
});

test("post views count each account or anonymous browser once, including concurrent reads and like toggles", async () => {
  const id = (await createTestPost("浏览量去重验收帖子")).json().post.id;
  const first = await app.inject({ url: `/api/posts/${id}` });
  assert.equal(first.json().post.view_count, 1);
  const cookie = first.headers["set-cookie"].split(";")[0];
  for (let index = 0; index < 3; index++)
    assert.equal(
      (
        await app.inject({ url: `/api/posts/${id}`, headers: { cookie } })
      ).json().post.view_count,
      1,
    );
  const concurrent = await Promise.all(
    Array.from({ length: 5 }, () =>
      app.inject({ url: `/api/posts/${id}`, headers: { cookie } }),
    ),
  );
  assert.ok(concurrent.every((result) => result.json().post.view_count === 1));
  const guestTwo = await app.inject({ url: `/api/posts/${id}` });
  assert.equal(guestTwo.json().post.view_count, 2);
  assert.equal(
    (await request("GET", `/api/posts/${id}`, undefined, member)).json().post
      .view_count,
    3,
  );
  for (let index = 0; index < 6; index++) {
    assert.equal(
      (await request("POST", `/api/posts/${id}/like`, undefined, member))
        .statusCode,
      200,
    );
    assert.equal(
      (await request("GET", `/api/posts/${id}`, undefined, member)).json().post
        .view_count,
      3,
    );
  }
  const anotherSession = {
    token: app.jwt.sign({ uid: member.user.uid, uuid: member.user.uuid }),
  };
  assert.equal(
    (await request("GET", `/api/posts/${id}`, undefined, anotherSession)).json()
      .post.view_count,
    3,
  );
  assert.equal(
    (await request("GET", `/api/posts/${id}`, undefined, other)).json().post
      .view_count,
    4,
  );
  assert.equal(
    (
      await query(
        "SELECT COUNT(*)::int AS count FROM post_views WHERE post_id=$1",
        [id],
      )
    ).rows[0].count,
    4,
  );
  const legacy = (await createTestPost("保留历史浏览量的帖子")).json().post.id;
  await query("UPDATE posts SET view_count=10 WHERE id=$1", [legacy]);
  assert.equal(
    (await request("GET", `/api/posts/${legacy}`, undefined, member)).json()
      .post.view_count,
    11,
  );
  assert.equal(
    (await request("GET", `/api/posts/${legacy}`, undefined, member)).json()
      .post.view_count,
    11,
  );
  const denied = (
    await createTestPost("无权阅读不增加浏览量", admin, 99)
  ).json().post.id;
  assert.equal(
    (await app.inject({ url: `/api/posts/${denied}` })).statusCode,
    403,
  );
  assert.equal(
    (await query("SELECT view_count FROM posts WHERE id=$1", [denied])).rows[0]
      .view_count,
    0,
  );
});
