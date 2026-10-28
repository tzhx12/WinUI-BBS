import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  createManagementFixture,
  adminPages,
} from "./helpers/management-fixture.mjs";

let fixture, owner, managers, query;
const baseline = ["posts.create", "replies.create", "media.use"];
const management = [
  "users.manage",
  "groups.manage",
  "levels.manage",
  "posts.manage",
  "posts.review",
  "categories.manage",
  "media.manage",
  "settings.manage",
];
const request = (method, url, payload, user = owner) =>
  fixture.request(method, url, payload, user);
before(async () => {
  fixture = await createManagementFixture();
  ({ owner, managers, query } = fixture);
});
after(async () => {
  if (fixture) await fixture.close();
});

test("eight management groups each grant exactly one management permission with basic user capabilities", async () => {
  for (const manager of managers) {
    const response = await request("GET", "/api/auth/me", undefined, manager);
    assert.equal(response.statusCode, 200);
    const me = response.json();
    assert.deepEqual(
      me.permissions.filter((key) => management.includes(key)),
      [manager.permission],
    );
    assert.ok(baseline.every((key) => me.permissions.includes(key)));
    assert.ok(
      me.groups.some(
        (group) =>
          group.id === manager.groupId && group.group_type === "management",
      ),
    );
  }
});

test("single management permissions isolate every admin read endpoint, including settings inside media and notifications", async () => {
  const reads = [
    ...adminPages.filter((page) => page[3]).map((page) => [page[3], page[2]]),
    ["/api/admin/media-settings", "media.manage"],
    ["/api/admin/emoji-packs", "media.manage"],
    ["/api/admin/notification-groups", "settings.manage"],
  ];
  for (const manager of managers)
    for (const [url, permission] of reads) {
      const response = await request("GET", url, undefined, manager);
      assert.equal(
        response.statusCode,
        manager.permission === permission ? 200 : 403,
        `${manager.permission}: ${url}: ${response.body}`,
      );
    }
});

test("single management permissions reject writes to the other seven areas before payload validation", async () => {
  const writes = [
    ["PATCH", `/api/admin/users/${owner.user.uid}`, "users.manage"],
    ["POST", "/api/admin/groups", "groups.manage"],
    ["PUT", "/api/admin/level-config", "levels.manage"],
    [
      "PATCH",
      "/api/admin/posts/00000000-0000-0000-0000-000000000000",
      "posts.manage",
    ],
    [
      "POST",
      "/api/admin/reviews/00000000-0000-0000-0000-000000000000/decision",
      "posts.review",
    ],
    ["POST", "/api/admin/categories", "categories.manage"],
    [
      "PATCH",
      "/api/admin/media/00000000-0000-0000-0000-000000000000",
      "media.manage",
    ],
    ["PATCH", "/api/admin/settings", "settings.manage"],
  ];
  for (const manager of managers)
    for (const [method, url, permission] of writes) {
      const response = await request(method, url, {}, manager);
      assert.equal(
        response.statusCode,
        manager.permission === permission ? 400 : 403,
        `${manager.permission}: ${method} ${url}: ${response.body}`,
      );
    }
});

