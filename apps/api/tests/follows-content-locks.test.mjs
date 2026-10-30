import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createManagementFixture } from "./helpers/management-fixture.mjs";

let f, author, reader, other, category;
const body = (text) => ({ blocks: [{ type: "paragraph", data: { text } }] });
const lock = (condition, text) =>
  `<span data-content-lock="${condition}">${text}</span>`;
async function create(text, user = author, extra = {}) {
  const response = await f.request(
    "POST",
    "/api/posts",
    {
      title: "关注和隐藏段落验收",
      categoryId: category.id,
      body: typeof text === "string" ? body(text) : text,
      ...extra,
    },
    user,
  );
  assert.equal(response.statusCode, 201, response.body);
  return response.json().post.id;
}
const get = async (id, user) => {
  const response = await f.request("GET", `/api/posts/${id}`, undefined, user);
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
};
const follow = (user, target = author, method = "PUT") =>
  f.request(method, `/api/users/${target.user.uid}/follow`, undefined, user);
before(async () => {
  f = await createManagementFixture();
  const users = [];
  for (const username of ["locks_author", "locks_reader", "locks_other"]) {
    const result = await f.request("POST", "/api/auth/register", {
      username,
      displayName: username,
      email: `${username}@example.test`,
      password: f.password,
    });
    assert.equal(result.statusCode, 201, result.body);
    users.push(result.json());
  }
  [author, reader, other] = users;
  category = (await f.request("GET", "/api/categories")).json()[0];
});
after(async () => {
  if (f) await f.close();
});

test("normal groups default to hidden-content permission; explicit choices and other group types are preserved", async () => {
  const me = (await f.request("GET", "/api/auth/me", undefined, author)).json();
  assert.ok(me.permissions.includes("posts.hide_content"));
  for (const [name, groupType, permissions, expected] of [
    ["默认隐藏段落", "normal", undefined, true],
    ["明确关闭隐藏段落", "normal", [], false],
    ["特殊组不自动添加", "special", undefined, false],
  ]) {
    const result = await f.request(
      "POST",
      "/api/admin/groups",
      { name, groupType, ...(permissions ? { permissions } : {}) },
      f.owner,
    );
    assert.equal(result.statusCode, 201, result.body);
    const groups = (
      await f.request("GET", "/api/admin/groups", undefined, f.owner)
    ).json();
    assert.equal(
      groups
        .find((g) => g.id === result.json().id)
        .permissions.includes("posts.hide_content"),
      expected,
    );
  }
});

test("follow operations are authenticated, idempotent, private, and blocked during bans", async () => {
  assert.equal((await follow(undefined)).statusCode, 401);
  assert.equal((await follow(reader, reader)).statusCode, 400);
  for (const id of ["bad", "0", "999999999999999999999"])
    assert.equal(
      (await f.request("PUT", `/api/users/${id}/follow`, undefined, reader))
        .statusCode,
      400,
    );
  assert.equal(
    (
      await f.request(
        "PUT",
        "/api/users/999999999999/follow",
        undefined,
        reader,
      )
    ).statusCode,
    404,
  );
  assert.equal((await follow(reader)).json().following, true);
  assert.equal((await follow(reader)).json().following, true);
  const profile = async (viewer) =>
    (
      await f.request("GET", `/api/users/${author.user.uid}`, undefined, viewer)
    ).json().user;
  assert.equal((await profile(reader)).following, true);
  assert.equal((await profile(reader)).follower_count, 1);
  assert.equal((await profile(other)).following, false);
  assert.equal((await profile()).following, false);
  assert.equal((await profile()).follower_count, 1);
  assert.equal((await follow(other)).json().following, true);
  assert.equal((await profile()).follower_count, 2);
  await follow(other, author, "DELETE");
  assert.equal((await profile(reader)).follower_count, 1);
  const mine = (
    await f.request("GET", "/api/me/following", undefined, reader)
  ).json();
  assert.equal(mine.length, 1);
  assert.equal(mine[0].uid, author.user.uid);
  assert.ok(!("email" in mine[0]) && !("password_hash" in mine[0]));
  assert.deepEqual(
    (await f.request("GET", "/api/me/following", undefined, other)).json(),
    [],
  );
  await f.query(
    "UPDATE users SET banned_until=NOW()+INTERVAL '1 day' WHERE uid=$1",
    [reader.user.uid],
  );
  assert.equal((await follow(reader, author, "DELETE")).statusCode, 403);
  assert.equal(
    (await f.request("GET", "/api/me/following", undefined, reader)).statusCode,
    200,
  );
  await f.query("UPDATE users SET banned_until=NULL WHERE uid=$1", [
    reader.user.uid,
  ]);
  assert.equal(
    (await follow(reader, author, "DELETE")).json().following,
    false,
  );
  assert.equal((await profile(reader)).following, false);
  assert.equal((await profile()).follower_count, 0);
  assert.equal(
    (await follow(reader, author, "DELETE")).json().following,
    false,
  );
});

