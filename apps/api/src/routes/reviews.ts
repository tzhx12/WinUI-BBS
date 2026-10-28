import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { adminPermissions, requirePermission } from '../auth.js'
import { inTransaction, query } from '../db.js'
import { readSettings, saveSettings } from '../settings.js'
import { sendReviewNotification } from '../notifications.js'

export async function registerReviewRoutes(app: FastifyInstance) {
  app.get('/api/admin/review-settings', { preHandler: adminPermissions.settings }, async () =>
    readSettings(['posts_require_review']),
  )
  app.patch(
    '/api/admin/review-settings',
    { preHandler: adminPermissions.settings },
    async (request, reply) => {
      const parsed = z.object({ requireReview: z.boolean() }).safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: '审核设置无效' })
      await inTransaction(async (client) => {
        await saveSettings({ posts_require_review: parsed.data.requireReview }, client)
        await client.query(
          `INSERT INTO audit_events (actor_uid, action_key, target_type, details)
         VALUES ($1, 'review.settings.update', 'site', $2::jsonb)`,
          [request.user.uid, JSON.stringify(parsed.data)],
        )
      })
      return { saved: true }
    },
  )
  const guard = requirePermission('posts.review')
  app.get('/api/admin/reviews', { preHandler: guard }, async (request, reply) => {
    const parsed = z
      .object({
        status: z.enum(['pending', 'published', 'rejected']).default('pending'),
      })
      .safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: '审核筛选无效' })
    return (
      await query(
        `SELECT p.id, p.title, p.status, p.created_at, host(p.author_ip) AS author_ip,
              p.review_reason, p.reviewed_at, c.name AS category_name,
              u.uid AS author_uid, u.username, u.display_name,
              reviewer.display_name AS reviewer_name,
              ARRAY(SELECT g.name FROM group_memberships gm JOIN user_groups g ON g.id = gm.group_id
                    WHERE gm.user_uid = u.uid AND (gm.expires_at IS NULL OR gm.expires_at > NOW()) ORDER BY g.name) AS groups
       FROM posts p JOIN categories c ON c.id = p.category_id JOIN users u ON u.uid = p.author_uid
       LEFT JOIN users reviewer ON reviewer.uid = p.reviewed_by
       WHERE p.deleted_at IS NULL AND p.status = $1 AND ($1 = 'pending' OR p.reviewed_at IS NOT NULL)
       ORDER BY p.created_at DESC LIMIT 200`,
        [parsed.data.status],
      )
    ).rows
  })
  app.get('/api/admin/reviews/:id', { preHandler: guard }, async (request, reply) => {
    const result = await query(
      `SELECT p.id, p.title, p.body, p.status, p.created_at, host(p.author_ip) AS author_ip,
              p.review_reason, c.name AS category_name, u.uid AS author_uid, u.display_name,
              ARRAY(SELECT g.name FROM group_memberships gm JOIN user_groups g ON g.id = gm.group_id
                    WHERE gm.user_uid = u.uid AND (gm.expires_at IS NULL OR gm.expires_at > NOW()) ORDER BY g.name) AS groups
       FROM posts p JOIN categories c ON c.id = p.category_id JOIN users u ON u.uid = p.author_uid
       WHERE p.id = $1 AND p.deleted_at IS NULL AND (p.status = 'pending' OR p.reviewed_at IS NOT NULL)`,
      [(request.params as { id: string }).id],
    )
    if (!result.rows[0]) return reply.code(404).send({ error: '审核帖子不存在' })
    return result.rows[0]
  })
  app.post('/api/admin/reviews/:id/decision', { preHandler: guard }, async (request, reply) => {
    const parsed = z
      .object({
        action: z.enum(['approve', 'reject', 'ban']),
        reason: z.string().trim().max(2000).default(''),
        banMinutes: z
          .number()
          .int()
          .min(30)
          .max(1095 * 24 * 60)
          .optional(),
      })
      .refine((v) => v.action === 'approve' || v.reason.length > 0)
      .refine((v) => v.action !== 'ban' || v.banMinutes !== undefined)
      .safeParse(request.body)
    if (!parsed.success)
      return reply.code(400).send({
        error: '拒绝或封禁需填写原因；封禁需设置 30 分钟至 1095 天的期限',
      })
    const { id } = request.params as { id: string }
    const { action, reason, banMinutes } = parsed.data
    const result = await inTransaction(async (client) => {
      const post = await client.query<{ author_uid: string; title: string }>(
        "SELECT author_uid, title FROM posts WHERE id = $1 AND status = 'pending' AND deleted_at IS NULL FOR UPDATE",
        [id],
      )
      if (!post.rows[0]) return null
      const author = post.rows[0].author_uid
      if (action === 'ban') {
        // The same lock serializes reviewer bans, preserving an available manager.
        await client.query("SELECT pg_advisory_xact_lock(hashtext('forum-review-bans'))")
        const protectedUser = await client.query(
          `SELECT 1 WHERE $1::bigint = $2::bigint OR (
            EXISTS (SELECT 1 FROM group_memberships gm JOIN group_permissions gp ON gp.group_id = gm.group_id
              WHERE gm.user_uid = $1 AND gp.permission_key = 'groups.manage' AND (gm.expires_at IS NULL OR gm.expires_at > NOW()))
            AND NOT EXISTS (SELECT 1 FROM group_memberships gm JOIN group_permissions gp ON gp.group_id = gm.group_id
              JOIN users u ON u.uid = gm.user_uid WHERE u.uid <> $1 AND u.status = 'active'
              AND (u.banned_until IS NULL OR u.banned_until <= NOW()) AND gp.permission_key = 'groups.manage'
              AND (gm.expires_at IS NULL OR gm.expires_at > NOW())))`,
          [author, request.user.uid],
        )
        if (protectedUser.rowCount)
          throw Object.assign(new Error('不能封禁自己或最后一位可用管理员'), {
            statusCode: 409,
          })
        await client.query(
          "UPDATE users SET banned_until = GREATEST(banned_until, NOW() + $2 * INTERVAL '1 minute') WHERE uid = $1",
          [author, banMinutes],
        )
      }
      await client.query(
        `UPDATE posts SET status = $2, reviewed_by = $3, reviewed_at = NOW(), review_reason = $4, updated_at = NOW() WHERE id = $1`,
        [id, action === 'approve' ? 'published' : 'rejected', request.user.uid, reason],
      )
      if (action !== 'approve')
        await sendReviewNotification(
          client,
          author,
          request.user.uid,
          id,
          action === 'ban' ? '发帖审核未通过，账号已封禁' : '发帖审核未通过',
          `你的帖子《${post.rows[0].title}》未通过审核。\n原因：${reason}${action === 'ban' ? `\n账号封禁期限：${banMinutes} 分钟。` : ''}`,
        )
      await client.query(
        `INSERT INTO audit_events (actor_uid, action_key, target_type, target_id, details)
         VALUES ($1, $2, 'post', $3, $4::jsonb)`,
        [
          request.user.uid,
          `post.review.${action}`,
          id,
          JSON.stringify({ reason, banMinutes, authorUid: author }),
        ],
      )
      return { id, status: action === 'approve' ? 'published' : 'rejected' }
    })
    if (!result) return reply.code(409).send({ error: '帖子已处理、已删除或不在待审核队列中' })
    return result
  })
}
