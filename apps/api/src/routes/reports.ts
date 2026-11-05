import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate, readerLevel, requirePermission } from '../auth.js'
import { inTransaction, query } from '../db.js'

const reportInput = z
  .object({
    targetType: z.enum(['post', 'reply', 'user']),
    postId: z.uuid().optional(),
    replyId: z.uuid().optional(),
    userUid: z.string().regex(/^\d+$/).optional(),
    reason: z.string().trim().min(1, '请填写举报理由').max(2000),
  })
  .superRefine((v, ctx) => {
    if (v.targetType === 'post' && !v.postId)
      ctx.addIssue({ code: 'custom', message: '帖子编号无效' })
    if (v.targetType === 'reply' && (!v.postId || !v.replyId))
      ctx.addIssue({ code: 'custom', message: '回复编号无效' })
    if (v.targetType === 'user' && !v.userUid)
      ctx.addIssue({ code: 'custom', message: '用户编号无效' })
  })

export async function registerReportRoutes(app: FastifyInstance) {
  app.post(
    '/api/reports',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = reportInput.safeParse(request.body)
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: parsed.error.issues[0]?.message || '举报内容无效' })
      const value = parsed.data
      if (value.targetType === 'user' && value.userUid === request.user.uid)
        return reply.code(400).send({ error: '不能举报自己' })
      if (value.targetType === 'user') {
        const target = await query(
          "SELECT 1 FROM users WHERE uid=$1 AND status='active'",
          [value.userUid],
        )
        if (!target.rowCount)
          return reply.code(404).send({ error: '举报目标不存在' })
      } else {
        const target =
          value.targetType === 'post'
            ? await query<{
                author_uid: string
                minimum_reader_level: number
                category_level: number
              }>(
                `SELECT p.author_uid,p.minimum_reader_level,c.minimum_reader_level AS category_level
             FROM posts p JOIN categories c ON c.id=p.category_id
             WHERE p.id=$1 AND p.deleted_at IS NULL AND p.status IN ('published','hidden')`,
                [value.postId],
              )
            : await query<{
                author_uid: string
                post_author_uid: string
                minimum_reader_level: number
                category_level: number
              }>(
                `SELECT r.author_uid,p.author_uid AS post_author_uid,p.minimum_reader_level,c.minimum_reader_level AS category_level
             FROM replies r JOIN posts p ON p.id=r.post_id JOIN categories c ON c.id=p.category_id
             WHERE r.id=$1 AND r.post_id=$2 AND r.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status IN ('published','hidden')`,
                [value.replyId, value.postId],
              )
        const content = target.rows[0]
        if (!content) return reply.code(404).send({ error: '举报目标不存在' })
        if (
          content.author_uid === request.user.uid ||
          ('post_author_uid' in content &&
            content.post_author_uid === request.user.uid)
        )
          return reply.code(400).send({ error: '不能举报自己发布的内容' })
        if (
          Math.max(content.minimum_reader_level, content.category_level) >
          (await readerLevel(request.user.uid))
        )
          return reply.code(403).send({ error: '此内容需要更高等级才能阅读' })
      }
      try {
        const created = await query<{ id: string }>(
          `INSERT INTO content_reports(reporter_uid,target_type,target_post_id,target_reply_id,target_user_uid,reason)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
          [
            request.user.uid,
            value.targetType,
            value.postId ?? null,
            value.replyId ?? null,
            value.userUid ?? null,
            value.reason,
          ],
        )
        return reply.code(201).send({ id: created.rows[0]!.id })
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          return reply
            .code(409)
            .send({ error: '你已举报过该目标，管理员处理中' })
        throw error
      }
    },
  )

  app.get(
    '/api/admin/reports',
    { preHandler: requirePermission('posts.manage') },
    async (request, reply) => {
      const parsed = z
        .object({
          page: z.coerce.number().int().min(1).default(1),
          status: z.enum(['pending', 'resolved', 'all']).default('pending'),
        })
        .safeParse(request.query)
      if (!parsed.success)
        return reply.code(400).send({ error: '举报筛选无效' })
      const where = parsed.data.status === 'all' ? 'TRUE' : 'r.status=$1'
      const args: unknown[] =
        parsed.data.status === 'all' ? [] : [parsed.data.status]
      const count = await query<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM content_reports r WHERE ${where}`,
        args,
      )
      const pageSize = 20
      const total = count.rows[0]!.total
      const totalPages = Math.max(1, Math.ceil(total / pageSize))
      const page = Math.min(parsed.data.page, totalPages)
      args.push(pageSize, (page - 1) * pageSize)
      const rows = await query(
        `SELECT r.id,r.target_type,r.target_post_id,r.target_reply_id,r.target_user_uid,r.reason,r.status,r.resolution,r.created_at,r.resolved_at,
         reporter.display_name AS reporter_name, reporter.uid AS reporter_uid,
         p.title AS post_title,p.status AS post_status,p.author_uid AS post_author_uid,c.slug AS category_slug,
         target_reply.body AS reply_body,target_reply.author_uid AS reply_author_uid,target_reply.floor_number,target_reply.child_number,
         target_user.username AS target_username,target_user.display_name AS target_display_name,target_user.banned_until,
         resolver.display_name AS resolver_name
       FROM content_reports r
       LEFT JOIN users reporter ON reporter.uid=r.reporter_uid
       LEFT JOIN posts p ON p.id=r.target_post_id LEFT JOIN categories c ON c.id=p.category_id
       LEFT JOIN replies target_reply ON target_reply.id=r.target_reply_id
       LEFT JOIN users target_user ON target_user.uid=r.target_user_uid
       LEFT JOIN users resolver ON resolver.uid=r.resolved_by
       WHERE ${where} ORDER BY r.id DESC LIMIT $${args.length - 1} OFFSET $${args.length}`,
        args,
      )
      return { reports: rows.rows, page, pageSize, total, totalPages }
    },
  )

  app.post(
    '/api/admin/reports/:id/resolve',
    { preHandler: requirePermission('posts.manage') },
    async (request, reply) => {
      const parsed = z
        .object({
          action: z.enum([
            'hide',
            'delete',
            'delete_ban',
            'ban',
            'delete_reply',
            'dismiss',
          ]),
          banMinutes: z
            .number()
            .int()
            .min(30)
            .max(1095 * 24 * 60)
            .optional(),
        })
        .refine(
          (v) =>
            !['ban', 'delete_ban'].includes(v.action) ||
            v.banMinutes !== undefined,
        )
        .safeParse(request.body)
      if (!parsed.success)
        return reply.code(400).send({ error: '处理动作无效' })
      const input = parsed.data
      const params = z
        .object({ id: z.string().regex(/^\d+$/) })
        .safeParse(request.params)
      if (!params.success)
        return reply.code(400).send({ error: '举报编号无效' })
      const id = params.data.id
      const result = await inTransaction(async (client) => {
        const report = (
          await client.query<{
            target_type: 'post' | 'reply' | 'user'
            target_post_id: string | null
            target_reply_id: string | null
            target_user_uid: string | null
            reason: string
            status: string
          }>('SELECT * FROM content_reports WHERE id=$1 FOR UPDATE', [id])
        ).rows[0]
        if (!report || report.status !== 'pending') return null
        const action = input.action
        async function banUser(uid: string) {
          await client.query(
            "SELECT pg_advisory_xact_lock(hashtext('forum-review-bans'))",
          )
          const protectedUser = await client.query(
            `SELECT 1 WHERE $1::bigint=1 OR $1::bigint=$2::bigint OR (
             EXISTS(SELECT 1 FROM group_memberships gm JOIN group_permissions gp ON gp.group_id=gm.group_id
               WHERE gm.user_uid=$1 AND gp.permission_key='groups.manage' AND (gm.expires_at IS NULL OR gm.expires_at>NOW()))
             AND NOT EXISTS(SELECT 1 FROM group_memberships gm JOIN group_permissions gp ON gp.group_id=gm.group_id
               JOIN users u ON u.uid=gm.user_uid WHERE u.uid<>$1 AND u.status='active'
                 AND (u.banned_until IS NULL OR u.banned_until<=NOW()) AND gp.permission_key='groups.manage'
                 AND (gm.expires_at IS NULL OR gm.expires_at>NOW())))`,
            [uid, request.user.uid],
          )
          if (protectedUser.rowCount)
            throw Object.assign(
              new Error('不能封禁自己、首位管理员或最后一位可用管理员'),
              { statusCode: 409 },
            )
          await client.query(
            "UPDATE users SET banned_until=GREATEST(COALESCE(banned_until,NOW()),NOW()+$2*INTERVAL '1 minute') WHERE uid=$1",
            [uid, input.banMinutes!],
          )
        }
        if (report.target_type === 'post') {
          if (!['hide', 'delete', 'delete_ban', 'dismiss'].includes(action))
            throw Object.assign(new Error('帖子举报动作无效'), {
              statusCode: 400,
            })
          if (action === 'hide')
            await client.query(
              "UPDATE posts SET status='hidden',updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL",
              [report.target_post_id],
            )
          if (action === 'delete' || action === 'delete_ban')
            await client.query(
              "UPDATE posts SET deleted_at=NOW(),deletion_source='admin',deleted_by=$2,purge_after=NULL,updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL",
              [report.target_post_id, request.user.uid],
            )
          if (action === 'delete_ban') {
            const author = await client.query<{ author_uid: string }>(
              'SELECT author_uid FROM posts WHERE id=$1',
              [report.target_post_id],
            )
            if (author.rows[0]) await banUser(author.rows[0].author_uid)
          }
        } else if (report.target_type === 'user') {
          if (!['ban', 'dismiss'].includes(action))
            throw Object.assign(new Error('用户举报动作无效'), {
              statusCode: 400,
            })
          if (action === 'ban') {
            await banUser(report.target_user_uid!)
          }
        } else {
          if (!['delete_reply', 'dismiss'].includes(action))
            throw Object.assign(new Error('回复举报动作无效'), {
              statusCode: 400,
            })
          if (action === 'delete_reply')
            await client.query(
              `UPDATE replies SET deleted_at=NOW(),deletion_source='admin',author_uid=NULL,body='{"blocks":[]}'::jsonb WHERE id=$1 AND deleted_at IS NULL`,
              [report.target_reply_id],
            )
        }
        await client.query(
          "UPDATE content_reports SET status='resolved',resolution=$2,resolved_by=$3,resolved_at=NOW() WHERE id=$1",
          [id, action, request.user.uid],
        )
        await client.query(
          "INSERT INTO audit_events(actor_uid,action_key,target_type,target_id,details) VALUES($1,'report.resolve','report',$2,$3::jsonb)",
          [
            request.user.uid,
            id,
            JSON.stringify({
              action,
              targetType: report.target_type,
              targetId:
                report.target_post_id ||
                report.target_reply_id ||
                report.target_user_uid,
              reason: report.reason,
            }),
          ],
        )
        return { id, action }
      })
      if (!result) return reply.code(404).send({ error: '举报不存在或已处理' })
      return result
    },
  )
}