test("home prioritizes unread followed posts after pins; detail views remove priority only for that account", async () => {
  const older = await create("关注作者的旧帖");
  const newer = await create("未关注作者的新帖", other);
  const pinned = await create("置顶帖子", other);
  await f.query(
    "UPDATE posts SET created_at=NOW()-INTERVAL '2 days' WHERE id=$1",
    [older],
  );
  await f.query("UPDATE posts SET is_pinned=TRUE WHERE id=$1", [pinned]);
  await follow(reader);
  const feed = async (query = "", user = reader) =>
    (await f.request("GET", `/api/posts${query}`, undefined, user))
      .json()
      .map((p) => p.id);
  assert.deepEqual((await feed()).slice(0, 3), [pinned, older, newer]);
  await get(older, other);
  assert.ok((await feed()).indexOf(older) < (await feed()).indexOf(newer));
  assert.ok(
    (await feed("?followingFirst=false&sort=popular")).indexOf(newer) <
      (await feed("?followingFirst=false&sort=popular")).indexOf(older),
  );
  assert.ok(
    (await feed(`?category=${category.id}`)).indexOf(newer) <
      (await feed(`?category=${category.id}`)).indexOf(older),
  );
  await get(older, reader);
  assert.ok((await feed()).indexOf(newer) < (await feed()).indexOf(older));
  const fresh = await create("同一作者的新未读帖子");
  assert.equal((await feed())[1], fresh);
  await f.query("UPDATE posts SET status='hidden' WHERE id=$1", [fresh]);
  assert.ok(!(await feed()).includes(fresh));
  await follow(reader, author, "DELETE");
});

test("each lock unlocks for its own condition, refreshes, relocks, and stays private to the viewer", async () => {
  const id = await create(
    `公开引言 ${lock("reply", "<b>回复秘密</b>")} ${lock("like", "点赞秘密")} ${lock("follow", "关注秘密")}`,
  );
  const content = async (user) =>
    JSON.stringify((await get(id, user)).post.body);
  assert.match(await content(author), /回复秘密/);
  for (const user of [undefined, reader]) {
    const text = await content(user);
    assert.doesNotMatch(text, /回复秘密|点赞秘密|关注秘密/);
    assert.match(text, /公开引言/);
    assert.match(text, /data-lock-state/);
  }
  await f.request("POST", `/api/posts/${id}/like`, undefined, reader);
  assert.match(await content(reader), /点赞秘密/);
  assert.doesNotMatch(await content(reader), /回复秘密|关注秘密/);
  await f.request("POST", `/api/posts/${id}/like`, undefined, reader);
  assert.doesNotMatch(await content(reader), /点赞秘密/);
  await follow(reader);
  assert.equal((await get(id, reader)).following, true);
  assert.match(await content(reader), /关注秘密/);
  assert.doesNotMatch(await content(other), /关注秘密/);
  await follow(reader, author, "DELETE");
  assert.doesNotMatch(await content(reader), /关注秘密/);
  const result = await f.request(
    "POST",
    `/api/posts/${id}/replies`,
    { body: body("参与讨论") },
    reader,
  );
  assert.equal(result.statusCode, 201, result.body);
  assert.match(await content(reader), /<b>回复秘密<\/b>/);
  assert.doesNotMatch(await content(other), /回复秘密/);
  assert.equal(
    (
      await f.request(
        "DELETE",
        `/api/posts/${id}/replies/${result.json().reply.id}`,
        undefined,
        reader,
      )
    ).statusCode,
    200,
  );
  assert.doesNotMatch(await content(reader), /回复秘密/);
  const root = await f.request(
    "POST",
    `/api/posts/${id}/replies`,
    { body: body("主楼") },
    author,
  );
  const child = await f.request(
    "POST",
    `/api/posts/${id}/replies`,
    { body: body("楼中楼也可解锁"), parentReplyId: root.json().reply.id },
    reader,
  );
  assert.equal(child.statusCode, 201, child.body);
  assert.match(await content(reader), /回复秘密/);
});

