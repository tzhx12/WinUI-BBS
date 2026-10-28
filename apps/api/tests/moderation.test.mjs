import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import Fastify from "fastify";
import jwt from "@fastify/jwt";
import { Pool } from "pg";

// Exercise real PostgreSQL queries in an isolated schema; never change forum data.
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
const app = Fastify();
const password = randomUUID();
let adminToken, memberToken, adminUid, memberUid;
const auth = (token) => ({ authorization: `Bearer ${token}` });
const patchUser = (payload, uid = memberUid, token = adminToken) =>
  app.inject({
    method: "PATCH",
    url: `/api/admin/users/${uid}`,
    headers: auth(token),
    payload,
  });
const login = () =>
  app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { identity: "member", password },
  });
const me = () =>
  app.inject({ url: "/api/auth/me", headers: auth(memberToken) });
const member = async () =>
  (await app.inject({ url: "/api/admin/users", headers: auth(adminToken) }))
    .json()
    .find((user) => user.uid === memberUid);

before(async () => {
  await control.query(`CREATE SCHEMA ${schema}`);
  await runMigrations();
  await app.register(jwt, { secret: randomUUID() });
  await registerSetupRoutes(app);
  await registerAuthRoutes(app);
  await registerAdminRoutes(app);
  await registerForumRoutes(app);
  const owner = await app.inject({
    method: "POST",
    url: "/api/setup/initialize",
    payload: {
      username: "owner",
      email: "owner@example.test",
      displayName: "管理员",
      password,
    },
  });
  assert.equal(owner.statusCode, 201);
  adminToken = owner.json().token;
  adminUid = owner.json().user.uid;
  const registered = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      username: "member",
      email: "member@example.test",
      displayName: "测试成员",
      password,
    },
  });
  assert.equal(registered.statusCode, 201);
  memberToken = registered.json().token;
  memberUid = registered.json().user.uid;
});

after(async () => {
  await app.close();
  await pool.end();
  await control.query(`DROP SCHEMA ${schema} CASCADE`);
  await control.end();
});

test("category icons and optional badges persist through public reads and migrations", async () => {
  const categories = (await app.inject({ url: "/api/categories" })).json();
  assert.ok(categories.length);
  assert.ok(
    categories.every(
      (category) =>
        category.icon_glyph === "\ue8b7" &&
        category.show_notification === false,
    ),
  );
  const url = `/api/admin/categories/${categories[0].id}`;
  const updated = await app.inject({
    method: "PATCH",
    url,
    headers: auth(adminToken),
    payload: {
      iconGlyph: "\ue943",
      showNotification: true,
    },
  });
  assert.equal(updated.statusCode, 200);
  await runMigrations();
  const changed = (await app.inject({ url: "/api/categories" }))
    .json()
    .find((category) => category.id === categories[0].id);
  assert.equal(changed.icon_glyph, "\ue943");
  assert.equal(changed.show_notification, true);
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url,
        headers: auth(adminToken),
        payload: { iconGlyph: "invalid" },
      })
    ).statusCode,
    400,
  );
  const created = await app.inject({
    method: "POST",
    url: "/api/admin/categories",
    headers: auth(adminToken),
    payload: { name: "新板块", slug: "new-category" },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().show_notification, false);
  assert.equal(created.json().icon_glyph, "\ue8b7");
});

test("only administrators can ban and the last active manager remains available", async () => {
  assert.equal(
    (await patchUser({ banMinutes: 30 }, memberUid, memberToken)).statusCode,
    403,
  );
  assert.equal((await patchUser({ banMinutes: 30 }, adminUid)).statusCode, 409);
  assert.equal((await me()).statusCode, 200);
});

test("ban range, active sessions, login and early unban", async () => {
  for (const banMinutes of [0, 29, 30.5, 1095 * 1440 + 1])
    assert.equal((await patchUser({ banMinutes })).statusCode, 400);
  const beforeBan = Date.now();
  const banned = await patchUser({ banMinutes: 30 });
  assert.equal(banned.statusCode, 200);
  assert.ok(
    Math.abs(
      new Date(banned.json().banned_until).getTime() - beforeBan - 30 * 60_000,
    ) < 5000,
  );
  assert.equal((await member()).is_banned, true);
  assert.equal((await me()).statusCode, 401);
  assert.equal((await login()).statusCode, 403);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/check-in",
        headers: auth(memberToken),
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/posts",
        headers: auth(memberToken),
        payload: {},
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (await patchUser({ level: 3, status: "active" })).statusCode,
    200,
  );
  assert.equal((await member()).is_banned, true);
  const unbanned = await patchUser({ banMinutes: null });
  assert.equal(unbanned.statusCode, 200);
  assert.equal(unbanned.json().banned_until, null);
  assert.equal((await me()).statusCode, 200);
  assert.equal((await login()).statusCode, 200);
  const maximum = await patchUser({ banMinutes: 1095 * 1440 });
  assert.equal(maximum.statusCode, 200);
  assert.ok(
    Math.abs(
      new Date(maximum.json().banned_until).getTime() -
        Date.now() -
        1095 * 1440 * 60_000,
    ) < 5000,
  );
  assert.equal((await patchUser({ banMinutes: null })).statusCode, 200);
});

test("expired bans restore access while permanent suspension stays effective", async () => {
  await query(
    "UPDATE users SET banned_until = NOW() - INTERVAL '1 minute' WHERE uid = $1",
    [memberUid],
  );
  assert.equal((await member()).is_banned, false);
  assert.equal((await me()).statusCode, 200);
  assert.equal((await login()).statusCode, 200);
  assert.equal((await patchUser({ status: "suspended" })).statusCode, 200);
  assert.equal((await me()).statusCode, 401);
  assert.equal((await login()).statusCode, 401);
  assert.equal(
    (await patchUser({ banMinutes: null })).json().status,
    "suspended",
  );
  assert.equal((await me()).statusCode, 401);
  assert.equal((await patchUser({ status: "active" })).statusCode, 200);
  assert.equal((await me()).statusCode, 200);
  const events = await query(
    "SELECT details FROM audit_events WHERE target_type = 'user' AND target_id = $1 AND details ? 'banMinutes'",
    [memberUid],
  );
  assert.ok(events.rows.some(({ details }) => details.banMinutes === 30));
  assert.ok(events.rows.some(({ details }) => details.banMinutes === null));
});
