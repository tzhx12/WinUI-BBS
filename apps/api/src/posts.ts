import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { inTransaction, query } from './db.js'

export async function purgeExpiredPosts() {
  return query('DELETE FROM posts WHERE deleted_at IS NOT NULL AND purge_after <= NOW()')
}

function visitorKey(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply) {
  if (request.headers.authorization) return `user:${request.user.uid}`
  const cookie = request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('forum-visitor='))
    ?.slice('forum-visitor='.length)
  if (cookie) {
    try {
      const visitor = app.jwt.verify<{ purpose: string; id: string }>(cookie)
      if (visitor.purpose === 'post-view' && typeof visitor.id === 'string') return `guest:${visitor.id}`
    } catch {
      /* Replace an expired or invalid visitor cookie. */
    }
  }
  const id = randomUUID()
  const token = app.jwt.sign({ purpose: 'post-view', id })
  reply.header(
    'Set-Cookie',
    `forum-visitor=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=315360000${request.protocol === 'https' ? '; Secure' : ''}`,
  )
  return `guest:${id}`
}

export async function recordPostView(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  postId: string,
) {
  const key = visitorKey(app, request, reply)
  return inTransaction(async (client) => {
    const post = await client.query<{ view_count: number }>(
      'SELECT view_count FROM posts WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [postId],
    )
    if (!post.rows[0]) return null
    const inserted = await client.query(
      'INSERT INTO post_views (post_id, viewer_key) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING post_id',
      [postId, key],
    )
    if (!inserted.rowCount) return post.rows[0].view_count
    const updated = await client.query<{ view_count: number }>(
      'UPDATE posts SET view_count = view_count + 1 WHERE id = $1 RETURNING view_count',
      [postId],
    )
    return updated.rows[0]!.view_count
  })
}