test("ordinary and public groups cannot receive any management permission on create, update or type changes", async () => {
  for (const groupType of ["normal", "public"]) {
    for (const permission of management) {
      const response = await request("POST", "/api/admin/groups", {
        name: `${groupType}-${permission}`,
        groupType,
        permissions: [...baseline, permission],
      });
      assert.equal(response.statusCode, 400, response.body);
    }
    const created = await request("POST", "/api/admin/groups", {
      name: `${groupType}-valid`,
      groupType,
      permissions: [...baseline, "posts.require_review"],
    });
    assert.equal(created.statusCode, 201, created.body);
    const id = created.json().id;
    assert.equal(
      (
        await request("PATCH", `/api/admin/groups/${id}`, {
          permissions: [...baseline, "posts.review"],
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await request("PATCH", `/api/admin/groups/${id}`, {
          groupType: "management",
        })
      ).statusCode,
      400,
    );
  }
  const manager = managers.find((user) => user.permission === "posts.manage");
  assert.equal(
    (
      await request("PATCH", `/api/admin/groups/${manager.groupId}`, {
        groupType: "normal",
      })
    ).statusCode,
    400,
  );
  const saved = (await request("GET", "/api/admin/groups"))
    .json()
    .find((group) => group.id === manager.groupId);
  assert.equal(saved.group_type, "management");
  assert.ok(saved.permissions.includes("posts.manage"));
});

test("management groups require one management capability and cannot drop any basic user capability", async () => {
  assert.equal(
    (
      await request("POST", "/api/admin/groups", {
        name: "无管理权限",
        groupType: "management",
        permissions: baseline,
      })
    ).statusCode,
    400,
  );
  for (const key of baseline) {
    const permissions = [
      ...baseline.filter((item) => item !== key),
      "posts.manage",
    ];
    assert.equal(
      (
        await request("POST", "/api/admin/groups", {
          name: `缺少-${key}`,
          groupType: "management",
          permissions,
        })
      ).statusCode,
      400,
    );
    const manager = managers.find((user) => user.permission === "posts.manage");
    assert.equal(
      (
        await request("PATCH", `/api/admin/groups/${manager.groupId}`, {
          permissions,
        })
      ).statusCode,
      400,
    );
  }
  const manager = managers.find((user) => user.permission === "posts.manage");
  assert.equal(
    (
      await request("PATCH", `/api/admin/groups/${manager.groupId}`, {
        permissions: baseline,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await request("PATCH", `/api/admin/groups/${manager.groupId}`, {
        description: "保留原权限",
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await request("PATCH", "/api/admin/groups/999999999", {
        permissions: baseline,
      })
    ).statusCode,
    404,
  );
});

test("database constraints enforce group rules and permit an atomic type and permission change", async () => {
  const ordinary = (await request("GET", "/api/admin/groups"))
    .json()
    .find((group) => group.is_default);
  await assert.rejects(
    query(
      "INSERT INTO group_permissions (group_id, permission_key) VALUES ($1, $2)",
      [ordinary.id, "posts.review"],
    ),
    (error) => error.code === "23514",
  );
  const manager = managers.find(
    (user) => user.permission === "categories.manage",
  );
  await assert.rejects(
    query("UPDATE user_groups SET group_type = 'public' WHERE id = $1", [
      manager.groupId,
    ]),
    (error) => error.code === "23514",
  );
  const created = await request("POST", "/api/admin/groups", {
    name: "类型转换验收",
    groupType: "management",
    permissions: [...baseline, "media.manage"],
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(
    (
      await request("PATCH", `/api/admin/groups/${created.json().id}`, {
        groupType: "normal",
        permissions: baseline,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await request("PATCH", `/api/admin/groups/${created.json().id}`, {
        groupType: "management",
        permissions: [...baseline, "media.manage"],
      })
    ).statusCode,
    200,
  );
});

test("deleting invitation reward rules preserves issued codes and remains safe during reward checks", async () => {
  const created = await request("POST", "/api/admin/invitation-rules", {
    minimumLevel: 2,
    quantity: 2,
  });
  assert.equal(created.statusCode, 201);
  const rule = created.json();
  const recipient = managers.find(
    (user) => user.permission === "levels.manage",
  );
  await request("PATCH", `/api/admin/users/${recipient.user.uid}`, {
    level: 2,
  });
  const codes = (
    await request("GET", "/api/me/invitations", undefined, recipient)
  ).json();
  assert.equal(codes.length, 2);
  assert.equal(
    (
      await request(
        "DELETE",
        `/api/admin/invitation-rules/${rule.id}`,
        undefined,
        recipient,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (await request("DELETE", `/api/admin/invitation-rules/${rule.id}`))
      .statusCode,
    200,
  );
  assert.equal(
    (await request("DELETE", `/api/admin/invitation-rules/${rule.id}`))
      .statusCode,
    404,
  );
  assert.ok(
    !(await request("GET", "/api/admin/invitations"))
      .json()
      .rules.some((item) => item.id === rule.id),
  );
  const retained = (
    await request("GET", "/api/me/invitations", undefined, recipient)
  ).json();
  assert.deepEqual(
    retained.map((code) => code.id).sort(),
    codes.map((code) => code.id).sort(),
  );
  assert.ok(retained.every((code) => code.is_enabled && code.used_count === 0));
  assert.ok(
    (
      await query(
        "SELECT rule_id FROM invitations WHERE id = ANY($1::uuid[])",
        [codes.map((code) => code.id)],
      )
    ).rows.every((code) => code.rule_id === null),
  );
  const raceRule = (
    await request("POST", "/api/admin/invitation-rules", {
      minimumLevel: 1,
      quantity: 1,
    })
  ).json();
  const concurrent = await Promise.all([
    request("GET", "/api/auth/me", undefined, recipient),
    request("DELETE", `/api/admin/invitation-rules/${raceRule.id}`),
  ]);
  assert.ok(
    concurrent.every((response) => response.statusCode === 200),
    concurrent.map((response) => response.body).join("\n"),
  );
});
