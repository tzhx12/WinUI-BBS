import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readdir, readFile } from "node:fs/promises";
import Fastify from "fastify";
import { createManagementFixture } from "./helpers/management-fixture.mjs";

let f, remote, base, member, other, large, local, community, category, settings;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWioAAAAASUVORK5CYII=",
  "base64",
);
async function register(name) {
  const result = await f.request("POST", "/api/auth/register", {
    username: name,
    displayName: name,
    email: `${name}@example.test`,
    password: f.password,
  });
  assert.equal(result.statusCode, 201, result.body);
  return result.json();
}
async function configure(limits = {}, remoteSettings = {}) {
  settings = (
    await f.request("GET", "/api/admin/media-settings", undefined, f.owner)
  ).json();
  const result = await f.request(
    "PATCH",
    "/api/admin/media-settings",
    {
      mediaLimits: { ...settings.media_limits, ...limits },
      remoteEmoji: { ...settings.remote_emoji, ...remoteSettings },
    },
    f.owner,
  );
  assert.equal(result.statusCode, 200, result.body);
}
const imported = (id, user = member, extra = {}) =>
  f.request(
    "POST",
    "/api/me/remote-emoji/import",
    { remoteId: id, variant: "static", ...extra },
    user,
  );
const usage = async (user = member) =>
  (await f.request("GET", "/api/me/media-usage", undefined, user)).json();
before(async () => {
  f = await createManagementFixture();
  member = await register("emoji_member");
  other = await register("emoji_other");
  category = (await f.request("GET", "/api/categories")).json()[0];
  remote = Fastify();
  remote.get("/info", async (request) => {
    const id = Number(request.query.id);
    return {
      id,
      text: `远端分组 ${id}`,
      emote: Array.from({ length: id === 1 ? 151 : 2 }, (_, i) => ({
        text: `表情 ${id}-${i + 1}`,
        url: `${base}/${id === 9 && i === 1 ? "bad" : "image"}.png`,
        gif_url: "",
        type: 1,
      })),
    };
  });
  remote.get("/image.png", async (_request, reply) =>
    reply.type("image/png").send(png),
  );
  remote.get("/bad.png", async (_request, reply) =>
    reply.code(502).send("failed"),
  );
  await remote.listen({ host: "127.0.0.1", port: 0 });
  base = `http://127.0.0.1:${remote.server.address().port}`;
});
after(async () => {
  if (remote) await remote.close();
  if (f) await f.close();
});

test("empty community stays hidden; remote groups can exceed 150 and expose previews", async () => {
  const defaults = (
    await f.request("GET", "/api/admin/media-settings", undefined, f.owner)
  ).json();
  assert.equal(defaults.remote_emoji.countTowardPackLimit, true);
  assert.deepEqual(
    (await f.request("GET", "/api/emoji-packs", undefined, member)).json(),
    [],
  );
  await configure(
    { emojiPackCount: 2 },
    { enabled: true, apiUrl: base, sourceUrl: base },
  );
  const result = await imported(1);
  assert.equal(result.statusCode, 201, result.body);
  large = result.json();
  const packs = (
    await f.request("GET", "/api/me/emoji-packs", undefined, member)
  ).json();
  const pack = packs.find((p) => p.id === large.id);
  assert.equal(pack.emoji_count, 151);
  assert.equal(pack.preview_urls.length, 4);
  assert.equal((await usage()).uploadedPacks, 1);
  assert.equal((await usage()).usedBytes, 0);
  assert.equal(
    (await f.request("GET", "/api/emoji-packs", undefined, member)).json()[0]
      .emojis.length,
    151,
  );
});

test("local and remote groups share the limit; duplicate imports are idempotent; switch excludes remote groups", async () => {
  let result = await f.request(
    "POST",
    "/api/me/emoji-packs",
    { name: "我的上传组" },
    member,
  );
  assert.equal(result.statusCode, 201, result.body);
  local = result.json();
  assert.equal((await usage()).uploadedPacks, 2);
  assert.equal((await imported(2)).statusCode, 409);
  assert.equal(
    (
      await f.request(
        "POST",
        "/api/me/emoji-packs",
        { name: "超出限额" },
        member,
      )
    ).statusCode,
    409,
  );
  assert.equal((await imported(1)).statusCode, 201);
  await configure({}, { countTowardPackLimit: false });
  assert.equal((await usage()).uploadedPacks, 1);
  assert.equal((await imported(2)).statusCode, 201);
  assert.equal((await usage()).uploadedPacks, 1);
  await configure({}, { countTowardPackLimit: true });
  assert.equal((await usage()).uploadedPacks, 3);
});

