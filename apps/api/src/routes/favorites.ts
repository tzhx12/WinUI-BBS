import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { authenticate, readerLevel } from '../auth.js'
import { inTransaction, query } from '../db.js'
import { mediaError } from '../media.js'

const folderSchema = z.object({
  name: z.string().trim().min(1).max(64),
  isPublic: z.boolean().default(false),
  isDefault: z.boolean().optional(),
})
const id = z.string().regex(/^\d+$/)
const postColumns = `p.id,p.title,p.body,p.minimum_reader_level,p.is_pinned,p.view_count,p.created_at,p.status,
 c.id AS category_id,c.name AS category_name,c.accent_color AS category_color,
 u.uid AS author_uid,u.username,u.display_name,u.avatar_url,u.experience,u.level_offset,
 (SELECT COUNT(*)::int FROM replies r WHERE r.post_id=p.id) AS reply_count,
 (SELECT COUNT(*)::int FROM post_likes l WHERE l.post_id=p.id) AS like_count`
const joins = 'JOIN categories c ON c.id=p.category_id JOIN users u ON u.uid=p.author_uid'
async function viewer(request: FastifyRequest, reply: FastifyReply) {
  if (request.headers.authorization) await authenticate(request, reply)
  return request.user?.uid ?? null
}

export async function registerFavoriteRoutes(app: FastifyInstance) {
  app.delete('/api/me/favorites/:postId', { preHandler: authenticate }, async (request, reply) => {
    const parsed = z.object({ postId: z.uuid() }).safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ error: '帖子编号无效' })
    await query(
      `DELETE FROM favorites v USING favorite_folders f
      WHERE v.folder_id=f.id AND f.user_uid=$1 AND v.post_id=$2`,
      [request.user.uid, parsed.data.postId],
    )
    return { removed: true }
  })
  app.get('/api/me/favorite-folders', { preHandler: authenticate }, async (request) => {
    const parsed = z.object({ postId: z.uuid().optional() }).safeParse(request.query)
    if (!parsed.success) throw mediaError('帖子编号无效')
    return (
      await query(
        `SELECT f.*,COUNT(v.post_id)::int AS post_count,
      COALESCE(bool_or(v.post_id=$2::uuid),FALSE) AS contains_post
      FROM favorite_folders f LEFT JOIN favorites v ON v.folder_id=f.id
      WHERE f.user_uid=$1 GROUP BY f.id ORDER BY f.created_at,f.id`,
        [request.user.uid, parsed.data.postId ?? null],
      )
    ).rows
  })
  app.post('/api/me/favorite-folders', { preHandler: authenticate }, async (request, reply) => {
    const parsed = folderSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '收藏夹名称需为 1–64 字' })
    const folder = await inTransaction(async (client) => {
      await client.query('SELECT uid FROM users WHERE uid=$1 FOR UPDATE', [request.user.uid])
      const count = await client.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM favorite_folders WHERE user_uid=$1',
        [request.user.uid],
      )
      if (count.rows[0]!.count >= 100) throw mediaError('最多创建 100 个收藏夹')
      if (parsed.data.isDefault)
        await client.query('UPDATE favorite_folders SET is_default=false WHERE user_uid=$1 AND is_default', [
          request.user.uid,
        ])
      const created = (
        await client.query(
          'INSERT INTO favorite_folders(user_uid,name,is_public,is_default) VALUES($1,$2,$3,$4) ON CONFLICT(user_uid,name) DO NOTHING RETURNING *',
          [request.user.uid, parsed.data.name, parsed.data.isPublic, parsed.data.isDefault ?? false],
        )
      ).rows[0]
      if (!created) throw mediaError('已有同名收藏夹', 409)
      return created
    })
    return reply.code(201).send(folder)
  })
  app.patch('/api/me/favorite-folders/:id', { preHandler: authenticate }, async (request, reply) => {
    const parsed = folderSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '收藏夹名称需为 1–64 字' })
    try {
      return await inTransaction(async (client) => {
        await client.query('SELECT uid FROM users WHERE uid=$1 FOR UPDATE', [request.user.uid])
        const folder = await client.query('SELECT id FROM favorite_folders WHERE id=$1 AND user_uid=$2', [
          (request.params as { id: string }).id,
          request.user.uid,
        ])
        if (!folder.rowCount) throw mediaError('收藏夹不存在', 404)
        if (parsed.data.isDefault)
          await client.query(
            'UPDATE favorite_folders SET is_default=false WHERE user_uid=$1 AND is_default',
            [request.user.uid],
          )
        return (
          await client.query(
            'UPDATE favorite_folders SET name=$3,is_public=$4,is_default=COALESCE($5,is_default) WHERE id=$1 AND user_uid=$2 RETURNING *',
            [
              (request.params as { id: string }).id,
              request.user.uid,
              parsed.data.name,
              parsed.data.isPublic,
              parsed.data.isDefault ?? null,
            ],
          )
        ).rows[0]
      })
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        return reply.code(409).send({ error: '已有同名收藏夹' })
      throw error
    }
  })
  app.delete('/api/me/favorite-folders/:id', { preHandler: authenticate }, async (request, reply) => {
    const result = await query('DELETE FROM favorite_folders WHERE id=$1 AND user_uid=$2 RETURNING id', [
      (request.params as { id: string }).id,
      request.user.uid,
    ])
    if (!result.rowCount) return reply.code(404).send({ error: '收藏夹不存在' })
    return { deleted: true }
  })
  app.get('/api/favorite-folders/:id', async (request, reply) => {
    const uid = await viewer(request, reply)
    if (reply.sent) return
    const folder = (
      await query('SELECT * FROM favorite_folders WHERE id=$1 AND (user_uid=$2 OR is_public)', [
        (request.params as { id: string }).id,
        uid,
      ])
    ).rows[0]
    if (!folder) return reply.code(404).send({ error: '收藏夹不存在' })
    const level = uid ? await readerLevel(uid) : 0
    const posts = (
      await query(
        `SELECT ${postColumns} FROM favorites v JOIN posts p ON p.id=v.post_id ${joins}
      WHERE v.folder_id=$1 AND p.deleted_at IS NULL AND
      (p.status='published' AND p.minimum_reader_level<=$2 AND c.minimum_reader_level<=$2)
      ORDER BY v.created_at DESC,p.id DESC`,
        [folder.id, level],
      )
    ).rows
    return { folder, posts }
  })
  app.post(
    '/api/me/favorite-folders/:id/posts/:postId',
    { preHandler: authenticate },
    async (request, reply) => {
      const params = request.params as { id: string; postId: string }
      const result = await query(
        `INSERT INTO favorites(folder_id,post_id)
      SELECT f.id,p.id FROM favorite_folders f CROSS JOIN posts p JOIN categories c ON c.id=p.category_id
      WHERE f.id=$1 AND f.user_uid=$2 AND p.id=$3 AND p.status IN ('published','hidden') AND p.deleted_at IS NULL
      AND p.minimum_reader_level<=$4 AND c.minimum_reader_level<=$4 ON CONFLICT DO NOTHING RETURNING post_id`,
        [params.id, request.user.uid, params.postId, await readerLevel(request.user.uid)],
      )
      if (!result.rowCount) {
        const existing = await query(
          'SELECT 1 FROM favorites v JOIN favorite_folders f ON f.id=v.folder_id WHERE f.id=$1 AND f.user_uid=$2 AND v.post_id=$3',
          [params.id, request.user.uid, params.postId],
        )
        if (!existing.rowCount) return reply.code(404).send({ error: '收藏夹或帖子不存在，或无权阅读' })
      }
      return { saved: true }
    },
  )
  app.delete('/api/me/favorite-folders/:id/posts/:postId', { preHandler: authenticate }, async (request) => {
    const params = request.params as { id: string; postId: string }
    await query(
      'DELETE FROM favorites v USING favorite_folders f WHERE v.folder_id=f.id AND f.id=$1 AND f.user_uid=$2 AND v.post_id=$3',
      [params.id, request.user.uid, params.postId],
    )
    return { removed: true }
  })
  app.patch(
    '/api/me/favorite-folders/:id/posts/:postId',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = z.object({ targetFolderId: id }).safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: '请选择目标收藏夹' })
      const params = request.params as { id: string; postId: string }
      await inTransaction(async (client) => {
        const folders = await client.query(
          'SELECT id FROM favorite_folders WHERE id=ANY($1::bigint[]) AND user_uid=$2 FOR UPDATE',
          [[params.id, parsed.data.targetFolderId], request.user.uid],
        )
        if (folders.rowCount !== new Set([params.id, parsed.data.targetFolderId]).size)
          throw mediaError('收藏夹不存在', 404)
        if (params.id === parsed.data.targetFolderId) return
        const source = await client.query('SELECT 1 FROM favorites WHERE folder_id=$1 AND post_id=$2', [
          params.id,
          params.postId,
        ])
        if (!source.rowCount) throw mediaError('收藏不存在', 404)
        await client.query('INSERT INTO favorites(folder_id,post_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [
          parsed.data.targetFolderId,
          params.postId,
        ])
        await client.query('DELETE FROM favorites WHERE folder_id=$1 AND post_id=$2', [
          params.id,
          params.postId,
        ])
      })
      return { moved: true }
    },
  )
  app.get('/api/users/:id', async (request, reply) => {
    const uid = await viewer(request, reply)
    if (reply.sent) return
    const target = (request.params as { id: string }).id
    const user = (
      await query('SELECT uid,username,display_name,avatar_url,created_at FROM users WHERE uid=$1', [target])
    ).rows[0]
    if (!user) return reply.code(404).send({ error: '用户不存在' })
    const level = uid ? await readerLevel(uid) : 0
    const posts = (
      await query(
        `SELECT ${postColumns} FROM posts p ${joins} WHERE p.author_uid=$1 AND p.status='published' AND p.deleted_at IS NULL AND p.minimum_reader_level<=$2 AND c.minimum_reader_level<=$2 ORDER BY p.created_at DESC`,
        [target, level],
      )
    ).rows
    const folders = (
      await query(
        `SELECT f.id,f.name,f.is_public,COUNT(p.id)::int AS post_count FROM favorite_folders f
      LEFT JOIN favorites v ON v.folder_id=f.id LEFT JOIN posts p ON p.id=v.post_id AND p.status='published' AND p.deleted_at IS NULL
        AND p.minimum_reader_level<=$2 AND EXISTS(SELECT 1 FROM categories c WHERE c.id=p.category_id AND c.minimum_reader_level<=$2)
      WHERE f.user_uid=$1 AND f.is_public GROUP BY f.id ORDER BY f.created_at,f.id`,
        [target, level],
      )
    ).rows
    return { user, posts, folders }
  })
}
