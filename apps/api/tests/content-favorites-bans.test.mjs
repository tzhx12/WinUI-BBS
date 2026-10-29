import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readdir } from "node:fs/promises";
import { createManagementFixture } from "./helpers/management-fixture.mjs";
let f, member, other, category, defaults;
const content = (text) => ({ blocks: [{ type: "paragraph", data: { text } }] });
const image = (url) => ({
  type: "image",
  data: { file: { url }, caption: "" },
});
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWioAAAAASUVORK5CYII=",
  "base64",
);
const create = (body = content("正文内容"), user = member, extra = {}) =>
  f.request(
    "POST",
    "/api/posts",
    { title: "内容功能测试", categoryId: category.id, body, ...extra },
    user,
  );
async function configure(value) {
  const response = await f.request(
    "PATCH",
    "/api/admin/content-settings",
    { ...defaults, ...value },
    f.owner,
  );
  assert.equal(response.statusCode, 200, response.body);
}
async function folder(name, isPublic = false, user = member) {
  const response = await f.request(
    "POST",
    "/api/me/favorite-folders",
    { name, isPublic },
    user,
  );
  assert.equal(response.statusCode, 201, response.body);
  return response.json();
}
function multipart(
  payload,
  files = [{ id: "draft:test", buffer: png, mime: "image/png" }],
  endpoint = "/api/posts",
) {
  const boundary = "forum-content-boundary";
  const parts = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${JSON.stringify(payload)}\r\n`,
    ),
  ];
  for (const file of files)
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.id}"; filename="test.png"\r\nContent-Type: ${file.mime}\r\n\r\n`,
      ),
      file.buffer,
      Buffer.from("\r\n"),
    );
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return f.app.inject({
    method: "POST",
    url: endpoint,
    headers: {
      authorization: `Bearer ${member.token}`,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat(parts),
  });
}
before(async () => {
  f = await createManagementFixture();
  for (const name of ["content_member", "content_other"]) {
    const response = await f.request("POST", "/api/auth/register", {
      username: name,
      displayName: name,
      email: `${name}@example.test`,
      password: f.password,
    });
    assert.equal(response.statusCode, 201, response.body);
    if (!member) member = response.json();
    else other = response.json();
  }
  category = (await f.request("GET", "/api/categories")).json()[0];
  defaults = (
    await f.request("GET", "/api/admin/content-settings", undefined, f.owner)
  ).json();
});
after(async () => {
  if (f) await f.close();
});

