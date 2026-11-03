import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomBytes } from "node:crypto";
import { createManagementFixture } from "./helpers/management-fixture.mjs";

let fixture;
let owner;
let query;
let registrationSettings;
const request = (method, url, payload, user = owner) =>
  fixture.request(method, url, payload, user);

process.env.MAIL_ENCRYPTION_KEY = randomBytes(32).toString("base64");

before(async () => {
  fixture = await createManagementFixture();
  ({ owner, query } = fixture);
});

after(async () => {
  if (fixture) await fixture.close();
});

test("an installation already at migration 028 gains TOTP login challenges on upgrade", async () => {
  await query("DROP TABLE totp_login_challenges");
  await query("DELETE FROM schema_migrations WHERE filename='029_totp_login_challenges.sql'");
  const { runMigrations } = await import("../src/db.ts");
  await runMigrations();
  const table = (await query("SELECT to_regclass('totp_login_challenges') IS NOT NULL AS present")).rows[0];
  assert.equal(table.present, true);
  assert.equal((await query("SELECT 1 FROM schema_migrations WHERE filename='029_totp_login_challenges.sql'")).rowCount, 1);
});

test("TOTP enrollment, login challenges, replay rejection and disable", async () => {
  const { totpCode, encodeBase32 } = await import("../src/totp.ts");
  const vectorSecret = encodeBase32(Buffer.from("12345678901234567890"));
  for (const [seconds, expected] of [
    [59, "287082"], [1111111109, "081804"], [1111111111, "050471"],
    [1234567890, "005924"], [2000000000, "279037"], [20000000000, "353130"],
  ]) assert.equal(totpCode(vectorSecret, seconds * 1000), expected);
  assert.equal(
    (await request("POST", "/api/me/totp/setup", { password: fixture.password }, null))
      .statusCode,
    401,
  );
  assert.equal(
    (await request("POST", "/api/me/totp/setup", { password: "incorrect-password" }))
      .statusCode,
    400,
  );

  const setup = await request("POST", "/api/me/totp/setup", {
    password: fixture.password,
  });
  assert.equal(setup.statusCode, 200, setup.body);
  const { secret, otpauthUrl } = setup.json();
  assert.equal(new URL(otpauthUrl).searchParams.get("secret"), secret);
  assert.equal(secret.length, 32);
  const pending = (
    await query("SELECT totp_pending_secret,totp_secret FROM users WHERE uid=$1", [owner.user.uid])
  ).rows[0];
  assert.notEqual(pending.totp_pending_secret, secret);
  assert.equal(pending.totp_secret, null);

  const malformed = await request("POST", "/api/me/totp/enable", { code: "123" });
  assert.equal(malformed.statusCode, 400);
  const enrolledAt = Date.now();
  const enrollmentCode = totpCode(secret, enrolledAt);
  const enabled = await request("POST", "/api/me/totp/enable", { code: enrollmentCode });
  assert.equal(enabled.statusCode, 200, enabled.body);
  assert.equal(enabled.json().enabled, true);
  const saved = (
    await query("SELECT totp_secret,totp_pending_secret,session_version FROM users WHERE uid=$1", [owner.user.uid])
  ).rows[0];
  assert.notEqual(saved.totp_secret, secret);
  assert.equal(saved.totp_pending_secret, null);
  assert.equal(
    (await request("GET", "/api/auth/me", undefined, owner)).statusCode,
    401,
  );
  const activeSession = { token: enabled.json().token, user: owner.user };
  const me = await request("GET", "/api/auth/me", undefined, activeSession);
  assert.equal(me.statusCode, 200, me.body);
  assert.equal(me.json().twoFactorEnabled, true);

  const login = await request(
    "POST",
    "/api/auth/login",
    { identity: "permissions_owner", password: fixture.password },
    null,
  );
  assert.equal(login.statusCode, 200, login.body);
  assert.equal(login.json().requiresTwoFactor, true);
  assert.equal("token" in login.json(), false);
  assert.equal(
    (
      await request(
        "GET",
        "/api/auth/me",
        undefined,
        { token: login.json().challengeToken },
      )
    ).statusCode,
    401,
  );
  const deniedEnrollmentCode = await request("POST", "/api/auth/login/totp", {
    challengeToken: login.json().challengeToken,
    code: enrollmentCode,
  });
  assert.equal(deniedEnrollmentCode.statusCode, 401);
  for (let attempt = 1; attempt < 5; attempt++) {
    assert.equal((await request("POST", "/api/auth/login/totp", {
      challengeToken: login.json().challengeToken,
      code: enrollmentCode,
    })).statusCode, 401);
  }

  const loginCode = totpCode(secret, Date.now() + 30_000);
  assert.equal((await request("POST", "/api/auth/login/totp", {
    challengeToken: login.json().challengeToken,
    code: loginCode,
  })).statusCode, 401, "five failed codes invalidate the challenge");
  const retry = await request("POST", "/api/auth/login", {
    identity: "permissions_owner", password: fixture.password,
  }, null);
  const expires = await request("POST", "/api/auth/login", {
    identity: "permissions_owner", password: fixture.password,
  }, null);
  assert.equal((await request("POST", "/api/auth/login/totp", {
    challengeToken: retry.json().challengeToken,
    code: loginCode,
  })).statusCode, 401, "a newer login replaces the previous challenge");
  await query("UPDATE totp_login_challenges SET expires_at=NOW()-INTERVAL '1 second' WHERE user_uid=$1", [owner.user.uid]);
  assert.equal((await request("POST", "/api/auth/login/totp", {
    challengeToken: expires.json().challengeToken,
    code: loginCode,
  })).statusCode, 401);
  const fresh = await request("POST", "/api/auth/login", {
    identity: "permissions_owner", password: fixture.password,
  }, null);
  const completed = await request("POST", "/api/auth/login/totp", {
    challengeToken: fresh.json().challengeToken,
    code: loginCode,
  });
  assert.equal(completed.statusCode, 200, completed.body);
  assert.equal(completed.json().user.username, "permissions_owner");
  assert.equal(
    (
      await request("POST", "/api/auth/login/totp", {
        challengeToken: fresh.json().challengeToken,
        code: loginCode,
      })
    ).statusCode,
    401,
  );

  const currentTime = Date.now;
  Date.now = () => currentTime() + 30_000;
  let disabled;
  try {
    disabled = await request(
      "POST",
      "/api/me/totp/disable",
      { password: fixture.password, code: totpCode(secret, currentTime() + 60_000) },
      { token: completed.json().token, user: owner.user },
    );
  } finally {
    Date.now = currentTime;
  }
  assert.equal(disabled.statusCode, 200, disabled.body);
  assert.equal(disabled.json().enabled, false);
  owner = { ...owner, token: disabled.json().token };
  assert.equal(
    (
      await request("POST", "/api/auth/login", {
        identity: "permissions_owner",
        password: fixture.password,
      }, null)
    ).json().requiresTwoFactor,
    undefined,
  );
});