test("public feeds, search, user spaces and public folders redact complete hidden subtrees", async () => {
  const id = await create({
    blocks: [
      {
        type: "paragraph",
        data: {
          text: `公开可搜索 ${lock("like", '<a href="https://example.test/secret-url">hiddenNeedle</a>')}`,
        },
      },
      {
        type: "list",
        data: {
          style: "unordered",
          items: [
            {
              content: lock("reply", '<span class="nested">listNeedle</span>'),
              items: [],
            },
          ],
        },
      },
      {
        type: "quote",
        data: { text: "引用内容", caption: lock("follow", "captionNeedle") },
      },
    ],
  });
  const folder = (
    await f.request(
      "POST",
      "/api/me/favorite-folders",
      { name: "公开隐藏测试", isPublic: true },
      author,
    )
  ).json();
  assert.equal(
    (
      await f.request(
        "POST",
        `/api/me/favorite-folders/${folder.id}/posts/${id}`,
        undefined,
        author,
      )
    ).statusCode,
    200,
  );
  for (const path of [
    "/api/posts",
    `/api/users/${author.user.uid}`,
    `/api/favorite-folders/${folder.id}`,
  ]) {
    const result = await f.request("GET", path);
    assert.equal(result.statusCode, 200, result.body);
    assert.doesNotMatch(
      result.body,
      /hiddenNeedle|listNeedle|captionNeedle|secret-url/,
    );
  }
  for (const needle of [
    "hiddenNeedle",
    "listNeedle",
    "captionNeedle",
    "secret-url",
  ]) {
    const result = await f.request("GET", `/api/posts?q=${needle}`);
    assert.deepEqual(result.json(), []);
  }
  const publicResult = (
    await f.request("GET", "/api/posts?q=公开可搜索")
  ).json();
  assert.equal(publicResult[0].id, id);
});

test("permission revocation, expiry, invalid locks, reply locks and hidden text limits are enforced by API", async () => {
  for (const text of [
    lock("invalid", "内容"),
    lock("like", lock("reply", "内容")),
    '<div data-content-lock="like">内容</div>',
    '<span data-content-lock="like" title="泄露">内容</span>',
  ]) {
    const result = await f.request(
      "POST",
      "/api/posts",
      { title: "无效锁定测试", categoryId: category.id, body: body(text) },
      author,
    );
    assert.equal(result.statusCode, 400, result.body);
  }
  const id = await create("回复不能设置内容锁定");
  assert.equal(
    (
      await f.request(
        "POST",
        `/api/posts/${id}/replies`,
        { body: body(lock("like", "回复锁定")) },
        reader,
      )
    ).statusCode,
    400,
  );
  const oversized = await f.request(
    "POST",
    "/api/posts",
    {
      title: "隐藏文字仍受字数限制",
      categoryId: category.id,
      body: body(lock("like", "字".repeat(20001))),
    },
    author,
  );
  assert.equal(oversized.statusCode, 400);
  assert.match(oversized.body, /最多 20000 字/);
  await f.query(
    "UPDATE group_memberships SET expires_at=NOW()-INTERVAL '1 day' WHERE user_uid=$1",
    [reader.user.uid],
  );
  const denied = await f.request(
    "POST",
    "/api/posts",
    {
      title: "过期权限测试",
      categoryId: category.id,
      body: body(lock("like", "隐藏内容")),
    },
    reader,
  );
  assert.equal(denied.statusCode, 403);
  await f.query(
    "UPDATE group_memberships SET expires_at=NULL WHERE user_uid=$1",
    [reader.user.uid],
  );
  await f.query(
    "DELETE FROM group_permissions WHERE permission_key='posts.hide_content'",
  );
  const result = await f.request(
    "POST",
    "/api/posts",
    {
      title: "撤销权限测试",
      categoryId: category.id,
      body: body(lock("like", "隐藏内容")),
    },
    author,
  );
  assert.equal(result.statusCode, 403);
  assert.match(result.body, /隐藏段落权限/);
  await create("没有隐藏权限仍可正常发帖");
  const literal = '<span data-content-lock="like">这只是代码示例</span>';
  const codeId = await create({
    blocks: [
      { type: "code", data: { code: literal } },
      { type: "spoiler", data: { text: literal } },
    ],
  });
  const code = await get(codeId, reader);
  assert.equal(code.post.body.blocks[0].data.code, literal);
  assert.equal(code.post.body.blocks[1].data.text, literal);
  const literalSearch = (await f.request("GET", "/api/posts?q=%3Cspan")).json();
  assert.ok(literalSearch.some((post) => post.id === codeId));
});
