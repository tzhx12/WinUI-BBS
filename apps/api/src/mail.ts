import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt } from 'node:crypto'
import nodemailer from 'nodemailer'
import { ImapFlow } from 'imapflow'
import { z } from 'zod'
import type { PoolClient } from 'pg'
import { inTransaction } from './db.js'
import { readSettings } from './settings.js'

export const mailError = (message: string, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode })
export const emailSecuritySchema = z.object({
  registrationVerification: z.boolean(),
  codeMinutes: z.number().int().min(1).max(1440),
  resendSeconds: z.number().int().min(60).max(3600),
  recoveryEnabled: z.boolean(),
  resetMinutes: z.number().int().min(1).max(1440),
  recoveryDailyLimit: z.number().int().min(1).max(10),
  passwordChangeSeconds: z.number().int().min(60).max(86400),
})
export type EmailSecurity = z.infer<typeof emailSecuritySchema>
const endpointSchema = z.object({
  host: z.string().trim().max(253),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().trim().max(320),
  password: z.string().max(2000).default(''),
})
export const mailTransportSchema = z.object({
  enabled: z.boolean(),
  fromName: z.string().trim().min(1).max(80),
  fromAddress: z.union([z.email(), z.literal('')]),
  smtp: endpointSchema,
  imap: endpointSchema.extend({ enabled: z.boolean() }),
})
export type MailTransport = z.infer<typeof mailTransportSchema>
function encryptionKey() {
  const key = Buffer.from(process.env.MAIL_ENCRYPTION_KEY || '', 'base64')
  if (key.length !== 32) throw mailError('请先在服务端配置 MAIL_ENCRYPTION_KEY，再保存发信凭据', 503)
  return key
}
export function encryptMailSecret(secret: string) {
  if (!secret) return ''
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), ciphertext].map((v) => v.toString('base64')).join('.')
}
function decryptMailSecret(secret: string) {
  if (!secret) return ''
  const [iv, tag, ciphertext] = secret.split('.').map((v) => Buffer.from(v, 'base64'))
  const cipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv!)
  cipher.setAuthTag(tag!)
  return Buffer.concat([cipher.update(ciphertext!), cipher.final()]).toString('utf8')
}
export async function emailSecurity(client?: PoolClient) {
  return (await readSettings(['email_security'], client)).email_security as EmailSecurity
}
export async function readMailTransport() {
  return (await readSettings(['mail_transport'])).mail_transport as MailTransport
}
export function publicMailTransport(config: MailTransport) {
  return {
    ...config,
    smtp: { ...config.smtp, password: '', hasPassword: Boolean(config.smtp.password) },
    imap: { ...config.imap, password: '', hasPassword: Boolean(config.imap.password) },
  }
}
export async function sendEmail(to: string, subject: string, text: string, config?: MailTransport) {
  const value = config ?? (await readMailTransport())
  if (!value.enabled || !value.smtp.host || !value.fromAddress) throw mailError('站点尚未配置发信服务', 503)
  const transport = nodemailer.createTransport({
    host: value.smtp.host,
    port: value.smtp.port,
    secure: value.smtp.secure,
    requireTLS: !value.smtp.secure,
    auth: { user: value.smtp.user, pass: decryptMailSecret(value.smtp.password) },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 25000,
  })
  try {
    const result = await transport.sendMail({
      from: { name: value.fromName, address: value.fromAddress },
      to,
      subject,
      text,
    })
    if (!result.accepted.length) throw new Error('No accepted recipients')
  } catch {
    throw mailError('邮件发送失败，请检查发信设置或稍后重试', 502)
  } finally {
    transport.close()
  }
}
export async function checkImap(config: MailTransport) {
  if (!config.imap.enabled) throw mailError('请先启用并保存 IMAP 设置')
  const client = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    doSTARTTLS: !config.imap.secure,
    auth: { user: config.imap.user, pass: decryptMailSecret(config.imap.password) },
    logger: false,
    clientInfo: { name: 'WinUI-BBS', version: '0.1.0' },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  })
  client.on('error', () => {})
  try {
    await client.connect()
    await client.logout()
  } catch {
    throw mailError('IMAP 连接失败，请检查收信设置', 502)
  } finally {
    client.close()
  }
}
export function challengeHash(secret: string) {
  return createHmac('sha256', encryptionKey()).update(secret).digest('hex')
}
export async function verifyEmailCode(client: PoolClient, email: string, purpose: string, code: string) {
  const result = await client.query<{ id: string; secret_hash: string }>(
    `SELECT id, secret_hash FROM email_challenges WHERE email=$1 AND purpose=$2 AND consumed_at IS NULL
     AND expires_at>NOW() AND attempts<5 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [email, purpose],
  )
  const challenge = result.rows[0]
  if (!challenge) return null
  if (challenge.secret_hash !== challengeHash(code)) {
    await client.query('UPDATE email_challenges SET attempts=attempts+1 WHERE id=$1', [challenge.id])
    return null
  }
  return challenge.id
}
export async function issueEmailChallenge(
  email: string,
  purpose: 'registration' | 'password_change' | 'password_reset',
  uid?: string,
) {
  const security = await emailSecurity()
  const config = await readMailTransport()
  if (!config.enabled) throw mailError('站点尚未配置发信服务', 503)
  return inTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`email:${email}`])
    const rate = await client.query<{ retry: number }>(
      `SELECT GREATEST(0, CEIL(EXTRACT(EPOCH FROM MAX(sent_at)+$2*INTERVAL '1 second'-NOW())))::int AS retry
       FROM email_deliveries WHERE email=$1`,
      [email, security.resendSeconds],
    )
    if (rate.rows[0]?.retry) throw mailError(`请在 ${rate.rows[0].retry} 秒后再获取邮件`, 429)
    if (purpose === 'password_reset') {
      const count = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM email_deliveries WHERE email=$1 AND purpose='password_reset'
         AND (sent_at AT TIME ZONE $2)::date=(NOW() AT TIME ZONE $2)::date`,
        [email, process.env.SITE_TIMEZONE || 'Asia/Singapore'],
      )
      if (count.rows[0]!.count >= security.recoveryDailyLimit)
        throw mailError('今天的找回密码次数已用完，请明天再试', 429)
    }
    const secret =
      purpose === 'password_reset'
        ? randomBytes(32).toString('base64url')
        : String(randomInt(100000, 1000000))
    const minutes = purpose === 'password_reset' ? security.resetMinutes : security.codeMinutes
    let body: string
    const site = await readSettings(['site_title', 'site_url'], client)
    if (purpose === 'password_reset') {
      if (!site.site_url) throw mailError('请先在站点设置中配置站点 URL', 503)
      const link = `${String(site.site_url).replace(/\/$/, '')}/#/reset-password?token=${secret}`
      body = `请在 ${minutes} 分钟内打开以下链接设置新密码：\n\n${link}\n\n链接仅可使用一次。如果不是你发起的操作，请忽略此邮件。`
    } else
      body = `你的${purpose === 'registration' ? '注册' : '修改密码'}验证码是：${secret}\n\n有效期 ${minutes} 分钟，仅可使用一次。请勿将验证码告诉他人。`
    await client.query(
      'UPDATE email_challenges SET consumed_at=NOW() WHERE email=$1 AND purpose=$2 AND consumed_at IS NULL',
      [email, purpose],
    )
    await client.query(
      `INSERT INTO email_challenges(email,purpose,secret_hash,user_uid,expires_at)
       VALUES($1,$2,$3,$4,NOW()+$5*INTERVAL '1 minute')`,
      [email, purpose, challengeHash(secret), uid ?? null, minutes],
    )
    await sendEmail(
      email,
      `${site.site_title} · ${purpose === 'password_reset' ? '找回密码' : purpose === 'registration' ? '注册验证码' : '修改密码验证码'}`,
      body,
      config,
    )
    await client.query(
      "UPDATE email_challenges SET expires_at=clock_timestamp()+$3*INTERVAL '1 minute' WHERE email=$1 AND purpose=$2 AND consumed_at IS NULL",
      [email, purpose, minutes],
    )
    await client.query(
      'INSERT INTO email_deliveries(email,purpose,sent_at) VALUES($1,$2,clock_timestamp())',
      [email, purpose],
    )
    return { sent: true, expiresInMinutes: minutes, retryAfterSeconds: security.resendSeconds }
  })
}
