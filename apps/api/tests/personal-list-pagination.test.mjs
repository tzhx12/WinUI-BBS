import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createManagementFixture } from "./helpers/management-fixture.mjs";

let f, folder, privateFolder, orderedPosts, orderedImages;
before(async () => {
  f = await createManagementFixture();
  const category = (await f.request("GET", "/api/categories")).json()[0];
  folder = (
    await f.request(
      "POST",
      "/api/me/favorite-folders",
      { name: "分页公开收藏", isPublic: true },
      f.owner,
    )
  ).json();
  privateFolder = (
    await f.request(
      "POST",
      "/api/me/favorite-folders",
      { name: "分页私密收藏" },
      f.owner,
    )
  ).json();
  await f.query(
    `INSERT INTO posts(category_id,author_uid,title,body,created_at)
    SELECT $1,$2,'收藏分页 '||n,$3::jsonb,'2026-01-01'::timestamptz FROM generate_series(1,73) n`,
    [
      category.id,
      f.owner.user.uid,
      JSON.stringify({
        blocks: [
          {
            type: "paragraph",
            data: {
              text: '公开摘要<span data-content-lock="reply">隐藏秘密</span>',
            },
          },
        ],
      }),
    ],
  );
  await f.query(
    `INSERT INTO favorites(folder_id,post_id,created_at)
    SELECT $1,id,'2026-01-01'::timestamptz FROM posts WHERE title LIKE '收藏分页 %'`,
    [folder.id],
  );
  for (const [title, status, level, deleted] of [
    ["隐藏收藏", "hidden", 0, false],
    ["待审收藏", "pending", 0, false],
    ["高级收藏", "published", 10000, false],
    ["删除收藏", "published", 0, true],
  ]) {
    const inserted = await f.query(
      `INSERT INTO posts(category_id,author_uid,title,body,status,minimum_reader_level,deleted_at)
      VALUES($1,$2,$3,'{"blocks":[]}'::jsonb,$4,$5,CASE WHEN $6 THEN NOW() END) RETURNING id`,
      [category.id, f.owner.user.uid, title, status, level, deleted],
    );
    await f.query("INSERT INTO favorites(folder_id,post_id) VALUES($1,$2)", [
      folder.id,
      inserted.rows[0].id,
    ]);
  }
  orderedPosts = (
    await f.query(
      "SELECT id FROM posts WHERE title LIKE '收藏分页 %' ORDER BY id DESC",
    )
  ).rows.map((row) => row.id);
  await f.query(
    `INSERT INTO media_assets(storage_key,original_name,mime_type,byte_size,created_by,created_at)
    SELECT 'personal-page-'||n||'.png','分页图片 '||n||'.png','image/png',68,$1,'2026-01-01'::timestamptz
    FROM generate_series(1,127) n`,
    [f.owner.user.uid],
  );
  await f.query(
    `INSERT INTO media_assets(storage_key,original_name,mime_type,byte_size,created_by,collection)
    VALUES('page-avatar.png','头像','image/png',68,$1,'avatar'),('page-other.png','他人图片','image/png',68,$2,'library')`,
    [f.owner.user.uid, f.managers[0].user.uid],
  );
  orderedImages = (
    await f.query(
      "SELECT id FROM media_assets WHERE created_by=$1 AND collection<>'avatar' ORDER BY created_at DESC,id DESC",
      [f.owner.user.uid],
    )
  ).rows.map((row) => row.id);
});
after(async () => {
  await f?.close();
});

