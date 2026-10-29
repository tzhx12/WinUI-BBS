import bcrypt from 'bcryptjs'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../auth.js'
import { effectiveLevel, inTransaction, query } from '../db.js'
import { grantLevelInvitations } from '../invitations.js'
import { verifyEmailCode } from '../mail.js'

const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[a-zA-Z0-9_.-]+$/)
const displayNameSchema = z.string().trim().min(1).max(48)
const usernameChangeAvailableAtSql = `CASE
  WHEN u.username_changed_at > NOW() - INTERVAL '180 days'
    AND NOT EXISTS (
      SELECT 1 FROM group_memberships gm JOIN user_groups g ON g.id = gm.group_id
      WHERE gm.user_uid = u.uid AND g.group_type = 'management'
        AND (gm.expires_at IS NULL OR gm.expires_at > NOW())
    )
  THEN u.username_changed_at + INTERVAL '180 days'
  ELSE NULL END`
const credentialsSchema = z.object({
  username: usernameSchema,
  email: z.email(),
  displayName: displayNameSchema,
  password: z.string().min(10).max(128),
  invitationCode: z.string().trim().max(80).optional(),
  verificationCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
})

function siteDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.SITE_TIMEZONE ?? 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.patch('/api/me/profile', { preHandler: authenticate }, async (request, reply) => {
    const parsed = z
      .object({ username: usernameSchema.optional(), displayName: displayNameSchema.optional() })
      .strict()
      .refine((value) => Object.keys(value).length > 0)
      .safeParse(request.body)
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: '用户名需为 3–32 位字母、数字、下划线、点或连字符，昵称需为 1–48 个字符' })
    try {
      return await inTransaction(async (client) => {
        const current = await client.query<{ username: string; username_change_available_at: Date | null }>(
          `SELECT u.username, ${usernameChangeAvailableAtSql} AS username_change_available_at
           FROM users u WHERE u.uid = $1 FOR UPDATE`,
          [request.user.uid],
        )
        const user = current.rows[0]!
        const username = parsed.data.username?.toLowerCase()
        const renaming = username !== undefined && username !== user.username
        if (renaming) {
          const conflict = await client.query(
            'SELECT 1 FROM users WHERE lower(username) = $1 AND uid <> $2',
            [username, request.user.uid],
          )
          if (conflict.rowCount) throw Object.assign(new Error('此用户名已被使用'), { statusCode: 409 })
          if (user.username_change_available_at) {
            const date = new Intl.DateTimeFormat('zh-CN', {
              timeZone: process.env.SITE_TIMEZONE ?? 'Asia/Singapore',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            }).format(user.username_change_available_at)
            throw Object.assign(new Error(`180 天内只能修改一次用户名，可在 ${date} 后再次修改`), {
              statusCode: 409,
            })
          }
        }
        const result = await client.query<{ username: string; displayName: string }>(
          `UPDATE users SET username = COALESCE($2, username), display_name = COALESCE($3, display_name),
             username_changed_at = CASE WHEN $4 THEN NOW() ELSE username_changed_at END
           WHERE uid = $1 RETURNING username, display_name AS "displayName"`,
          [request.user.uid, username ?? null, parsed.data.displayName ?? null, renaming],
        )
        return result.rows[0]
      })
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        return reply.code(409).send({ error: '此用户名已被使用' })
      throw error
    }
  })

  app.post('/api/auth/register', async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '请检查用户名、邮箱和密码格式' })
    const { email, displayName, password } = parsed.data
    const username = parsed.data.username.toLowerCase()
    const passwordHash = await bcrypt.hash(password, 12)

    try {
      const user = await inTransaction(async (client) => {
        const registration = await client.query<{ setting_key: string; setting_value: unknown }>(
          "SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN ('registration_enabled', 'registration_mode', 'email_security') FOR SHARE",
        )
        const settings = Object.fromEntries(
          registration.rows.map((row) => [row.setting_key, row.setting_value]),
        )
        if (!settings.registration_enabled)
          throw Object.assign(new Error('站点暂未开放注册'), { statusCode: 403 })
        let challenge: string | null = null
        if ((settings.email_security as { registrationVerification: boolean }).registrationVerification) {
          challenge = await verifyEmailCode(
            client,
            email.toLowerCase(),
            'registration',
            parsed.data.verificationCode || '',
          )
          if (!challenge) return null
        }
        const code = parsed.data.invitationCode
        let invitationId: string | null = null
        if (settings.registration_mode === 'invite' || code) {
          const invitation = await client.query<{ id: string }>(
            `UPDATE invitations SET used_count = used_count + 1 WHERE code = $1 AND is_enabled
             AND used_count < max_uses AND (expires_at IS NULL OR expires_at > NOW()) RETURNING id`,
            [code ?? ''],
          )
          if (!invitation.rows[0])
            throw Object.assign(new Error('邀请码无效、已过期或已用完'), { statusCode: 400 })
          invitationId = invitation.rows[0].id
        }
        const inserted = await client.query<{
          uid: string
          uuid: string
          username: string
          display_name: string
        }>(
          `INSERT INTO users (username, email, password_hash, display_name)
           VALUES ($1, $2, $3, $4)
           RETURNING uid, uuid, username, display_name`,
          [username, email.toLowerCase(), passwordHash, displayName],
        )
        const user = inserted.rows[0]!
        if (challenge) {
          await client.query('UPDATE email_challenges SET consumed_at=NOW() WHERE id=$1', [challenge])
          await client.query('UPDATE users SET email_verified_at=NOW() WHERE uid=$1', [user.uid])
        }
        if (invitationId)
          await client.query('INSERT INTO invitation_uses (invitation_id, user_uid) VALUES ($1, $2)', [
            invitationId,
            user.uid,
          ])
        const defaultGroup = await client.query<{ id: string }>(
          'SELECT id FROM user_groups WHERE is_default = TRUE LIMIT 1',
        )
        if (defaultGroup.rows[0]) {
          await client.query('INSERT INTO group_memberships (user_uid, group_id) VALUES ($1, $2)', [
            user.uid,
            defaultGroup.rows[0].id,
          ])
        }
        await grantLevelInvitations(user.uid, client)
        return user
      })
      if (!user)
        return reply.code(400).send({ error: '请填写正确的邮箱验证码，验证码可能已过期或尝试次数过多' })
      const token = app.jwt.sign({ uid: user.uid, uuid: user.uuid }, { expiresIn: '7d' })
      return reply.code(201).send({ token, user: { ...user, level: 1, experience: 0 } })
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        return reply.code(409).send({ error: '用户名或邮箱已被使用' })
      throw error
    }
  })

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = z
      .object({ identity: z.string().trim().min(1), password: z.string().min(1) })
      .safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '请输入账号和密码' })
    const result = await query<{
      uid: string
      uuid: string
      username: string
      email: string
      display_name: string
      password_hash: string
      experience: string
      level_offset: number
      status: string
      is_banned: boolean
      banned_until: Date | null
      session_version: number
    }>(
      `SELECT uid, uuid, username, email, display_name, password_hash, experience, level_offset, status,
              banned_until, session_version, COALESCE(banned_until > NOW(), FALSE) AS is_banned
       FROM users WHERE lower(username) = lower($1) OR lower(email) = lower($1) LIMIT 1`,
      [parsed.data.identity],
    )
    const user = result.rows[0]
    if (
      !user ||
      user.status !== 'active' ||
      !(await bcrypt.compare(parsed.data.password, user.password_hash))
    ) {
      return reply.code(401).send({ error: '账号或密码不正确' })
    }
    const token = app.jwt.sign(
      { uid: user.uid, uuid: user.uuid, sessionVersion: user.session_version },
      { expiresIn: '7d' },
    )
    const level = await effectiveLevel(user.experience, user.level_offset)
    return {
      token,
      user: {
        uid: user.uid,
        uuid: user.uuid,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        experience: Number(user.experience),
        level,
      },
    }
  })

  app.get('/api/auth/me', { preHandler: authenticate }, async (request, reply) => {
    const result = await query<{
      uid: string
      uuid: string
      username: string
      email: string
      display_name: string
      experience: string
      level_offset: number
      avatar_url: string | null
      username_change_available_at: Date | null
    }>(
      `SELECT u.uid, u.uuid, u.username, u.email, u.display_name, u.experience, u.level_offset, u.avatar_url,
              ${usernameChangeAvailableAtSql} AS username_change_available_at
       FROM users u WHERE u.uid = $1`,
      [request.user.uid],
    )
    const user = result.rows[0]
    if (!user) return reply.code(401).send({ error: '账号不可用' })
    if (!request.user.isBanned) await grantLevelInvitations(user.uid)
    const [level, groups, permissionRows, checkin, progress] = await Promise.all([
      effectiveLevel(user.experience, user.level_offset),
      query<{ id: string; name: string; group_type: string; expires_at: Date | null }>(
        `SELECT g.id, g.name, g.group_type, gm.expires_at
         FROM group_memberships gm JOIN user_groups g ON g.id = gm.group_id
         WHERE gm.user_uid = $1 AND (gm.expires_at IS NULL OR gm.expires_at > NOW()) ORDER BY g.name`,
        [user.uid],
      ),
      query<{ permission_key: string }>(
        `SELECT DISTINCT gp.permission_key FROM group_memberships gm
         JOIN group_permissions gp ON gp.group_id = gm.group_id
         WHERE gm.user_uid = $1 AND (gm.expires_at IS NULL OR gm.expires_at > NOW())`,
        [user.uid],
      ),
      query<{ checked_in: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM daily_checkins WHERE user_uid = $1 AND checkin_date = $2) AS checked_in`,
        [user.uid, siteDate()],
      ),
      query<{ points_per_level: number; checkin_points: number | null }>(
        `SELECT
           (SELECT setting_value::text::integer FROM app_settings WHERE setting_key = 'points_per_level') AS points_per_level,
           (SELECT points FROM experience_rules WHERE action_key = 'checkin' AND is_enabled = TRUE) AS checkin_points`,
      ),
    ])
    const title = await query<{ title: string; color: string }>(
      'SELECT title, color FROM level_titles WHERE minimum_level <= $1 AND maximum_level >= $1 ORDER BY minimum_level DESC LIMIT 1',
      [level],
    )
    return {
      uid: user.uid,
      uuid: user.uuid,
      username: user.username,
      usernameChangeAvailableAt: user.username_change_available_at,
      email: user.email,
      displayName: user.display_name,
      experience: Number(user.experience),
      level,
      avatarUrl: user.avatar_url,
      groups: groups.rows,
      permissions: request.user.isBanned ? [] : permissionRows.rows.map((row) => row.permission_key),
      isBanned: request.user.isBanned,
      bannedUntil: request.user.bannedUntil,
      title: title.rows[0] ?? null,
      checkedIn: checkin.rows[0]?.checked_in ?? false,
      pointsPerLevel: progress.rows[0]?.points_per_level ?? 100,
      checkinPoints: progress.rows[0]?.checkin_points ?? 0,
    }
  })

  app.post('/api/check-in', { preHandler: authenticate }, async (request, reply) => {
    const today = siteDate()
    const result = await inTransaction(async (client) => {
      const rule = await client.query<{ points: number; is_enabled: boolean }>(
        "SELECT points, is_enabled FROM experience_rules WHERE action_key = 'checkin'",
      )
      if (!rule.rows[0]?.is_enabled) return { disabled: true as const }
      const inserted = await client.query(
        'INSERT INTO daily_checkins (user_uid, checkin_date, points) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING user_uid',
        [request.user.uid, today, rule.rows[0].points],
      )
      if (!inserted.rowCount) return { alreadyCheckedIn: true as const }
      const award = await client.query<{ experience: string; level_offset: number }>(
        'UPDATE users SET experience = experience + $2 WHERE uid = $1 RETURNING experience, level_offset',
        [request.user.uid, rule.rows[0].points],
      )
      const updatedUser = award.rows[0]!
      const level = await effectiveLevel(updatedUser.experience, updatedUser.level_offset)
      await grantLevelInvitations(request.user.uid, client)
      return { points: rule.rows[0].points, experience: Number(updatedUser.experience), level }
    })
    if ('disabled' in result) return reply.code(409).send({ error: '签到暂未开放' })
    if ('alreadyCheckedIn' in result) return reply.code(409).send({ error: '今天已经签到' })
    return result
  })
}
