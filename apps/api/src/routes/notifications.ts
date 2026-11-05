import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { adminPermissions, authenticate } from '../auth.js'
import { inTransaction, query } from '../db.js'

export async function registerNotificationRoutes(app: FastifyInstance) {
  app.get(
    '/api/admin/notification-groups',
    { preHandler: adminPermissions.settings },
    async () =>
      (await query('SELECT id, name FROM user_groups ORDER BY name')).rows,
  )
  app.get(
    '/api/me/notifications/unread',
    { preHandler: authenticate },
    async (request) => {
      const result = await query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM notification_recipients r
       JOIN notifications n ON n.id=r.notification_id
       WHERE r.user_uid=$1 AND r.read_at IS NULL
         AND NOT EXISTS(SELECT 1 FROM notification_blocks b WHERE b.user_uid=r.user_uid AND b.blocked_uid=n.sender_uid)`,
        [request.user.uid],
      )
      return result.rows[0]
    },
  )
  app.get(
    '/api/me/notifications',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = z
        .object({
          before: z.string().regex(/^\d+$/).optional(),
          kind: z.enum(['all', 'reply']).default('all'),
          page: z.coerce.number().int().min(1).max(1000000).default(1),
        })
        .safeParse(request.query)
      if (!parsed.success)
        return reply.code(400).send({ error: '通知分页参数无效' })
      const limit = parsed.data.kind === 'reply' ? 20 : 50
      if (parsed.data.kind === 'reply') {
        const count = await query<{ total: number }>(
          `SELECT COUNT(*)::int AS total FROM notification_recipients r JOIN notifications n ON n.id=r.notification_id
         WHERE r.user_uid=$1 AND n.kind='reply'
           AND NOT EXISTS(SELECT 1 FROM notification_blocks b WHERE b.user_uid=r.user_uid AND b.blocked_uid=n.sender_uid)`,
          [request.user.uid],
        )
        const total = count.rows[0]!.total
        const totalPages = Math.max(1, Math.ceil(total / limit))
        const page = Math.min(parsed.data.page, totalPages)
        const notices = await query(
          `SELECT n.id,n.title,n.body,n.kind,n.post_id,n.reply_id,p.status AS post_status,c.slug AS category_slug,n.created_at,r.read_at,
           u.display_name AS sender_name
         FROM notification_recipients r JOIN notifications n ON n.id=r.notification_id
         LEFT JOIN users u ON u.uid=n.sender_uid LEFT JOIN posts p ON p.id=n.post_id LEFT JOIN categories c ON c.id=p.category_id
         WHERE r.user_uid=$1 AND n.kind='reply'
           AND NOT EXISTS(SELECT 1 FROM notification_blocks b WHERE b.user_uid=r.user_uid AND b.blocked_uid=n.sender_uid)
         ORDER BY n.id DESC LIMIT $2 OFFSET $3`,
          [request.user.uid, limit, (page - 1) * limit],
        )
        return {
          notices: notices.rows,
          page,
          pageSize: limit,
          total,
          totalPages,
        }
      }
      return (
        await query(
          `SELECT n.id, n.title, n.body, n.kind, n.post_id, n.reply_id, p.status AS post_status, c.slug AS category_slug, n.created_at, r.read_at,
              u.display_name AS sender_name
       FROM notification_recipients r JOIN notifications n ON n.id = r.notification_id
       LEFT JOIN users u ON u.uid = n.sender_uid
       LEFT JOIN posts p ON p.id = n.post_id LEFT JOIN categories c ON c.id = p.category_id
       WHERE r.user_uid=$1 AND ($2::bigint IS NULL OR n.id<$2) AND ($3='all' OR n.kind=$3)
         AND NOT EXISTS(SELECT 1 FROM notification_blocks b WHERE b.user_uid=r.user_uid AND b.blocked_uid=n.sender_uid)
       ORDER BY n.id DESC LIMIT $4`,
          [
            request.user.uid,
            parsed.data.before ?? null,
            parsed.data.kind,
            limit,
          ],
        )
      ).rows
    },
  )
  app.post(
    '/api/me/notifications/read-all',
    { preHandler: authenticate },
    async (request) => {
      await query(
        `UPDATE notification_recipients r SET read_at=NOW() FROM notifications n
       WHERE n.id=r.notification_id AND r.user_uid=$1 AND r.read_at IS NULL
         AND NOT EXISTS(SELECT 1 FROM notification_blocks b WHERE b.user_uid=r.user_uid AND b.blocked_uid=n.sender_uid)`,
        [request.user.uid],
      )
      return { read: true }
    },
  )
  app.get(
    '/api/me/notification-blocks',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = z
        .object({
          page: z.coerce.number().int().min(1).max(1000000).default(1),
        })
        .safeParse(request.query)
      if (!parsed.success)
        return reply.code(400).send({ error: '屏蔽列表页码无效' })
      const count = await query<{ total: number }>(
        'SELECT COUNT(*)::int AS total FROM notification_blocks WHERE user_uid=$1',
        [request.user.uid],
      )
      const pageSize = 20
      const total = count.rows[0]!.total
      const totalPages = Math.max(1, Math.ceil(total / pageSize))
      const page = Math.min(parsed.data.page, totalPages)
      const blocks = await query(
        `SELECT b.blocked_uid AS uid,u.username,u.display_name,b.created_at
       FROM notification_blocks b JOIN users u ON u.uid=b.blocked_uid
       WHERE b.user_uid=$1 ORDER BY b.created_at DESC,b.blocked_uid DESC LIMIT $2 OFFSET $3`,
        [request.user.uid, pageSize, (page - 1) * pageSize],
      )
      return { blocks: blocks.rows, page, pageSize, total, totalPages }
    },
  )
  app.post(
    '/api/me/notification-blocks',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = z
        .object({ username: z.string().trim().min(1).max(32) })
        .safeParse(request.body)
      if (!parsed.success)
        return reply.code(400).send({ error: '请输入完整用户名' })
      const result = await query<{
        uid: string
        username: string
        display_name: string
      }>(
        "SELECT uid,username,display_name FROM users WHERE lower(username)=lower($1) AND status='active'",
        [parsed.data.username],
      )
      const target = result.rows[0]
      if (!target) return reply.code(404).send({ error: '没有找到该用户名' })
      if (target.uid === request.user.uid)
        return reply.code(400).send({ error: '不能屏蔽自己的通知' })
      await query(
        'INSERT INTO notification_blocks(user_uid,blocked_uid) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [request.user.uid, target.uid],
      )
      return reply.code(201).send({
        uid: target.uid,
        username: target.username,
        display_name: target.display_name,
      })
    },
  )
  app.delete(
    '/api/me/notification-blocks/:uid',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = z
        .object({ uid: z.string().regex(/^\d+$/) })
        .safeParse(request.params)
      if (!parsed.success)
        return reply.code(400).send({ error: '用户编号无效' })
      await query(
        'DELETE FROM notification_blocks WHERE user_uid=$1 AND blocked_uid=$2',
        [request.user.uid, parsed.data.uid],
      )
      return { removed: true }
    },
  )
  app.post(
    '/api/me/notifications/:id/read',
    { preHandler: authenticate },
    async (request, reply) => {
      const result = await query(
        'UPDATE notification_recipients SET read_at = COALESCE(read_at, NOW()) WHERE notification_id = $1 AND user_uid = $2 RETURNING notification_id',
        [(request.params as { id: string }).id, request.user.uid],
      )
      if (!result.rowCount) return reply.code(404).send({ error: '通知不存在' })
      return { read: true }
    },
  )
  app.get(
    '/api/admin/notifications',
    { preHandler: adminPermissions.settings },
    async () =>
      (
        await query(
          `SELECT n.id, n.title, n.body, n.audience, n.created_at, u.display_name AS sender_name,
              COUNT(r.user_uid)::int AS recipient_count, COUNT(r.read_at)::int AS read_count
       FROM notifications n LEFT JOIN notification_recipients r ON r.notification_id = n.id
       LEFT JOIN users u ON u.uid = n.sender_uid
       LEFT JOIN posts p ON p.id = n.post_id LEFT JOIN categories c ON c.id = p.category_id WHERE n.kind = 'announcement'
       GROUP BY n.id, u.uid ORDER BY n.id DESC LIMIT 100`,
        )
      ).rows,
  )
  app.post(
    '/api/admin/notifications',
    { preHandler: adminPermissions.settings },
    async (request, reply) => {
      const parsed = z
        .object({
          title: z.string().trim().min(1).max(180),
          body: z.string().trim().min(1).max(10000),
          audience: z.discriminatedUnion('type', [
            z.object({ type: z.literal('all') }),
            z.object({
              type: z.literal('group'),
              id: z.string().regex(/^\d+$/),
            }),
            z.object({
              type: z.literal('user'),
              id: z.string().regex(/^\d+$/),
            }),
          ]),
        })
        .safeParse(request.body)
      if (!parsed.success)
        return reply.code(400).send({ error: '请填写通知标题、正文和接收范围' })
      const result = await inTransaction(async (client) => {
        const { title, body, audience } = parsed.data
        const recipients = await client.query<{ uid: string }>(
          `SELECT u.uid FROM users u WHERE u.status = 'active' AND
          ($1 = 'all' OR ($1 = 'user' AND u.uid = $2) OR ($1 = 'group' AND EXISTS (
            SELECT 1 FROM group_memberships gm WHERE gm.user_uid = u.uid AND gm.group_id = $2
            AND (gm.expires_at IS NULL OR gm.expires_at > NOW())
          )))`,
          [audience.type, 'id' in audience ? audience.id : null],
        )
        if (!recipients.rowCount) return null
        const created = await client.query<{ id: string }>(
          `INSERT INTO notifications (title, body, kind, sender_uid, audience)
         VALUES ($1, $2, 'announcement', $3, $4::jsonb) RETURNING id`,
          [title, body, request.user.uid, JSON.stringify(audience)],
        )
        const id = created.rows[0]!.id
        await client.query(
          'INSERT INTO notification_recipients (notification_id, user_uid) SELECT $1, unnest($2::bigint[])',
          [id, recipients.rows.map((row) => row.uid)],
        )
        await client.query(
          `INSERT INTO audit_events (actor_uid, action_key, target_type, target_id, details)
         VALUES ($1, 'notification.send', 'notification', $2, $3::jsonb)`,
          [
            request.user.uid,
            id,
            JSON.stringify({
              title,
              excerpt: body.slice(0, 240),
              audience,
              recipientCount: recipients.rowCount,
            }),
          ],
        )
        return { id, recipientCount: recipients.rowCount }
      })
      if (!result)
        return reply.code(400).send({ error: '接收范围内没有可接收通知的用户' })
      return reply.code(201).send(result)
    },
  )
}
