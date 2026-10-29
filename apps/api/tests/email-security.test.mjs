import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import nodemailer from "nodemailer";
import { randomBytes } from "node:crypto";
import { createManagementFixture } from "./helpers/management-fixture.mjs";

let fixture, owner, member, query, security, mailConfig;
let failSend = false;
const sent = [];
process.env.MAIL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
const transportMock = mock.method(nodemailer, "createTransport", (options) => ({
  async sendMail(message) {
    if (failSend) throw new Error("SMTP test failure");
    sent.push({ ...message, options });
    return { accepted: [message.to] };
  },
  close() {},
}));
const request = (method, url, payload, user = owner) =>
  fixture.request(method, url, payload, user);
const registeredEmail = "verified@example.test";
const code = () => sent.at(-1).text.match(/验证码是：(\d{6})/)[1];
const resetToken = () =>
  new URL(
    sent
      .at(-1)
      .text.match(/https?:\/\/\S+/)[0]
      .split("#")[1],
    "https://app.example.test",
  ).searchParams.get("token");
const loosenRate = async (email = registeredEmail) =>
  query(
    "UPDATE email_deliveries SET sent_at=sent_at-INTERVAL '61 seconds' WHERE email=$1",
    [email],
  );
before(async () => {
  fixture = await createManagementFixture();
  ({ owner, query } = fixture);
  mailConfig = {
    enabled: true,
    fromName: "Mail test",
    fromAddress: "sender@example.test",
    smtp: {
      host: "smtp.example.test",
      port: 465,
      secure: true,
      user: "sender@example.test",
      password: "test-only-smtp-secret",
    },
    imap: {
      enabled: false,
      host: "",
      port: 993,
      secure: true,
      user: "",
      password: "",
    },
  };
  const configured = await request(
    "PUT",
    "/api/admin/mail-settings",
    mailConfig,
  );
  assert.equal(configured.statusCode, 200, configured.body);
  const current = (
    await request("GET", "/api/admin/registration-settings")
  ).json();
  security = current.security;
  await request("PATCH", "/api/admin/settings", {
    siteUrl: "https://app.example.test",
  });
});
after(async () => {
  transportMock.mock.restore();
  if (fixture) await fixture.close();
});

