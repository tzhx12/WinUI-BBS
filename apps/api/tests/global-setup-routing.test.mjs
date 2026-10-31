import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createManagementFixture } from "./helpers/management-fixture.mjs";

let f, globalGroup, entryToken, initial;
const payload = {
  username: "setup_probe",
  displayName: "Setup probe",
  email: "probe@example.test",
  password: "setup-test-password",
};
before(async () => {
  f = await createManagementFixture({
    configure: async (app) => {
      const { query } = await import("../src/db.ts");
      const { setupPath } = await import("../src/setup.ts");
      await query("SELECT setval(pg_get_serial_sequence('users', 'uid'), 37, TRUE)");
      entryToken = (await query("SELECT setup_token FROM installation_state"))
        .rows[0].setup_token;
      initial = {
        public: (await app.inject("/api/setup/status")).json(),
        authorized: (
          await app.inject({
            url: "/api/setup/status",
            headers: { "x-setup-token": entryToken },
          })
        ).json(),
        absent: await app.inject({
          method: "POST",
          url: "/api/setup/initialize",
          payload,
        }),
        wrong: await app.inject({
          method: "POST",
          url: "/api/setup/initialize",
          payload,
          headers: { "x-setup-token": "wrong" },
        }),
        invalid: await app.inject({
          method: "POST",
          url: "/api/setup/initialize",
          payload: {},
          headers: { "x-setup-token": entryToken },
        }),
        registration: await app.inject({
          method: "POST",
          url: "/api/auth/register",
          payload,
        }),
        path: await setupPath(),
        samePath: await setupPath(),
      };
    },
  });
  globalGroup = (
    await f.request("GET", "/api/admin/groups", undefined, f.owner)
  )
    .json()
    .find((g) => g.group_type === "global");
});
after(async () => {
  if (f) await f.close();
});
const request = (method, path, body, user = f.owner) =>
  f.request(method, path, body, user);

test("setup exposes no entry publicly, requires its durable secret, and blocks registration before UID 1 exists", () => {
  assert.match(entryToken, /^[a-f0-9]{64}$/);
  assert.deepEqual(initial.public, { required: true, allowed: false });
  assert.deepEqual(initial.authorized, { required: true, allowed: true });
  assert.equal(initial.absent.statusCode, 404);
  assert.equal(initial.wrong.statusCode, 404);
  assert.equal(initial.invalid.statusCode, 400);
  assert.equal(initial.registration.statusCode, 403);
  assert.equal(initial.path, `/#/setup/${entryToken}`);
  assert.equal(initial.path, initial.samePath);
});

test("successful initialization consumes the secret and permanently closes the setup API", async () => {
  assert.equal(f.owner.user.uid, "1");
  assert.equal(
    (await f.query("SELECT setup_token FROM installation_state")).rows[0]
      .setup_token,
    null,
  );
  assert.deepEqual((await f.app.inject("/api/setup/status")).json(), {
    required: false,
    allowed: false,
  });
  const repeated = await f.app.inject({
    method: "POST",
    url: "/api/setup/initialize",
    payload,
    headers: { "x-setup-token": entryToken },
  });
  assert.equal(repeated.statusCode, 404);
  assert.equal(await (await import("../src/setup.ts")).setupPath(), null);
});

test("global administrator group owns all permissions and UID 1 is a permanent member", async () => {
  const { permissionKeys } = await import("../src/permissions.ts");
  assert.deepEqual(
    [...globalGroup.permissions].sort(),
    [...permissionKeys].sort(),
  );
  assert.equal(globalGroup.is_protected, true);
  assert.equal(globalGroup.is_default, false);
  const memberships = (
    await request("GET", `/api/admin/groups/${globalGroup.id}/memberships`)
  ).json();
  assert.ok(memberships.some((m) => m.uid === "1" && m.expires_at === null));
});

