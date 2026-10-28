import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { adminPermissions, authenticate } from '../auth.js'
import { inTransaction, query } from '../db.js'

export async function registerNotificationRoutes(app: FastifyInstance) {
  app.get(
    '/api/admin/notification-groups',
    { preHandler: adminPermissions.settings },
    async () => (await query('SELECT id, name FROM user_groups ORDER BY name')).rows,
  )
  app.get('/api/me/notifications/unread', { preHandler: authenticate }, async (request) => {
    const result = await query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM notification_recipients WHERE user_uid = $1 AND read_at IS NULL',
      [request.user.uid],
    )
    return result.rows[0]
  })
  app.get('/api/me/notifications', { preHandler: authenticate }, async (request, reply) => {
    const parsed = z.object({ before: z.string().regex(/^\d+$/).optional() }).safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: '通知分页参数无效' })
    return (
      await query(
        `SELECT n.id, n.title, n.body, n.kind, n.post_id, n.created_at, r.read_at,
              u.display_name AS sender_name
       FROM notification_recipients r JOIN notifications n ON n.id = r.notification_id
       LEFT JOIN users u ON u.uid = n.sender_uid
       WHERE r.user_uid = $1 AND ($2::bigint IS NULL OR n.id < $2)
       ORDER BY n.id DESC LIMIT 50`,
        [request.user.uid, parsed.data.before ?? null],
      )
    ).rows
  })
  app.post('/api/me/notifications/read-all', { preHandler: authenticate }, async (request) => {
    await query(
      'UPDATE notification_recipients SET read_at = NOW() WHERE user_uid = $1 AND read_at IS NULL',
      [request.user.uid],
    )
    return { read: true }
  })
  app.post('/api/me/notifications/:id/read', { preHandler: authenticate }, async (request, reply) => {
    const result = await query(
      'UPDATE notification_recipients SET read_at = COALESCE(read_at, NOW()) WHERE notification_id = $1 AND user_uid = $2 RETURNING notification_id',
      [(request.params as { id: string }).id, request.user.uid],
    )
    if (!result.rowCount) return reply.code(404).send({ error: '通知不存在' })
    return { read: true }
  })
  app.get(
    '/api/admin/notifications',
    { preHandler: adminPermissions.settings },
    async () =>
      (
        await query(
          `SELECT n.id, n.title, n.body, n.audience, n.created_at, u.display_name AS sender_name,
              COUNT(r.user_uid)::int AS recipient_count, COUNT(r.read_at)::int AS read_count
       FROM notifications n LEFT JOIN notification_recipients r ON r.notification_id = n.id
       LEFT JOIN users u ON u.uid = n.sender_uid WHERE n.kind = 'announcement'
       GROUP BY n.id, u.uid ORDER BY n.id DESC LIMIT 100`,
        )
      ).rows,
  )
  app.post('/api/admin/notifications', { preHandler: adminPermissions.settings }, async (request, reply) => {
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
    if (!parsed.success) return reply.code(400).send({ error: '请填写通知标题、正文和接收范围' })
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
        [request.user.uid, id, JSON.stringify({ audience, recipientCount: recipients.rowCount })],
      )
      return { id, recipientCount: recipients.rowCount }
    })
    if (!result) return reply.code(400).send({ error: '接收范围内没有可接收通知的用户' })
    return reply.code(201).send(result)
  })
}