test("email security defaults and settings privileges preserve existing registration", async () => {
  assert.equal(security.codeMinutes, 60);
  assert.equal(security.resetMinutes, 30);
  assert.equal(security.resendSeconds, 60);
  assert.equal(security.recoveryDailyLimit, 1);
  assert.equal(security.passwordChangeSeconds, 60);
  for (const manager of fixture.managers) {
    assert.equal(
      (await request("GET", "/api/admin/mail-settings", undefined, manager))
        .statusCode,
      manager.permission === "settings.manage" ? 200 : 403,
    );
    assert.equal(
      (
        await request(
          "GET",
          "/api/admin/registration-settings",
          undefined,
          manager,
        )
      ).statusCode,
      manager.permission === "settings.manage" ? 200 : 403,
    );
  }
  const response = await request(
    "POST",
    "/api/auth/register",
    {
      username: "unverified_member",
      displayName: "Unverified",
      email: "old@example.test",
      password: "existing-password-123",
    },
    null,
  );
  assert.equal(response.statusCode, 201, response.body);
});
test("SMTP secrets are encrypted at rest, masked in responses, and preserved by blank updates", async () => {
  const returned = (await request("GET", "/api/admin/mail-settings")).json();
  assert.equal(returned.smtp.password, "");
  assert.equal(returned.smtp.hasPassword, true);
  const stored = (
    await query(
      "SELECT setting_value FROM app_settings WHERE setting_key='mail_transport'",
    )
  ).rows[0].setting_value;
  assert.notEqual(stored.smtp.password, mailConfig.smtp.password);
  assert.ok(!JSON.stringify(stored).includes(mailConfig.smtp.password));
  assert.equal(
    (await request("PUT", "/api/admin/mail-settings", returned)).statusCode,
    200,
  );
  assert.equal(
    (
      await request("POST", "/api/admin/mail-settings/test", {
        email: "test@example.test",
      })
    ).statusCode,
    200,
  );
  assert.equal(sent.at(-1).options.auth.pass, mailConfig.smtp.password);
  const audit = (await request("GET", "/api/admin/audit")).body;
  assert.ok(!audit.includes(mailConfig.smtp.password));
  assert.ok(!audit.includes(mailConfig.smtp.host));
  assert.ok(
    !(await request("GET", "/api/site", undefined, null)).body.includes(
      mailConfig.smtp.host,
    ),
  );
});
test("registration email verification is mandatory when enabled and sends one message per minute per email", async () => {
  security.registrationVerification = true;
  assert.equal(
    (
      await request("PUT", "/api/admin/registration-settings", {
        registrationEnabled: true,
        registrationMode: "open",
        security,
      })
    ).statusCode,
    200,
  );
  const payload = {
    username: "verified_member",
    displayName: "Verified",
    email: registeredEmail,
    password: "original-password-123",
  };
  assert.equal(
    (await request("POST", "/api/auth/register", payload, null)).statusCode,
    400,
  );
  const responses = await Promise.all([
    request("POST", "/api/auth/email-code", { email: registeredEmail }, null),
    request(
      "POST",
      "/api/auth/email-code",
      { email: registeredEmail.toUpperCase() },
      null,
    ),
  ]);
  assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 429]);
  const correct = code();
  assert.equal(
    responses.find((r) => r.statusCode === 200).json().expiresInMinutes,
    60,
  );
  const registered = await request(
    "POST",
    "/api/auth/register",
    { ...payload, verificationCode: correct },
    null,
  );
  assert.equal(registered.statusCode, 201, registered.body);
  member = registered.json();
  const saved = (
    await query("SELECT email_verified_at FROM users WHERE uid=$1", [
      member.user.uid,
    ])
  ).rows[0];
  assert.ok(saved.email_verified_at);
  assert.equal(
    (
      await query(
        "SELECT consumed_at FROM email_challenges WHERE email=$1 AND purpose='registration'",
        [registeredEmail],
      )
    ).rows[0].consumed_at !== null,
    true,
  );
});
test("incorrect codes have five attempts and expired codes never register an account", async () => {
  const email = "attempts@example.test";
  await request("POST", "/api/auth/email-code", { email }, null);
  const correct = code(),
    wrong = correct === "111111" ? "222222" : "111111";
  const payload = {
    username: "attempt_member",
    displayName: "Attempts",
    email,
    password: "original-password-123",
  };
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await request(
          "POST",
          "/api/auth/register",
          { ...payload, verificationCode: wrong },
          null,
        )
      ).statusCode,
      400,
    );
  assert.equal(
    (
      await query("SELECT attempts FROM email_challenges WHERE email=$1", [
        email,
      ])
    ).rows[0].attempts,
    5,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/api/auth/register",
        { ...payload, verificationCode: correct },
        null,
      )
    ).statusCode,
    400,
  );
  await loosenRate(email);
  await request("POST", "/api/auth/email-code", { email }, null);
  const expired = code();
  await query(
    "UPDATE email_challenges SET expires_at=NOW()-INTERVAL '1 second' WHERE email=$1",
    [email],
  );
  assert.equal(
    (
      await request(
        "POST",
        "/api/auth/register",
        { ...payload, verificationCode: expired },
        null,
      )
    ).statusCode,
    400,
  );
});
test("failed mail delivery rolls back the code and rate limit", async () => {
  const email = "failed@example.test";
  failSend = true;
  assert.equal(
    (await request("POST", "/api/auth/email-code", { email }, null)).statusCode,
    502,
  );
  failSend = false;
  assert.equal(
    (await query("SELECT 1 FROM email_deliveries WHERE email=$1", [email]))
      .rowCount,
    0,
  );
  assert.equal(
    (await request("POST", "/api/auth/email-code", { email }, null)).statusCode,
    200,
  );
});
test("password recovery sends a 30-minute one-use link and is limited to once per day", async () => {
  await loosenRate();
  const requested = await request(
    "POST",
    "/api/auth/forgot-password",
    { email: registeredEmail },
    null,
  );
  assert.equal(requested.statusCode, 200, requested.body);
  assert.equal(requested.json().expiresInMinutes, 30);
  const token = resetToken();
  assert.equal(
    (await request("POST", "/api/auth/password-reset", { token }, null))
      .statusCode,
    200,
  );
  await loosenRate();
  assert.equal(
    (
      await request(
        "POST",
        "/api/auth/forgot-password",
        { email: registeredEmail },
        null,
      )
    ).statusCode,
    429,
  );
  const reset = await request(
    "POST",
    "/api/auth/reset-password",
    { token, password: "reset-password-12345" },
    null,
  );
  assert.equal(reset.statusCode, 200, reset.body);
  assert.equal(
    (await request("POST", "/api/auth/password-reset", { token }, null))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/api/auth/reset-password",
        { token, password: "different-password-123" },
        null,
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (await request("GET", "/api/auth/me", undefined, member)).statusCode,
    401,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/api/auth/login",
        { identity: registeredEmail, password: "original-password-123" },
        null,
      )
    ).statusCode,
    401,
  );
  const login = await request(
    "POST",
    "/api/auth/login",
    { identity: registeredEmail, password: "reset-password-12345" },
    null,
  );
  assert.equal(login.statusCode, 200, login.body);
  member = login.json();
});
test("unknown email recovery is generic and expired reset links fail without changing the password", async () => {
  const before = sent.length;
  const unknown = await request(
    "POST",
    "/api/auth/forgot-password",
    { email: "unknown@example.test" },
    null,
  );
  assert.equal(unknown.statusCode, 200);
  assert.equal(sent.length, before);
  await query(
    "UPDATE email_deliveries SET sent_at=sent_at-INTERVAL '1 day' WHERE email=$1",
    [registeredEmail],
  );
  await request(
    "POST",
    "/api/auth/forgot-password",
    { email: registeredEmail },
    null,
  );
  const token = resetToken();
  await query(
    "UPDATE email_challenges SET expires_at=NOW()-INTERVAL '1 second' WHERE email=$1 AND purpose='password_reset'",
    [registeredEmail],
  );
  assert.equal(
    (await request("POST", "/api/auth/password-reset", { token }, null))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/api/auth/reset-password",
        { token, password: "expired-password-1234" },
        null,
      )
    ).statusCode,
    400,
  );
});
test("manual password change verifies the account email, revokes old sessions and enforces a minute cooldown", async () => {
  await loosenRate();
  const issued = await request(
    "POST",
    "/api/me/password/code",
    undefined,
    member,
  );
  assert.equal(issued.statusCode, 200, issued.body);
  const correct = code();
  assert.equal(
    (
      await request(
        "POST",
        "/api/me/password",
        { code: correct, password: "manual-password-1234" },
        member,
      )
    ).statusCode,
    429,
  );
  await query(
    "UPDATE users SET password_changed_at=NOW()-INTERVAL '61 seconds' WHERE uid=$1",
    [member.user.uid],
  );
  const changed = await request(
    "POST",
    "/api/me/password",
    { code: correct, password: "manual-password-1234" },
    member,
  );
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal(
    (await request("GET", "/api/auth/me", undefined, member)).statusCode,
    401,
  );
  const fresh = { token: changed.json().token };
  assert.equal(
    (await request("GET", "/api/auth/me", undefined, fresh)).statusCode,
    200,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/api/me/password",
        { code: correct, password: "again-password-1234" },
        fresh,
      )
    ).statusCode,
    429,
  );
  await query(
    "UPDATE users SET password_changed_at=NOW()-INTERVAL '61 seconds' WHERE uid=$1",
    [member.user.uid],
  );
  assert.equal(
    (
      await request(
        "POST",
        "/api/me/password",
        { code: correct, password: "again-password-1234" },
        fresh,
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/api/auth/login",
        { identity: registeredEmail, password: "manual-password-1234" },
        null,
      )
    ).statusCode,
    200,
  );
});
test("admin settings reject unsafe intervals and cannot disable mail while registration verification is required", async () => {
  const payload = {
    registrationEnabled: true,
    registrationMode: "open",
    security: { ...security, resendSeconds: 59 },
  };
  assert.equal(
    (await request("PUT", "/api/admin/registration-settings", payload))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await request("PUT", "/api/admin/mail-settings", {
        ...mailConfig,
        enabled: false,
      })
    ).statusCode,
    400,
  );
});
