import { resolve } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate, readerLevel, requirePermission } from '../auth.js'
import { awardExperience, inTransaction, query } from '../db.js'
import {
  editorBodySchema,
  readSubmission,
  replyExcerpt,
  validateContent,
  withSubmission,
} from '../content.js'
import { grantLevelInvitations } from '../invitations.js'
import { mediaError } from '../media.js'
import { childReplyPage, pageSchema } from '../replies.js'

export async function registerReplyRoutes(
  app: FastifyInstance,
  uploadRoot = resolve(process.cwd(), 'data/uploads'),
) {
  for (const trash of [false, true]) {
    app.get(
      `${trash ? '/api/me/trash' : '/api/posts'}/:postId/replies/:rootId/children`,
      async (request, reply) => {
        let uid: string | null = null
        if (trash || request.headers.authorization) {
          const auth = await authenticate(request, reply)
          if (auth) return auth
          uid = request.user.uid
        }
        const params = z.object({ postId: z.uuid(), rootId: z.uuid() }).safeParse(request.params)
        const parsed = pageSchema.safeParse(request.query)
        if (!params.success || !parsed.success) return reply.code(400).send({ error: '回复或页码无效' })
        const post = (
          await query(
            `SELECT p.author_uid,p.minimum_reader_level,c.minimum_reader_level AS category_level
        FROM posts p JOIN categories c ON c.id=p.category_id WHERE p.id=$1 AND ${trash ? "p.author_uid=$2 AND p.deleted_at IS NOT NULL AND p.deletion_source='author' AND p.purge_after>NOW()" : "p.deleted_at IS NULL AND (p.status IN ('published','hidden') OR p.author_uid=$2)"}`,
            [params.data.postId, uid],
          )
        ).rows[0]
        if (!post) return reply.code(404).send({ error: '帖子不存在' })
        if (
          !trash &&
          post.author_uid !== uid &&
          Math.max(post.minimum_reader_level, post.category_level) > (uid ? await readerLevel(uid) : 0)
        )
          return reply.code(403).send({ error: '此帖需要更高等级才能阅读' })
        const root = await query(
          'SELECT 1 FROM replies WHERE id=$1 AND post_id=$2 AND parent_reply_id IS NULL',
          [params.data.rootId, params.data.postId],
        )
        if (!root.rowCount) return reply.code(404).send({ error: '主回复不存在' })
        return childReplyPage(params.data.rootId, parsed.data.page)
      },
    )
  }
  app.post(
    '/api/posts/:id/replies',
    { preHandler: requirePermission('replies.create') },
    async (request, reply) => {
      const submission = await readSubmission(request)
      const parsed = z
        .object({
          body: editorBodySchema,
          parentReplyId: z.uuid().optional(),
          replyToId: z.uuid().optional(),
        })
        .refine((v) => !v.replyToId || !!v.parentReplyId)
        .safeParse(submission.payload)
      const postId = z.uuid().safeParse((request.params as { id: string }).id)
      if (!parsed.success || !postId.success) return reply.code(400).send({ error: '回复内容或目标无效' })
      await validateContent(parsed.data.body, 'reply')
      const level = await readerLevel(request.user.uid)
      const result = await withSubmission(
        request.user.uid,
        parsed.data.body,
        submission.attachments,
        uploadRoot,
        async (client) => {
          const post = (
            await client.query(
              `SELECT p.minimum_reader_level,c.minimum_reader_level AS category_level FROM posts p JOIN categories c ON c.id=p.category_id
        WHERE p.id=$1 AND p.deleted_at IS NULL AND p.status IN ('published','hidden') FOR UPDATE OF p`,
              [postId.data],
            )
          ).rows[0]
          if (!post) throw mediaError('帖子不存在', 404)
          if (Math.max(post.minimum_reader_level, post.category_level) > level)
            throw mediaError('此帖需要更高等级才能回复', 403)
          if (parsed.data.parentReplyId) {
            const root = (
              await client.query(
                'SELECT id,deleted_at FROM replies WHERE id=$1 AND post_id=$2 AND parent_reply_id IS NULL',
                [parsed.data.parentReplyId, postId.data],
              )
            ).rows[0]
            if (!root) throw mediaError('主回复不存在', 404)
            if (root.deleted_at && !parsed.data.replyToId)
              throw mediaError('原回复已删除，请回复现有楼中楼', 409)
            if (
              parsed.data.replyToId &&
              !(
                await client.query(
                  `SELECT 1 FROM replies WHERE id=$1 AND post_id=$2 AND deleted_at IS NULL AND (id=$3 OR parent_reply_id=$3)`,
                  [parsed.data.replyToId, postId.data, root.id],
                )
              ).rowCount
            )
              throw mediaError('回复目标已删除或不在此楼中楼', 404)
          }
          const created = await client.query(
            `INSERT INTO replies(post_id,author_uid,body,parent_reply_id,reply_to_id) VALUES($1,$2,$3::jsonb,$4,$5) RETURNING id,floor_number,child_number,parent_reply_id`,
            [
              postId.data,
              request.user.uid,
              JSON.stringify(parsed.data.body),
              parsed.data.parentReplyId ?? null,
              parsed.data.replyToId ?? null,
            ],
          )
          const experience = await awardExperience(request.user.uid, 'create_reply', client)
          await grantLevelInvitations(request.user.uid, client)
          return { reply: created.rows[0], experience }
        },
      )
      return reply.code(201).send(result)
    },
  )

  app.delete('/api/posts/:postId/replies/:replyId', { preHandler: authenticate }, async (request, reply) => {
    const params = z.object({ postId: z.uuid(), replyId: z.uuid() }).safeParse(request.params)
    const options = z.object({ scope: z.enum(['reply', 'thread']).default('reply') }).safeParse(request.query)
    if (!params.success || !options.success) return reply.code(400).send({ error: '回复编号或删除范围无效' })
    const permissions = await query(
      `SELECT 1 FROM group_memberships gm JOIN group_permissions gp ON gp.group_id=gm.group_id
      WHERE gm.user_uid=$1 AND gp.permission_key='posts.manage' AND (gm.expires_at IS NULL OR gm.expires_at>NOW()) LIMIT 1`,
      [request.user.uid],
    )
    const manager = !!permissions.rowCount
    if (options.data.scope === 'thread' && !manager)
      return reply.code(403).send({ error: '只有发帖管理员可删除整层回复' })
    return inTransaction(async (client) => {
      const post = (
        await client.query('SELECT title FROM posts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [
          params.data.postId,
        ])
      ).rows[0]
      if (!post) throw mediaError('帖子不存在', 404)
      const entry = (
        await client.query('SELECT * FROM replies WHERE id=$1 AND post_id=$2 FOR UPDATE', [
          params.data.replyId,
          params.data.postId,
        ])
      ).rows[0]
      if (!entry) throw mediaError('回复不存在或已删除', 404)
      if (entry.deleted_at && !(manager && options.data.scope === 'thread'))
        throw mediaError('回复已删除', 404)
      if (entry.parent_reply_id && options.data.scope === 'thread')
        throw mediaError('楼中楼只能删除当前回复', 400)
      if (!manager && entry.author_uid !== request.user.uid) throw mediaError('只能删除自己的回复', 403)
      const children = entry.parent_reply_id
        ? 0
        : (
            await client.query<{ count: number }>(
              'SELECT COUNT(*)::int AS count FROM replies WHERE parent_reply_id=$1',
              [entry.id],
            )
          ).rows[0]!.count
      const removed = (
        await client.query(
          `SELECT id,author_uid,floor_number,child_number,body FROM replies WHERE deleted_at IS NULL AND (id=$1 OR ($2 AND parent_reply_id=$1)) ORDER BY floor_number,child_number NULLS FIRST`,
          [entry.id, options.data.scope === 'thread'],
        )
      ).rows
      if (children && options.data.scope === 'reply')
        await client.query(
          'UPDATE replies SET body=\'{"blocks":[]}\'::jsonb,author_uid=NULL,reply_to_id=NULL,deleted_at=NOW(),deletion_source=$2 WHERE id=$1',
          [entry.id, manager ? 'admin' : 'author'],
        )
      else await client.query('DELETE FROM replies WHERE id=$1', [entry.id])
      if (entry.parent_reply_id)
        await client.query(
          'DELETE FROM replies r WHERE r.id=$1 AND r.deleted_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM replies c WHERE c.parent_reply_id=r.id)',
          [entry.parent_reply_id],
        )
      if (manager) {
        const floor = (row: (typeof removed)[number]) =>
          `第${row.floor_number}楼${row.child_number ? `-${row.child_number}层` : ''}`
        for (const author of new Set(removed.map((row) => row.author_uid))) {
          if (!author || author === request.user.uid) continue
          const replies = removed.filter((row) => row.author_uid === author)
          const floors = replies.map(floor).join('、')
          const excerpts = replies.map((row) => `${floor(row)}：${replyExcerpt(row.body)}`).join('\n')
          const notice = await client.query<{ id: string }>(
            `INSERT INTO notifications(title,body,kind,sender_uid,post_id) VALUES('回复已被管理员删除',$1,'moderation',$2,$3) RETURNING id`,
            [
              `你在《${post.title}》中的${floors}回复已被管理员删除，无法恢复。\n删除内容摘要：\n${excerpts}`,
              request.user.uid,
              params.data.postId,
            ],
          )
          await client.query('INSERT INTO notification_recipients(notification_id,user_uid) VALUES($1,$2)', [
            notice.rows[0]!.id,
            author,
          ])
        }
        await client.query(
          `INSERT INTO audit_events(actor_uid,action_key,target_type,target_id,details) VALUES($1,$2,'reply',$3,$4::jsonb)`,
          [
            request.user.uid,
            options.data.scope === 'thread' ? 'reply.delete.cascade' : 'reply.delete',
            entry.id,
            JSON.stringify({
              postId: params.data.postId,
              scope: options.data.scope,
              removed: removed.map((row) => ({
                id: row.id,
                authorUid: row.author_uid,
                floor: row.floor_number,
                childFloor: row.child_number,
              })),
            }),
          ],
        )
      }
      return {
        deleted: true,
        retainedChildren: children > 0 && options.data.scope === 'reply',
        removedCount: removed.length,
      }
    })
  })
}
