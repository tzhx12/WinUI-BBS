import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import Fastify from "fastify";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";

export async function createManagementFixture({ serve = false } = {}) {
  const schema = `forum_permissions_${randomUUID().replaceAll("-", "")}`;
  const control = new Pool({ connectionString: process.env.DATABASE_URL });
  await control.query(`CREATE SCHEMA ${schema}`);
  const connection = new URL(process.env.DATABASE_URL);
  connection.searchParams.set("options", `-c search_path=${schema},public`);
  process.env.DATABASE_URL = connection.toString();
  const { pool, query, runMigrations } = await import("../../src/db.ts");
  await runMigrations();
  const app = Fastify();
  const uploadRoot = await mkdtemp(join(tmpdir(), "forum-permissions-"));
  await app.register(jwt, { secret: randomUUID() });
  await app.register(multipart);
  await app.register(fastifyStatic, { root: uploadRoot, prefix: "/uploads/" });
  if (serve)
    app.post("/__fixture/shutdown", async () => {
      setTimeout(close, 100);
      return { closing: true };
    });
  for (const [module, fn] of [
    ["setup", "registerSetupRoutes"],
    ["auth", "registerAuthRoutes"],
    ["forum", "registerForumRoutes"],
    ["admin", "registerAdminRoutes"],
    ["invitations", "registerInvitationRoutes"],
    ["reviews", "registerReviewRoutes"],
    ["notifications", "registerNotificationRoutes"],
    ["email", "registerEmailRoutes"],
    ["favorites", "registerFavoriteRoutes"],
  ])
    await (
      await import(`../../src/routes/${module}.ts`)
    )[fn](app, ...(module === "forum" ? [uploadRoot] : []));
  await (
    await import("../../src/routes/media.ts")
  ).registerMediaRoutes(app, uploadRoot);
  const password = randomUUID();
  const request = (method, url, payload, user) =>
    app.inject({
      method,
      url,
      payload,
      headers: user ? { authorization: `Bearer ${user.token}` } : {},
    });
  const ownerResponse = await request("POST", "/api/setup/initialize", {
    username: "permissions_owner",
    displayName: "权限验收管理员",
    email: "owner@example.test",
    password,
  });
  assert.equal(ownerResponse.statusCode, 201, ownerResponse.body);
  const owner = ownerResponse.json();
  const { managementPermissions, basicUserPermissions } =
    await import("../../src/permissions.ts");
  const managers = [];
  for (const [index, permission] of managementPermissions.entries()) {
    const groupResponse = await request(
      "POST",
      "/api/admin/groups",
      {
        name: `单权限管理组 ${permission}`,
        groupType: "management",
        permissions: [...basicUserPermissions, permission],
      },
      owner,
    );
    assert.equal(groupResponse.statusCode, 201, groupResponse.body);
    const username = `permission_manager_${index}`;
    const response = await request("POST", "/api/auth/register", {
      username,
      displayName: `${permission} 管理员`,
      email: `${username}@example.test`,
      password,
    });
    assert.equal(response.statusCode, 201, response.body);
    const manager = response.json();
    const group = groupResponse.json();
    const membership = await request(
      "POST",
      `/api/admin/groups/${group.id}/memberships`,
      { userUid: manager.user.uid },
      owner,
    );
    assert.equal(membership.statusCode, 201, membership.body);
    managers.push({ ...manager, permission, groupId: group.id });
  }
  async function close() {
    await app.close();
    await pool.end();
    await control.query(`DROP SCHEMA ${schema} CASCADE`);
    await control.end();
    await rm(uploadRoot, { recursive: true, force: true });
  }
  return {
    schema,
    app,
    owner,
    managers,
    password,
    uploadRoot,
    query,
    pool,
    request,
    close,
  };
}

export const adminPages = [
  ["overview", "管理概览", "users.manage", "/api/admin/overview"],
  ["users", "用户", "users.manage", "/api/admin/users"],
  ["invitations", "邀请码", "users.manage", "/api/admin/invitations"],
  [
    "registration",
    "注册管理",
    "settings.manage",
    "/api/admin/registration-settings",
  ],
  ["mail", "发信设置", "settings.manage", "/api/admin/mail-settings"],
  ["groups", "用户组与权限", "groups.manage", "/api/admin/groups"],
  ["levels", "等级与经验", "levels.manage", "/api/admin/level-config"],
  ["categories", "板块结构", "categories.manage", "/api/admin/categories"],
  ["posts", "发帖管理", "posts.manage", "/api/admin/posts"],
  [
    "content-settings",
    "发帖与回复设置",
    "settings.manage",
    "/api/admin/content-settings",
  ],
  ["deleted-posts", "删除记录", "posts.manage", "/api/admin/deleted-posts"],
  ["reviews", "发帖审核", "posts.review", "/api/admin/reviews"],
  [
    "review-settings",
    "审核设置",
    "settings.manage",
    "/api/admin/review-settings",
  ],
  [
    "notifications",
    "公告与通知",
    "settings.manage",
    "/api/admin/notifications",
  ],
  ["media", "图床与表情", "media.manage", "/api/admin/media"],
  ["settings", "站点设置", "settings.manage", "/api/admin/settings"],
  ["appearance", "外观设置", "settings.manage", null],
  ["audit", "管理记录", "settings.manage", "/api/admin/audit"],
];