test("personal ordering persists for local and remote packs without changing another user", async () => {
  assert.equal((await imported(1, other)).statusCode, 201);
  const packs = (
    await f.request("GET", "/api/me/emoji-packs", undefined, member)
  ).json();
  const ids = packs.map((p) => p.id).reverse();
  const before = (
    await f.request("GET", "/api/me/emoji-packs", undefined, other)
  ).json();
  const saved = await f.request(
    "PUT",
    "/api/me/emoji-pack-order",
    { packIds: ids },
    member,
  );
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual(
    (await f.request("GET", "/api/me/emoji-packs", undefined, member))
      .json()
      .map((p) => p.id),
    ids,
  );
  assert.deepEqual(
    (await f.request("GET", "/api/me/emoji-packs", undefined, other)).json(),
    before,
  );
  const visible = (
    await f.request("GET", "/api/emoji-packs", undefined, member)
  ).json();
  assert.deepEqual(
    visible.map((p) => p.id),
    ids.filter((id) => id !== local.id),
  );
  assert.equal(
    (
      await f.request(
        "PUT",
        "/api/me/emoji-pack-order",
        { packIds: [large.id, large.id] },
        member,
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.request(
        "PUT",
        "/api/me/emoji-pack-order",
        { packIds: [local.id] },
        other,
      )
    ).statusCode,
    409,
  );
});

test("community import is singular, pinned, exempt from quota and immutable to users", async () => {
  await configure({ emojiPackCount: 0 });
  const result = await f.request(
    "POST",
    "/api/admin/remote-emoji/import",
    { remoteId: 3, variant: "static", community: true },
    f.owner,
  );
  assert.equal(result.statusCode, 201, result.body);
  community = result.json();
  const packs = (
    await f.request("GET", "/api/emoji-packs", undefined, member)
  ).json();
  assert.equal(packs[0].id, community.id);
  assert.equal(packs[0].is_community, true);
  assert.equal((await usage()).uploadedPacks, 3);
  assert.equal((await imported(3)).statusCode, 201);
  assert.equal((await usage()).uploadedPacks, 3);
  assert.equal(
    (await imported(4, member, { community: true })).statusCode,
    403,
  );
  assert.equal(
    (
      await f.request(
        "DELETE",
        `/api/me/emoji-packs/${community.id}`,
        undefined,
        member,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.request(
        "PATCH",
        `/api/me/emoji-packs/${community.id}`,
        { name: "修改社区组", sortOrder: -9 },
        member,
      )
    ).statusCode,
    404,
  );
  const personal = (
    await f.request("GET", "/api/me/emoji-packs", undefined, member)
  ).json();
  assert.equal(personal[0].id, community.id);
  assert.equal(
    (
      await f.request(
        "PUT",
        "/api/me/emoji-pack-order",
        { packIds: personal.map((p) => p.id) },
        member,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await f.request(
        "PUT",
        "/api/admin/community-emoji-pack",
        { packId: local.id },
        f.owner,
      )
    ).statusCode,
    404,
  );
});

test("post-only and reply-only users send community emoji without media permission", async () => {
  let postId;
  for (const permission of ["posts.create", "replies.create"]) {
    const user = await register(
      permission === "posts.create" ? "emoji_poster" : "emoji_replier",
    );
    const group = (
      await f.request(
        "POST",
        "/api/admin/groups",
        { name: permission, groupType: "special", permissions: [permission] },
        f.owner,
      )
    ).json();
    await f.query("DELETE FROM group_memberships WHERE user_uid=$1", [
      user.user.uid,
    ]);
    await f.request(
      "POST",
      `/api/admin/groups/${group.id}/memberships`,
      { userUid: user.user.uid },
      f.owner,
    );
    assert.equal(
      (await f.request("GET", "/api/me/media-usage", undefined, user))
        .statusCode,
      403,
    );
    const pack = (
      await f.request("GET", "/api/emoji-packs", undefined, user)
    ).json()[0];
    assert.equal(pack.id, community.id);
    const body = {
      blocks: [
        {
          type: "emoji",
          data: { url: pack.emojis[0].url, name: pack.emojis[0].name },
        },
      ],
    };
    if (permission === "posts.create") {
      const sent = await f.request(
        "POST",
        "/api/posts",
        { title: "社区表情发送测试", categoryId: category.id, body },
        user,
      );
      assert.equal(sent.statusCode, 201, sent.body);
      postId = sent.json().post.id;
      assert.equal(
        (
          await f.request(
            "POST",
            `/api/posts/${postId}/replies`,
            { body },
            user,
          )
        ).statusCode,
        403,
      );
    } else {
      const sent = await f.request(
        "POST",
        `/api/posts/${postId}/replies`,
        { body },
        user,
      );
      assert.equal(sent.statusCode, 201, sent.body);
      assert.equal(
        (
          await f.request(
            "POST",
            "/api/posts",
            { title: "没有发帖权限", categoryId: category.id, body },
            user,
          )
        ).statusCode,
        403,
      );
    }
  }
});

test("remote inline emoji preserve surrounding text, count toward image limits and reject forged images", async () => {
  const pack = (
    await f.request("GET", "/api/emoji-packs", undefined, member)
  ).json()[0];
  const emoji = pack.emojis[0];
  assert.equal(emoji.remote, true);
  const markup = `<img data-remote-emoji="${emoji.id}" src="${emoji.url}" alt="开心">`;
  const body = (text) => ({ blocks: [{ type: "paragraph", data: { text } }] });
  const sent = await f.request(
    "POST",
    "/api/posts",
    {
      title: "远端行内表情测试",
      categoryId: category.id,
      body: body(`前文${markup}后文`),
    },
    member,
  );
  assert.equal(sent.statusCode, 201, sent.body);
  const post = (
    await f.request(
      "GET",
      `/api/posts/${sent.json().post.id}`,
      undefined,
      member,
    )
  ).json().post;
  assert.equal(post.body.blocks[0].data.text, `前文${markup}后文`);
  const reply = await f.request(
    "POST",
    `/api/posts/${post.id}/replies`,
    { body: body(markup) },
    member,
  );
  assert.equal(reply.statusCode, 201, reply.body);
  const overflow = await f.request(
    "POST",
    `/api/posts/${post.id}/replies`,
    { body: body(markup.repeat(6)) },
    member,
  );
  assert.equal(overflow.statusCode, 400, overflow.body);
  assert.match(overflow.json().message, /最多 5 张/);
  for (const forged of [
    markup.replace(emoji.url, "https://example.test/tracker.png"),
    '<img src="/uploads/fake.png">',
    markup.replace(emoji.id, "bad-id"),
  ]) {
    const response = await f.request(
      "POST",
      `/api/posts/${post.id}/replies`,
      { body: body(forged) },
      member,
    );
    assert.equal(response.statusCode, 400, response.body);
  }
  const localAsset = await f.query(
    `INSERT INTO media_assets(storage_key,original_name,mime_type,byte_size,collection,emoji_pack_id,created_by)
    VALUES('local-inline-test.png','local.png','image/png',1,'emoji',$1,$2) RETURNING id`,
    [local.id, member.user.uid],
  );
  const localMarkup = `<img data-remote-emoji="${localAsset.rows[0].id}" src="/uploads/local-inline-test.png">`;
  assert.equal(
    (
      await f.request(
        "POST",
        `/api/posts/${post.id}/replies`,
        { body: body(localMarkup) },
        member,
      )
    ).statusCode,
    400,
  );
  await f.query("DELETE FROM media_assets WHERE id=$1", [
    localAsset.rows[0].id,
  ]);
});

test("migration identifies historical remote blocks and preserves personal upload sizes", async () => {
  const pack = (
    await f.request("GET", "/api/emoji-packs", undefined, member)
  ).json()[0];
  const remote = pack.emojis[0];
  const body = {
    blocks: [
      { type: "paragraph", data: { text: "历史文字" } },
      { type: "emoji", data: { url: remote.url, name: remote.name } },
      {
        type: "emoji",
        data: { url: "/uploads/personal-historical.png", name: "个人上传" },
      },
    ],
  };
  const sent = await f.request(
    "POST",
    "/api/posts",
    { title: "历史表情迁移测试", categoryId: category.id, body },
    member,
  );
  assert.equal(sent.statusCode, 201, sent.body);
  const postId = sent.json().post.id;
  const reply = await f.request(
    "POST",
    `/api/posts/${postId}/replies`,
    { body },
    member,
  );
  assert.equal(reply.statusCode, 201, reply.body);
  await f.query(
    await readFile(
      new URL("../migrations/014_remote_inline_emoji.sql", import.meta.url),
      "utf8",
    ),
  );
  for (const [table, id] of [
    ["posts", postId],
    ["replies", reply.json().reply.id],
  ]) {
    const stored = (
      await f.query(`SELECT body FROM ${table} WHERE id=$1`, [id])
    ).rows[0].body;
    assert.equal(stored.blocks[0].data.text, "历史文字");
    assert.equal(stored.blocks[1].data.remote, true);
    assert.equal(stored.blocks[1].data.emojiId, remote.id);
    assert.equal(stored.blocks[2].data.remote, undefined);
    assert.equal(stored.blocks[2].data.url, "/uploads/personal-historical.png");
  }
});

test("admin image search paginates at 50 with stable ordering, combined filters and literal matching", async () => {
  const first = await f.request(
    "GET",
    "/api/admin/media/search",
    undefined,
    f.owner,
  );
  assert.equal(first.statusCode, 200, first.body);
  const one = first.json();
  assert.equal(one.pageSize, 50);
  assert.equal(one.items.length, 50);
  const two = (
    await f.request("GET", "/api/admin/media/search?page=2", undefined, f.owner)
  ).json();
  assert.equal(two.items.length, 50);
  assert.ok(
    two.items.every((item) => !one.items.some((old) => old.id === item.id)),
  );
  const filtered = (
    await f.request(
      "GET",
      `/api/admin/media/search?collection=emoji&packId=${large.id}&q=${encodeURIComponent("远端分组 1")}&page=4`,
      undefined,
      f.owner,
    )
  ).json();
  assert.equal(filtered.total, 151);
  assert.equal(filtered.page, 4);
  assert.equal(filtered.items.length, 1);
  const literal = (
    await f.request("GET", "/api/admin/media/search?q=%25", undefined, f.owner)
  ).json();
  assert.equal(literal.total, 0);
  const clamped = (
    await f.request(
      "GET",
      "/api/admin/media/search?page=9999",
      undefined,
      f.owner,
    )
  ).json();
  assert.equal(clamped.page, clamped.totalPages);
  assert.equal(
    (await f.request("GET", "/api/admin/media/search", undefined, member))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await f.request(
        "GET",
        "/api/admin/media/search?page=0",
        undefined,
        f.owner,
      )
    ).statusCode,
    400,
  );
});

test("community replacement and removal preserve cache; failed imports roll back files; concurrent imports respect limit", async () => {
  const old = community.id;
  const result = await f.request(
    "POST",
    "/api/admin/remote-emoji/import",
    { remoteId: 4, variant: "static", community: true },
    f.owner,
  );
  assert.equal(result.statusCode, 201, result.body);
  community = result.json();
  assert.equal(
    (await f.query("SELECT id FROM emoji_packs WHERE is_community")).rowCount,
    1,
  );
  assert.equal(
    (await f.request("GET", "/api/emoji-packs", undefined, other)).json()[0].id,
    community.id,
  );
  assert.equal(
    (await f.request("GET", "/api/emoji-packs", undefined, other))
      .json()
      .some((p) => p.id === old),
    false,
  );
  await f.request(
    "PUT",
    "/api/admin/community-emoji-pack",
    { packId: null },
    f.owner,
  );
  assert.equal(
    (await f.query("SELECT id FROM emoji_packs WHERE is_community")).rowCount,
    0,
  );
  assert.ok(
    (await f.query("SELECT id FROM media_assets WHERE emoji_pack_id=$1", [old]))
      .rowCount,
  );
  await configure({ emojiPackCount: 1 });
  const user = await register("emoji_concurrent");
  const beforeFiles = await readdir(f.uploadRoot);
  assert.equal((await imported(9, user)).statusCode, 502);
  assert.deepEqual(await readdir(f.uploadRoot), beforeFiles);
  assert.equal((await usage(user)).uploadedPacks, 0);
  const results = await Promise.all([imported(5, user), imported(6, user)]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 409]);
  assert.equal((await usage(user)).uploadedPacks, 1);
});
