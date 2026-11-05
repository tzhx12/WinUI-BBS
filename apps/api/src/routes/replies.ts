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
import { deleteReply } from '../replyDeletion.js'
import { validateContentLocks } from '../lockedContent.js'
import { sendReplyNotification } from '../notifications.js'
import { contentLimits } from '../settings.js'

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
        const params = z
          .object({ postId: z.uuid(), rootId: z.uuid() })
          .safeParse(request.params)
        const parsed = pageSchema.safeParse(request.query)
        if (!params.success || !parsed.success)
          return reply.code(400).send({ error: '回复或页码无效' })
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
          Math.max(post.minimum_reader_level, post.category_level) >
            (uid ? await readerLevel(uid) : 0)
        )
          return reply.code(403).send({ error: '此帖需要更高等级才能阅读' })
        const root = await query(
          'SELECT 1 FROM replies WHERE id=$1 AND post_id=$2 AND parent_reply_id IS NULL',
          [params.data.rootId, params.data.postId],
        )
        if (!root.rowCount)
          return reply.code(404).send({ error: '主回复不存在' })
        return childReplyPage(params.data.rootId, parsed.data.page)
      },
    )
  }
  app.get(
    '/api/posts/:postId/replies/:replyId/location',
    async (request, reply) => {
      let uid: string | null = null
      if (request.headers.authorization) {
        const auth = await authenticate(request, reply)
        if (auth) return auth
        uid = request.user.uid
      }
      const params = z
        .object({ postId: z.uuid(), replyId: z.uuid() })
        .safeParse(request.params)
      if (!params.success)
        return reply.code(400).send({ error: '回复编号无效' })
      const post = (
        await query(
          `SELECT p.author_uid,p.minimum_reader_level,c.minimum_reader_level AS category_level
       FROM posts p JOIN categories c ON c.id=p.category_id WHERE p.id=$1 AND p.deleted_at IS NULL
         AND (p.status IN ('published','hidden') OR p.author_uid=$2)`,
          [params.data.postId, uid],
        )
      ).rows[0]
      if (!post) return reply.code(404).send({ error: '帖子不存在' })
      if (
        post.author_uid !== uid &&
        Math.max(post.minimum_reader_level, post.category_level) >
          (uid ? await readerLevel(uid) : 0)
      )
        return reply.code(403).send({ error: '此帖需要更高等级才能阅读' })
      const target = (
        await query<{
          root_id: string
          child_number: number | null
          before_count: number
        }>(
          `SELECT root.id AS root_id,r.child_number,
         (SELECT COUNT(*)::int FROM replies prior WHERE prior.post_id=r.post_id AND prior.parent_reply_id IS NULL
           AND (prior.deleted_at IS NULL OR EXISTS(SELECT 1 FROM replies child WHERE child.parent_reply_id=prior.id))
           AND prior.floor_number<root.floor_number) AS before_count
       FROM replies r JOIN replies root ON root.id=COALESCE(r.parent_reply_id,r.id)
       WHERE r.id=$1 AND r.post_id=$2 AND r.deleted_at IS NULL`,
          [params.data.replyId, params.data.postId],
        )
      ).rows[0]
      if (!target) return reply.code(404).send({ error: '回复不存在或已删除' })
      const pageSize = (await contentLimits()).repliesPerPage
      return {
        page: Math.floor(target.before_count / pageSize) + 1,
        childPage: target.child_number
          ? Math.floor((target.child_number - 1) / 5) + 1
          : null,
        rootId: target.root_id,
      }
    },
  )
  app.post(
    '/api/posts/:id/replies',
    { preHandler: requirePermission('replies.create') },
    async (request, reply) => {
      const submission = await readSubmission(request)
      try {
        const parsed = z
          .object({
            body: editorBodySchema,
            parentReplyId: z.uuid().optional(),
            replyToId: z.uuid().optional(),
          })
          .refine((v) => !v.replyToId || !!v.parentReplyId)
          .safeParse(submission.payload)
        const postId = z.uuid().safeParse((request.params as { id: string }).id)
        if (!parsed.success || !postId.success)
          return reply.code(400).send({ error: '回复内容或目标无效' })
        await validateContent(parsed.data.body, 'reply')
        await validateContentLocks(parsed.data.body, request.user.uid, 'reply')
        const level = await readerLevel(request.user.uid)
        const result = await withSubmission(
          request.user.uid,
          parsed.data.body,
          submission.attachments,
          uploadRoot,
          async (client) => {
            const post = (
              await client.query(
                `SELECT p.author_uid,p.minimum_reader_level,c.minimum_reader_level AS category_level FROM posts p JOIN categories c ON c.id=p.category_id
        WHERE p.id=$1 AND p.deleted_at IS NULL AND p.status IN ('published','hidden') FOR UPDATE OF p`,
                [postId.data],
              )
            ).rows[0]
            if (!post) throw mediaError('帖子不存在', 404)
            if (
              Math.max(post.minimum_reader_level, post.category_level) > level
            )
              throw mediaError('此帖需要更高等级才能回复', 403)
            let notifyUid = post.author_uid
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
              if (parsed.data.replyToId) {
                const target = await client.query<{ author_uid: string }>(
                  'SELECT author_uid FROM replies WHERE id=$1 AND deleted_at IS NULL',
                  [parsed.data.replyToId],
                )
                notifyUid = target.rows[0]?.author_uid ?? ''
              } else notifyUid = ''
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
            const experience = await awardExperience(
              request.user.uid,
              'create_reply',
              client,
            )
            await grantLevelInvitations(request.user.uid, client)
            if (notifyUid && notifyUid !== request.user.uid) {
              const sender = await client.query<{ username: string }>(
                'SELECT username FROM users WHERE uid=$1',
                [request.user.uid],
              )
              const excerpt = replyExcerpt(parsed.data.body, 100) || '[内容]'
              await sendReplyNotification(
                client,
                notifyUid,
                request.user.uid,
                postId.data,
                created.rows[0]!.id,
                `${sender.rows[0]!.username}回复了你：${excerpt}`,
              )
            }
            return { reply: created.rows[0], experience }
          },
        )
        return reply.code(201).send(result)
      } finally {
        await submission.cleanup()
      }
    },
  )

  app.delete(
    '/api/posts/:postId/replies/:replyId',
    { preHandler: authenticate },
    async (request, reply) => {
      const params = z
        .object({ postId: z.uuid(), replyId: z.uuid() })
        .safeParse(request.params)
      const options = z
        .object({ scope: z.enum(['reply', 'thread']).default('reply') })
        .safeParse(request.query)
      if (!params.success || !options.success)
        return reply.code(400).send({ error: '回复编号或删除范围无效' })
      const permissions = await query(
        `SELECT 1 FROM group_memberships gm JOIN group_permissions gp ON gp.group_id=gm.group_id
      WHERE gm.user_uid=$1 AND gp.permission_key='posts.manage' AND (gm.expires_at IS NULL OR gm.expires_at>NOW()) LIMIT 1`,
        [request.user.uid],
      )
      const manager = !!permissions.rowCount
      if (options.data.scope === 'thread' && !manager)
        return reply.code(403).send({ error: '只有发帖管理员可删除整层回复' })
      return inTransaction((client) =>
        deleteReply(client, params.data.postId, params.data.replyId, request.user.uid, manager, options.data.scope),
      )
    },
  )
}