test("favorite pages preserve complete legacy results, visible totals, order, locks and privacy", async () => {
  const legacy = await f.request("GET", `/api/favorite-folders/${folder.id}`);
  assert.equal(legacy.statusCode, 200, legacy.body);
  assert.equal(legacy.json().posts.length, 73);
  assert.equal(legacy.json().page, undefined);
  const ids = [];
  for (let page = 1; page <= 4; page++) {
    const response = await f.request(
      "GET",
      `/api/favorite-folders/${folder.id}?page=${page}`,
    );
    assert.equal(response.statusCode, 200, response.body);
    const result = response.json();
    assert.equal(result.total, 73);
    assert.equal(result.pageSize, 20);
    assert.equal(result.page, page);
    assert.equal(result.totalPages, 4);
    assert.equal(result.posts.length, page === 4 ? 13 : 20);
    assert.ok(!JSON.stringify(result.posts).includes("隐藏秘密"));
    ids.push(...result.posts.map((post) => post.id));
  }
  assert.deepEqual(ids, orderedPosts);
  const last = (
    await f.request("GET", `/api/favorite-folders/${folder.id}?page=99999`)
  ).json();
  assert.equal(last.page, 4);
  for (const value of ["0", "-1", "1.2", "bad"])
    assert.equal(
      (
        await f.request(
          "GET",
          `/api/favorite-folders/${folder.id}?page=${value}`,
        )
      ).statusCode,
      400,
    );
  assert.equal(
    (await f.request("GET", `/api/favorite-folders/${privateFolder.id}?page=1`))
      .statusCode,
    404,
  );
  const empty = (
    await f.request(
      "GET",
      `/api/favorite-folders/${privateFolder.id}?page=2`,
      undefined,
      f.owner,
    )
  ).json();
  assert.equal(empty.total, 0);
  assert.equal(empty.page, 1);
  await f.query(
    "DELETE FROM favorites WHERE folder_id=$1 AND post_id=ANY($2::uuid[])",
    [folder.id, ids.slice(60)],
  );
  const shrunk = (
    await f.request("GET", `/api/favorite-folders/${folder.id}?page=4`)
  ).json();
  assert.equal(shrunk.total, 60);
  assert.equal(shrunk.page, 3);
  const limits = (
    await f.request("GET", "/api/admin/content-settings", undefined, f.owner)
  ).json();
  assert.equal(
    (
      await f.request(
        "PATCH",
        "/api/admin/content-settings",
        { ...limits, postsPerPage: 10 },
        f.owner,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (await f.request("GET", `/api/favorite-folders/${folder.id}?page=1`)).json()
      .posts.length,
    10,
  );
});

test("personal media pages exclude avatars and other owners; legacy and admin access retain their contract", async () => {
  const legacy = (
    await f.request("GET", "/api/me/media", undefined, f.owner)
  ).json();
  assert.equal(legacy.length, 127);
  const ids = [];
  for (let page = 1; page <= 3; page++) {
    const response = await f.request(
      "GET",
      `/api/me/media?page=${page}`,
      undefined,
      f.owner,
    );
    assert.equal(response.statusCode, 200, response.body);
    const result = response.json();
    assert.equal(result.total, 127);
    assert.equal(result.pageSize, 50);
    assert.equal(result.items.length, page === 3 ? 27 : 50);
    assert.ok(
      result.items.every(
        (item) =>
          item.created_by === f.owner.user.uid && item.collection !== "avatar",
      ),
    );
    ids.push(...result.items.map((item) => item.id));
  }
  assert.deepEqual(ids, orderedImages);
  assert.equal(
    (
      await f.request("GET", "/api/me/media?page=99999", undefined, f.owner)
    ).json().page,
    3,
  );
  assert.equal(
    (
      await f.request(
        "GET",
        "/api/me/media?collection=avatar&page=1",
        undefined,
        f.owner,
      )
    ).json().total,
    0,
  );
  assert.equal(
    (await f.request("GET", "/api/me/media?page=1")).statusCode,
    401,
  );
  assert.equal(
    (await f.request("GET", "/api/me/media?page=0", undefined, f.owner))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await f.request("GET", "/api/admin/media?page=1", undefined, f.owner)
    ).json().total,
    129,
  );
  const forbidden = f.managers.find(
    (manager) => manager.permission === "users.manage",
  );
  assert.equal(
    (await f.request("GET", "/api/admin/media?page=1", undefined, forbidden))
      .statusCode,
    403,
  );
  await f.query("DELETE FROM media_assets WHERE id=ANY($1::uuid[])", [
    ids.slice(100),
  ]);
  const shrunk = (
    await f.request("GET", "/api/me/media?page=3", undefined, f.owner)
  ).json();
  assert.equal(shrunk.total, 100);
  assert.equal(shrunk.page, 2);
});
