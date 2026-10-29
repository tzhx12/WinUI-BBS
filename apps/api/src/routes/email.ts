import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { adminPermissions, authenticate } from '../auth.js'
import { inTransaction, query } from '../db.js'
import { readSettings, saveSettings } from '../settings.js'
import {
  challengeHash,
  checkImap,
  emailSecurity,
  emailSecuritySchema,
  encryptMailSecret,
  issueEmailChallenge,
  mailError,
  mailTransportSchema,
  publicMailTransport,
  readMailTransport,
  sendEmail,
  verifyEmailCode,
} from '../mail.js'

const emailSchema = z.email().trim().toLowerCase()
const passwordSchema = z.string().min(10).max(128)

export async function registerEmailRoutes(app: FastifyInstance) {
  app.get('/api/admin/mail-settings', { preHandler: adminPermissions.settings }, async () =>
    publicMailTransport(await readMailTransport()),
  )
  app.put('/api/admin/mail-settings', { preHandler: adminPermissions.settings }, async (request, reply) => {
    const parsed = mailTransportSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '请检查发信和收信设置' })
    const value = parsed.data
    await inTransaction(async (client) => {
      const stored = (
        await client.query<{ setting_value: typeof value }>(
          "SELECT setting_value FROM app_settings WHERE setting_key='mail_transport' FOR UPDATE",
        )
      ).rows[0]!.setting_value
      for (const key of ['smtp', 'imap'] as const)
        value[key].password = value[key].password
          ? encryptMailSecret(value[key].password)
          : stored[key].password
      if (
        value.enabled &&
        (!value.fromAddress || !value.smtp.host || !value.smtp.user || !value.smtp.password)
      )
        throw mailError('启用发信需填写发件邮箱、SMTP 地址、账号和密码')
      if (value.imap.enabled && (!value.imap.host || !value.imap.user || !value.imap.password))
        throw mailError('启用 IMAP 需填写收信服务器、账号和密码')
      if (!value.enabled && (await emailSecurity(client)).registrationVerification)
        throw mailError('请先关闭注册邮箱验证，再停用发信服务')
      await saveSettings({ mail_transport: value }, client)
      await client.query(
        "INSERT INTO audit_events(actor_uid,action_key,target_type) VALUES($1,'mail.settings.update','site')",
        [request.user.uid],
      )
    })
    return { saved: true }
  })
  app.post(
    '/api/admin/mail-settings/test',
    { preHandler: adminPermissions.settings },
    async (request, reply) => {
      const parsed = z.object({ email: emailSchema }).safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: '请填写测试收件邮箱' })
      await sendEmail(parsed.data.email, 'WinUI-BBS · 发信测试', '发信测试成功。此邮件由站点管理后台发出。')
      return { sent: true }
    },
  )
  app.post('/api/admin/mail-settings/test-imap', { preHandler: adminPermissions.settings }, async () => {
    await checkImap(await readMailTransport())
    return { connected: true }
  })
  app.get('/api/admin/registration-settings', { preHandler: adminPermissions.settings }, async () => ({
    ...(await readSettings(['registration_enabled', 'registration_mode'])),
    security: await emailSecurity(),
  }))
  app.put(
    '/api/admin/registration-settings',
    { preHandler: adminPermissions.settings },
    async (request, reply) => {
      const parsed = z
        .object({
          registrationEnabled: z.boolean(),
          registrationMode: z.enum(['open', 'invite']),
          security: emailSecuritySchema,
        })
        .safeParse(request.body)
      if (!parsed.success)
        return reply.code(400).send({ error: '请检查注册与密码安全设置；发送和改密间隔不能低于 60 秒' })
      const { security } = parsed.data
      await inTransaction(async (client) => {
        const mail = (
          await client.query<{ setting_value: { enabled: boolean } }>(
            "SELECT setting_value FROM app_settings WHERE setting_key='mail_transport' FOR SHARE",
          )
        ).rows[0]!.setting_value
        if (security.registrationVerification && !mail.enabled)
          throw mailError('请先配置并启用发信服务，再开启注册邮箱验证')
        await saveSettings(
          {
            registration_enabled: parsed.data.registrationEnabled,
            registration_mode: parsed.data.registrationMode,
            email_security: security,
          },
          client,
        )
        await client.query(
          "INSERT INTO audit_events(actor_uid,action_key,target_type,details) VALUES($1,'registration.settings.update','site',$2::jsonb)",
          [request.user.uid, JSON.stringify(parsed.data)],
        )
      })
      return { saved: true }
    },
  )
  app.post('/api/auth/email-code', async (request, reply) => {
    const parsed = z.object({ email: emailSchema }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '请填写有效邮箱' })
    const settings = await readSettings(['registration_enabled'])
    if (!settings.registration_enabled) return reply.code(403).send({ error: '站点暂未开放注册' })
    if (!(await emailSecurity()).registrationVerification)
      return reply.code(409).send({ error: '当前注册不需要邮箱验证' })
    if ((await query('SELECT 1 FROM users WHERE lower(email)=$1', [parsed.data.email])).rowCount)
      return reply.code(409).send({ error: '此邮箱已被注册' })
    return issueEmailChallenge(parsed.data.email, 'registration')
  })
  app.post('/api/auth/forgot-password', async (request, reply) => {
    const parsed = z.object({ email: emailSchema }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '请填写注册邮箱' })
    const security = await emailSecurity()
    if (!security.recoveryEnabled) return reply.code(403).send({ error: '站点暂未开放找回密码' })
    const user = (
      await query<{ uid: string }>(
        "SELECT uid FROM users WHERE lower(email)=$1 AND status='active' AND (banned_until IS NULL OR banned_until<=NOW())",
        [parsed.data.email],
      )
    ).rows[0]
    if (user) await issueEmailChallenge(parsed.data.email, 'password_reset', user.uid)
    return {
      sent: true,
      message: '如果此邮箱已注册，找回密码链接已发送，请查收邮件。',
      expiresInMinutes: security.resetMinutes,
    }
  })
  app.post('/api/auth/password-reset', async (request, reply) => {
    const parsed = z.object({ token: z.string().min(40).max(128) }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '找回密码链接无效或已过期' })
    const result = await query<{ expires_at: Date }>(
      `SELECT c.expires_at FROM email_challenges c JOIN users u ON u.uid=c.user_uid
       WHERE c.secret_hash=$1 AND c.purpose='password_reset' AND c.consumed_at IS NULL AND c.expires_at>NOW() AND u.status='active' AND (u.banned_until IS NULL OR u.banned_until<=NOW())`,
      [challengeHash(parsed.data.token)],
    )
    if (!result.rows[0]) return reply.code(400).send({ error: '找回密码链接无效、已使用或已过期' })
    return { valid: true, expiresAt: result.rows[0].expires_at }
  })
  app.post('/api/auth/reset-password', async (request, reply) => {
    const parsed = z
      .object({ token: z.string().min(40).max(128), password: passwordSchema })
      .safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '请检查找回链接，新密码需为 10–128 位' })
    const hash = await bcrypt.hash(parsed.data.password, 12)
    const changed = await inTransaction(async (client) => {
      const candidate = (
        await client.query<{ user_uid: string }>(
          "SELECT user_uid FROM email_challenges WHERE secret_hash=$1 AND purpose='password_reset'",
          [challengeHash(parsed.data.token)],
        )
      ).rows[0]
      if (!candidate) return false
      await client.query('SELECT uid FROM users WHERE uid=$1 FOR UPDATE', [candidate.user_uid])
      const consumed = await client.query(
        `UPDATE email_challenges SET consumed_at=NOW() WHERE secret_hash=$1 AND purpose='password_reset'
         AND consumed_at IS NULL AND expires_at>NOW() AND EXISTS(SELECT 1 FROM users WHERE uid=user_uid AND status='active' AND (banned_until IS NULL OR banned_until<=NOW())) RETURNING id`,
        [challengeHash(parsed.data.token)],
      )
      if (!consumed.rowCount) return false
      await client.query(
        'UPDATE users SET password_hash=$2,password_changed_at=NOW(),session_version=session_version+1,email_verified_at=COALESCE(email_verified_at,NOW()) WHERE uid=$1',
        [candidate.user_uid, hash],
      )
      await client.query(
        "UPDATE email_challenges SET consumed_at=NOW() WHERE user_uid=$1 AND purpose IN ('password_change','password_reset') AND consumed_at IS NULL",
        [candidate.user_uid],
      )
      return true
    })
    if (!changed) return reply.code(400).send({ error: '找回密码链接无效、已使用或已过期' })
    return { changed: true }
  })
  app.post('/api/me/password/code', { preHandler: authenticate }, async (request) => {
    const user = (await query<{ email: string }>('SELECT email FROM users WHERE uid=$1', [request.user.uid]))
      .rows[0]!
    return issueEmailChallenge(user.email.toLowerCase(), 'password_change', request.user.uid)
  })
  app.post('/api/me/password', { preHandler: authenticate }, async (request, reply) => {
    const parsed = z
      .object({ code: z.string().regex(/^\d{6}$/), password: passwordSchema })
      .safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '请填写 6 位邮箱验证码，新密码需为 10–128 位' })
    const hash = await bcrypt.hash(parsed.data.password, 12)
    const result = await inTransaction(async (client) => {
      const security = await emailSecurity(client)
      const user = (
        await client.query<{ uid: string; uuid: string; email: string; retry: number }>(
          `SELECT uid,uuid,email,GREATEST(0,CEIL(EXTRACT(EPOCH FROM password_changed_at+$2*INTERVAL '1 second'-NOW())))::int AS retry FROM users WHERE uid=$1 FOR UPDATE`,
          [request.user.uid, security.passwordChangeSeconds],
        )
      ).rows[0]!
      if (user.retry) return { error: `请在 ${user.retry} 秒后再更改密码`, status: 429 }
      const challenge = await verifyEmailCode(
        client,
        user.email.toLowerCase(),
        'password_change',
        parsed.data.code,
      )
      if (!challenge) return { error: '验证码错误、已过期或尝试次数过多', status: 400 }
      await client.query('UPDATE email_challenges SET consumed_at=NOW() WHERE id=$1', [challenge])
      const updated = await client.query<{ session_version: number }>(
        'UPDATE users SET password_hash=$2,password_changed_at=NOW(),session_version=session_version+1,email_verified_at=COALESCE(email_verified_at,NOW()) WHERE uid=$1 RETURNING session_version',
        [user.uid, hash],
      )
      await client.query(
        "UPDATE email_challenges SET consumed_at=NOW() WHERE user_uid=$1 AND purpose IN ('password_change','password_reset') AND consumed_at IS NULL",
        [user.uid],
      )
      return {
        token: app.jwt.sign(
          { uid: user.uid, uuid: user.uuid, sessionVersion: updated.rows[0]!.session_version },
          { expiresIn: '7d' },
        ),
      }
    })
    if ('error' in result) return reply.code(result.status!).send({ error: result.error })
    return { changed: true, token: result.token }
  })
}