test("Turnstile settings are permissioned, encrypted and required on authentication actions", async () => {
  const settingsManager = fixture.managers.find((manager) => manager.permission === "settings.manage");
  const denied = fixture.managers.find((manager) => manager.permission !== "settings.manage");
  assert.equal(
    (await request("GET", "/api/admin/registration-settings", undefined, denied)).statusCode,
    403,
  );
  const get = await request("GET", "/api/admin/registration-settings", undefined, settingsManager);
  assert.equal(get.statusCode, 200, get.body);
  registrationSettings = get.json();
  const secret = "turnstile-test-secret";
  const saved = await request(
    "PUT",
    "/api/admin/registration-settings",
    {
      registrationEnabled: registrationSettings.registration_enabled,
      registrationMode: registrationSettings.registration_mode,
      security: registrationSettings.security,
      turnstile: { enabled: true, siteKey: "site-key-example", secretKey: secret },
    },
    settingsManager,
  );
  assert.equal(saved.statusCode, 200, saved.body);
  const returned = (
    await request("GET", "/api/admin/registration-settings", undefined, settingsManager)
  ).json();
  assert.deepEqual(returned.turnstile, {
    enabled: true,
    siteKey: "site-key-example",
    hasSecret: true,
  });
  const stored = (
    await query("SELECT setting_value FROM app_settings WHERE setting_key='turnstile_config'")
  ).rows[0].setting_value;
  assert.notEqual(stored.secretKey, secret);
  assert.equal(JSON.stringify(stored).includes(secret), false);
  const publicSettings = (await request("GET", "/api/site", undefined, null)).json();
  assert.equal(publicSettings.turnstile_enabled, true);
  assert.equal(publicSettings.turnstile_site_key, "site-key-example");
  assert.equal(JSON.stringify(publicSettings).includes(secret), false);
  assert.equal("turnstile_config" in publicSettings, false);
  const audit = await query("SELECT details FROM audit_events WHERE action_key='registration.settings.update' ORDER BY id DESC LIMIT 1");
  assert.equal(JSON.stringify(audit.rows[0].details).includes(secret), false);
  const retained = await request("PUT", "/api/admin/registration-settings", {
    registrationEnabled: returned.registration_enabled,
    registrationMode: returned.registration_mode,
    security: returned.security,
    turnstile: { enabled: false, siteKey: returned.turnstile.siteKey, secretKey: "" },
  }, settingsManager);
  assert.equal(retained.statusCode, 200, retained.body);
  const disabledConfig = (await request("GET", "/api/admin/registration-settings", undefined, settingsManager)).json().turnstile;
  assert.equal(disabledConfig.siteKey, "site-key-example");
  assert.equal(disabledConfig.hasSecret, true);
  await request("PUT", "/api/admin/registration-settings", {
    registrationEnabled: returned.registration_enabled,
    registrationMode: returned.registration_mode,
    security: returned.security,
    turnstile: { enabled: true, siteKey: returned.turnstile.siteKey, secretKey: "" },
  }, settingsManager);

  const protectedRequests = [
    ["POST", "/api/auth/login", { identity: "x", password: "x" }, null],
    [
      "POST",
      "/api/auth/register",
      {
        username: "captcha_member",
        email: "captcha@example.test",
        displayName: "Captcha",
        password: "password-example-123",
      },
      null,
    ],
    ["POST", "/api/auth/email-code", { email: "captcha@example.test" }, null],
    ["POST", "/api/auth/forgot-password", { email: "captcha@example.test" }, null],
    ["POST", "/api/auth/reset-password", { token: "t".repeat(43), password: "password-example-123" }, null],
    ["POST", "/api/me/password/code", {}, owner],
    ["POST", "/api/me/password", { code: "123456", password: "password-example-123" }, owner],
  ];
  for (const [method, path, payload, user] of protectedRequests) {
    const response = await request(method, path, payload, user);
    assert.equal(response.statusCode, 400, `${method} ${path}: ${response.body}`);
    assert.match(response.body, /人机验证/);
  }

  const observedActions = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const form = new URLSearchParams(init.body);
    const action = new Map([
      ["token-login", "login"],
      ["token-register", "register"],
      ["token-register-code", "register"],
      ["token-reset-request", "password-reset-request"],
      ["token-reset", "password-reset"],
      ["token-password-code", "password-change"],
      ["token-password", "password-change"],
    ]).get(form.get("response"));
    observedActions.push({ action, secret: form.get("secret") });
    return new Response(JSON.stringify({ success: true, action }), { status: 200 });
  };
  try {
    const successfulActions = [
      ["POST", "/api/auth/login", { identity: "permissions_owner", password: fixture.password, turnstileToken: "token-login" }, null, 200],
      ["POST", "/api/auth/register", { username: "captcha_member", email: "captcha@example.test", displayName: "Captcha", password: "password-example-123", turnstileToken: "token-register" }, null, 201],
      ["POST", "/api/auth/email-code", { email: "captcha@example.test", turnstileToken: "token-register-code" }, null, 409],
      ["POST", "/api/auth/forgot-password", { email: "nobody@example.test", turnstileToken: "token-reset-request" }, null, 200],
      ["POST", "/api/auth/reset-password", { token: "t".repeat(43), password: "password-example-123", turnstileToken: "token-reset" }, null, 400],
      ["POST", "/api/me/password/code", { turnstileToken: "token-password-code" }, owner, 503],
      ["POST", "/api/me/password", { code: "123456", password: "password-example-123", turnstileToken: "token-password" }, owner, 400],
    ];
    for (const [method, path, payload, user, expectedStatus] of successfulActions) {
      const response = await request(method, path, payload, user);
      assert.equal(response.statusCode, expectedStatus, `${method} ${path}: ${response.body}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(observedActions.map((entry) => entry.action), [
    "login",
    "register",
    "register",
    "password-reset-request",
    "password-reset",
    "password-change",
    "password-change",
  ]);
  assert.ok(observedActions.every((entry) => entry.secret === secret));
});

test("Turnstile rejects failed, mismatched and unavailable validation responses", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const response of [
      { success: false, "error-codes": ["timeout-or-duplicate"] },
      { success: true, action: "register" },
      { success: true },
    ]) {
      globalThis.fetch = async () => new Response(JSON.stringify(response));
      const result = await request("POST", "/api/auth/login", {
        identity: "permissions_owner", password: fixture.password, turnstileToken: "invalid-token",
      }, null);
      assert.equal(result.statusCode, 400, result.body);
    }
    globalThis.fetch = async () => { throw new Error("Network unavailable"); };
    const failed = await request("POST", "/api/auth/login", {
      identity: "permissions_owner", password: fixture.password, turnstileToken: "unreachable-token",
    }, null);
    assert.equal(failed.statusCode, 503, failed.body);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