test("content defaults, finite bounds and settings permission isolation", async () => {
  assert.deepEqual(defaults, {
    postCharacters: 20000,
    postImages: 15,
    replyCharacters: 1000,
    replyImages: 5,
    repliesPerPage: 20,
    directLibraryUploads: false,
  });
  for (const manager of f.managers)
    assert.equal(
      (
        await f.request(
          "GET",
          "/api/admin/content-settings",
          undefined,
          manager,
        )
      ).statusCode,
      manager.permission === "settings.manage" ? 200 : 403,
    );
  for (const [key, value] of Object.entries({
    postCharacters: 100001,
    postImages: 51,
    replyCharacters: 10001,
    replyImages: 21,
    repliesPerPage: 101,
  }))
    assert.equal(
      (
        await f.request(
          "PATCH",
          "/api/admin/content-settings",
          { ...defaults, [key]: value },
          f.owner,
        )
      ).statusCode,
      400,
    );
  assert.equal(
    (await f.request("POST", "/api/media", undefined, member)).statusCode,
    403,
  );
  assert.equal(
    (
      await f.request(
        "POST",
        "/api/me/media?collection=library",
        undefined,
        member,
      )
    ).statusCode,
    403,
  );
});
test("post and reply limits count Unicode text, nested lists, captions and emoji images", async () => {
  assert.equal((await create(content("字".repeat(20000)))).statusCode, 201);
  assert.equal((await create(content("字".repeat(20001)))).statusCode, 400);
  await configure({
    postCharacters: 3,
    postImages: 1,
    replyCharacters: 2,
    replyImages: 0,
  });
  assert.equal((await create(content("<b>甲&amp;😀</b>"))).statusCode, 201);
  assert.equal(
    (
      await create({
        blocks: [
          {
            type: "list",
            data: {
              items: [{ content: "甲乙", items: [{ content: "丙丁" }] }],
            },
          },
        ],
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await create({
        blocks: [
          image("/deleted-image.png"),
          { type: "emoji", data: { url: "/uploads/emoji.png" } },
        ],
      })
    ).statusCode,
    400,
  );
  const post = (await create(content("测试"))).json().post;
  assert.equal(
    (
      await f.request(
        "POST",
        `/api/posts/${post.id}/replies`,
        { body: content("甲乙") },
        member,
      )
    ).statusCode,
    201,
  );
  assert.equal(
    (
      await f.request(
        "POST",
        `/api/posts/${post.id}/replies`,
        { body: content("甲乙丙") },
        member,
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.request(
        "POST",
        `/api/posts/${post.id}/replies`,
        { body: { blocks: [image("/deleted-image.png")] } },
        member,
      )
    ).statusCode,
    400,
  );
  await configure({});
});
test("submissions upload files only with successful publication and roll back every file on failure", async () => {
  const payload = {
    title: "附件原子测试",
    categoryId: category.id,
    body: { blocks: [image("draft:test")] },
  };
  const before = await readdir(f.uploadRoot);
  assert.equal((await multipart({ ...payload, title: "短" })).statusCode, 400);
  assert.equal(
    (
      await multipart(payload, [
        { id: "draft:other", buffer: png, mime: "image/png" },
      ])
    ).statusCode,
    400,
  );
  assert.deepEqual(await readdir(f.uploadRoot), before);
  const created = await multipart(payload);
  assert.equal(created.statusCode, 201, created.body);
  const post = (
    await f.request(
      "GET",
      `/api/posts/${created.json().post.id}`,
      undefined,
      member,
    )
  ).json().post;
  assert.match(post.body.blocks[0].data.file.url, /^\/uploads\//);
  assert.equal((await readdir(f.uploadRoot)).length, before.length + 1);
  const multiple = await multipart(
    {
      ...payload,
      body: { blocks: [image("draft:first"), image("draft:second")] },
    },
    [
      { id: "draft:first", buffer: png, mime: "image/png" },
      { id: "draft:second", buffer: png, mime: "image/png" },
    ],
  );
  assert.equal(multiple.statusCode, 201, multiple.body);
  assert.equal((await readdir(f.uploadRoot)).length, before.length + 3);
  const mediaLimits = (
    await f.query(
      "SELECT setting_value FROM app_settings WHERE setting_key='media_limits'",
    )
  ).rows[0].setting_value;
  await f.query(
    "UPDATE app_settings SET setting_value=jsonb_set(setting_value,'{imageBytes}','1'::jsonb) WHERE setting_key='media_limits'",
  );
  assert.equal((await multipart(payload)).statusCode, 413);
  await f.query(
    "UPDATE app_settings SET setting_value=$1::jsonb WHERE setting_key='media_limits'",
    [JSON.stringify(mediaLimits)],
  );
  assert.equal((await readdir(f.uploadRoot)).length, before.length + 3);
  // A forced transaction error after writing the file must remove both file and DB rows.
  await f.query(
    `CREATE FUNCTION reject_content_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$; CREATE TRIGGER reject_content BEFORE INSERT ON posts FOR EACH ROW EXECUTE FUNCTION reject_content_test()`,
  );
  assert.equal((await multipart(payload)).statusCode, 500);
  assert.equal((await readdir(f.uploadRoot)).length, before.length + 3);
  assert.equal(
    (await f.query("SELECT COUNT(*)::int AS n FROM media_assets")).rows[0].n,
    3,
  );
  await f.query(
    "DROP TRIGGER reject_content ON posts; DROP FUNCTION reject_content_test()",
  );
});
test("reply pagination is stable, configurable and available in author trash", async () => {
  const post = (await create()).json().post;
  await f.query(
    `INSERT INTO replies(post_id,author_uid,body,created_at) SELECT $1,$2,jsonb_build_object('blocks',jsonb_build_array(jsonb_build_object('type','paragraph','data',jsonb_build_object('text',n::text)))),NOW() + n * INTERVAL '1 second' FROM generate_series(1,41) AS n`,
    [post.id, member.user.uid],
  );
  const pages = [];
  for (let page = 1; page <= 3; page++) {
    const response = await f.request(
      "GET",
      `/api/posts/${post.id}?page=${page}`,
    );
    assert.equal(response.statusCode, 200, response.body);
    pages.push(response.json());
  }
  assert.deepEqual(
    pages.map((p) => p.replies.length),
    [20, 20, 1],
  );
  assert.equal(
    new Set(pages.flatMap((p) => p.replies.map((r) => r.id))).size,
    41,
  );
  assert.equal(pages[0].totalReplyCount, 41);
  await configure({ repliesPerPage: 7 });
  assert.equal(
    (await f.request("GET", `/api/posts/${post.id}?page=6`)).json().replies
      .length,
    6,
  );
  assert.equal(
    (await f.request("GET", `/api/posts/${post.id}?page=0`)).statusCode,
    400,
  );
  await f.request("DELETE", `/api/me/posts/${post.id}`, undefined, member);
  assert.equal(
    (
      await f.request(
        "GET",
        `/api/me/trash/${post.id}?page=2`,
        undefined,
        member,
      )
    ).json().replies.length,
    7,
  );
  await configure({});
});
test("favorites are owner-managed and private folders cannot be read by other users", async () => {
  const post = (await create()).json().post;
  const first = await folder("私人收藏"),
    second = await folder("公开收藏", true);
  assert.equal(
    (
      await f.request(
        "POST",
        `/api/me/favorite-folders/${first.id}/posts/${post.id}`,
        undefined,
        member,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await f.request(
        "GET",
        `/api/favorite-folders/${first.id}`,
        undefined,
        other,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (await f.request("GET", `/api/favorite-folders/${first.id}`)).statusCode,
    404,
  );
  assert.equal(
    (
      await f.request(
        "PATCH",
        `/api/me/favorite-folders/${first.id}`,
        { name: "窃取", isPublic: true },
        other,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await f.request(
        "DELETE",
        `/api/me/favorite-folders/${first.id}`,
        undefined,
        other,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await f.request(
        "PATCH",
        `/api/me/favorite-folders/${first.id}/posts/${post.id}`,
        { targetFolderId: second.id },
        member,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await f.request(
        "GET",
        `/api/favorite-folders/${first.id}`,
        undefined,
        member,
      )
    ).json().posts.length,
    0,
  );
  assert.equal(
    (await f.request("GET", `/api/favorite-folders/${second.id}`)).json().posts
      .length,
    1,
  );
  const containing = (
    await f.request(
      "GET",
      `/api/me/favorite-folders?postId=${post.id}`,
      undefined,
      member,
    )
  ).json();
  assert.equal(
    containing.find((folder) => folder.id === second.id).contains_post,
    true,
  );
});
test("public spaces and favorites exclude hidden, deleted, pending, rejected and unreadable posts", async () => {
  const collection = await folder("状态过滤", true);
  const ids = [];
  for (const status of [
    "published",
    "hidden",
    "pending",
    "rejected",
    "deleted",
    "restricted",
  ]) {
    const post = (await create()).json().post;
    ids.push(post.id);
    await f.request(
      "POST",
      `/api/me/favorite-folders/${collection.id}/posts/${post.id}`,
      undefined,
      member,
    );
    if (status === "deleted")
      await f.request("DELETE", `/api/me/posts/${post.id}`, undefined, member);
    else if (status === "restricted")
      await f.query("UPDATE posts SET minimum_reader_level=99 WHERE id=$1", [
        post.id,
      ]);
    else
      await f.query("UPDATE posts SET status=$2 WHERE id=$1", [
        post.id,
        status,
      ]);
  }
  const detail = (
    await f.request("GET", `/api/favorite-folders/${collection.id}`)
  ).json();
  assert.deepEqual(
    detail.posts.map((p) => p.id),
    [ids[0]],
  );
  const ownerDetail = (
    await f.request(
      "GET",
      `/api/favorite-folders/${collection.id}`,
      undefined,
      member,
    )
  ).json();
  assert.deepEqual(
    ownerDetail.posts.map((p) => p.id),
    [ids[0]],
  );
  const space = (
    await f.request("GET", `/api/users/${member.user.uid}`)
  ).json();
  assert.ok(!("email" in space.user));
  assert.equal(
    space.folders.find((folder) => folder.id === collection.id).post_count,
    1,
  );
  for (const postId of ids.slice(1))
    assert.ok(!space.posts.some((p) => p.id === postId));
  assert.ok(!space.folders.some((folder) => folder.name === "私人收藏"));
});
test("temporary bans permit login and own reads at baseline level but block all interaction and administration", async () => {
  const owned = (await create()).json().post;
  await f.query("UPDATE posts SET minimum_reader_level=99 WHERE id=$1", [
    owned.id,
  ]);
  await f.query(
    "UPDATE users SET experience=99999,banned_until=NOW()+INTERVAL '1 hour' WHERE uid=$1",
    [member.user.uid],
  );
  const login = await f.request("POST", "/api/auth/login", {
    identity: "content_member",
    password: f.password,
  });
  assert.equal(login.statusCode, 200, login.body);
  const me = (await f.request("GET", "/api/auth/me", undefined, member)).json();
  assert.equal(me.isBanned, true);
  assert.deepEqual(me.permissions, []);
  for (const path of [
    "/api/me/posts",
    "/api/me/media",
    "/api/me/favorite-folders",
    "/api/me/media-usage",
    "/api/me/emoji-packs",
    `/api/posts/${owned.id}`,
  ])
    assert.equal(
      (await f.request("GET", path, undefined, member)).statusCode,
      200,
      path,
    );
  const restricted = (
    await create(content("高等级"), f.owner, { minimumReaderLevel: 2 })
  ).json().post;
  const baseline = (
    await create(content("最低等级"), f.owner, { minimumReaderLevel: 1 })
  ).json().post;
  assert.equal(
    (await f.request("GET", `/api/posts/${restricted.id}`, undefined, member))
      .statusCode,
    403,
  );
  assert.equal(
    (await f.request("GET", `/api/posts/${baseline.id}`, undefined, member))
      .statusCode,
    200,
  );
  for (const [method, path] of [
    ["POST", "/api/posts"],
    ["POST", `/api/posts/${owned.id}/replies`],
    ["POST", `/api/posts/${owned.id}/like`],
    ["POST", "/api/me/favorite-folders"],
    ["POST", "/api/media"],
    ["POST", "/api/me/avatar"],
    ["POST", "/api/me/emoji-packs"],
    ["POST", "/api/check-in"],
    ["PATCH", "/api/me/profile"],
    ["DELETE", `/api/me/posts/${owned.id}`],
    ["POST", "/api/me/password"],
  ])
    assert.equal(
      (await f.request(method, path, {}, member)).statusCode,
      403,
      path,
    );
  const manager = f.managers[0];
  await f.query(
    "UPDATE users SET banned_until=NOW()+INTERVAL '1 hour' WHERE uid=$1",
    [manager.user.uid],
  );
  assert.equal(
    (await f.request("GET", "/api/admin/users", undefined, manager)).statusCode,
    403,
  );
  await f.query(
    "UPDATE users SET banned_until=NOW()-INTERVAL '1 minute' WHERE uid=$1",
    [member.user.uid],
  );
  assert.equal(
    (
      await f.request(
        "POST",
        "/api/me/favorite-folders",
        { name: "解封后收藏" },
        member,
      )
    ).statusCode,
    201,
  );
});