test("global type, permissions and UID 1 membership resist API and direct database changes", async () => {
  const path = `/api/admin/groups/${globalGroup.id}`;
  assert.equal(
    (
      await request("POST", "/api/admin/groups", {
        name: "Duplicate global",
        groupType: "global",
      })
    ).statusCode,
    400,
  );
  const other = f.managers[0].groupId;
  assert.equal(
    (
      await request("PATCH", `/api/admin/groups/${other}`, {
        groupType: "global",
      })
    ).statusCode,
    400,
  );
  assert.equal((await request("DELETE", path)).statusCode, 403);
  for (const body of [
    { groupType: "special" },
    { permissions: ["groups.manage"] },
    { isJoinable: true },
  ])
    assert.equal((await request("PATCH", path, body)).statusCode, 400);
  assert.equal(
    (await request("DELETE", `${path}/memberships/1`)).statusCode,
    403,
  );
  assert.equal(
    (
      await request("POST", `${path}/memberships`, {
        userUid: "1",
        expiresAt: "2099-01-01T00:00:00Z",
      })
    ).statusCode,
    400,
  );
  for (const [sql, values] of [
    ["DELETE FROM user_groups WHERE id=$1", [globalGroup.id]],
    [
      "UPDATE user_groups SET group_type='special' WHERE id=$1",
      [globalGroup.id],
    ],
    [
      "DELETE FROM group_permissions WHERE group_id=$1 AND permission_key='posts.review'",
      [globalGroup.id],
    ],
    [
      "DELETE FROM group_memberships WHERE group_id=$1 AND user_uid=1",
      [globalGroup.id],
    ],
    [
      "UPDATE group_memberships SET expires_at=NOW() WHERE group_id=$1 AND user_uid=1",
      [globalGroup.id],
    ],
  ])
    await assert.rejects(
      f.query(sql, values),
      (error) => error.code === "23514",
    );
  assert.equal(
    (await request("PATCH", path, { name: "社区总管理" })).statusCode,
    200,
  );
});

test("delegated global administrators gain full rights; UID 1 controls their removal", async () => {
  const delegate = f.managers[0],
    limited = f.managers.find((m) => m.permission === "groups.manage");
  const path = `/api/admin/groups/${globalGroup.id}/memberships`;
  assert.equal(
    (await request("POST", path, { userUid: delegate.user.uid }, limited))
      .statusCode,
    403,
  );
  assert.equal(
    (await request("POST", path, { userUid: delegate.user.uid })).statusCode,
    201,
  );
  const { permissionKeys } = await import("../src/permissions.ts");
  const me = (await request("GET", "/api/auth/me", undefined, delegate)).json();
  assert.ok(permissionKeys.every((p) => me.permissions.includes(p)));
  assert.equal(
    (await request("DELETE", `${path}/1`, undefined, delegate)).statusCode,
    403,
  );
  assert.equal(
    (
      await request(
        "DELETE",
        `${path}/${delegate.user.uid}`,
        undefined,
        delegate,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (await request("PATCH", "/api/admin/users/1", { banMinutes: 30 }, delegate))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await request(
        "PATCH",
        "/api/admin/users/1",
        { status: "suspended" },
        delegate,
      )
    ).statusCode,
    403,
  );
  await f.query("UPDATE users SET username_changed_at=NOW() WHERE uid=$1", [
    delegate.user.uid,
  ]);
  assert.equal(
    (
      await request(
        "PATCH",
        "/api/me/profile",
        { username: "delegated_global" },
        delegate,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (await request("DELETE", `${path}/${delegate.user.uid}`)).statusCode,
    200,
  );
  assert.equal(
    (await request("GET", "/api/admin/settings", undefined, delegate))
      .statusCode,
    403,
  );
});

test("the old management group can be deleted while the global role remains available", async () => {
  const old = (await request("GET", "/api/admin/groups"))
    .json()
    .find((g) => g.name === "站点管理");
  assert.equal(old.is_protected, false);
  assert.equal(
    (await request("DELETE", `/api/admin/groups/${old.id}`)).statusCode,
    200,
  );
});

test("post responses carry the current category slug and hidden state without changing visibility", async () => {
  const category = (await request("GET", "/api/categories")).json()[0];
  await f.query(
    "UPDATE app_settings SET setting_value='true'::jsonb WHERE setting_key='posts_require_review'",
  );
  const created = await request("POST", "/api/posts", {
    title: "全局管理员直接发布",
    categoryId: category.id,
    body: { blocks: [{ type: "paragraph", data: { text: "Route test" } }] },
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().post.status, "published");
  const id = created.json().post.id;
  const detail = (await request("GET", `/api/posts/${id}`)).json().post;
  assert.equal(detail.category_slug, category.slug);
  const feed = (await request("GET", "/api/posts")).json();
  assert.equal(feed.find((p) => p.id === id).category_slug, category.slug);
  await request("PATCH", `/api/admin/posts/${id}`, { status: "hidden" });
  assert.equal(
    (await request("GET", `/api/posts/${id}`)).json().post.status,
    "hidden",
  );
  assert.ok(
    !(await request("GET", "/api/posts")).json().some((p) => p.id === id),
  );
});
