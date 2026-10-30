import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../auth.js'
import { query } from '../db.js'

const params = z.object({
  id: z
    .string()
    .regex(/^[1-9]\d*$/)
    .max(18),
})

export async function registerFollowRoutes(app: FastifyInstance) {
  app.get('/api/me/following', { preHandler: authenticate }, async (request) => {
    return (
      await query(
        `SELECT u.uid,u.username,u.display_name,u.avatar_url,f.created_at AS followed_at
       FROM user_follows f JOIN users u ON u.uid=f.followed_uid
       WHERE f.follower_uid=$1 ORDER BY f.created_at DESC,u.uid DESC`,
        [request.user.uid],
      )
    ).rows
  })
  for (const method of ['PUT', 'DELETE'] as const) {
    app.route({
      method,
      url: '/api/users/:id/follow',
      preHandler: authenticate,
      handler: async (request, reply) => {
        const parsed = params.safeParse(request.params)
        if (!parsed.success) return reply.code(400).send({ error: '用户编号无效' })
        const target = parsed.data.id
        if (target === request.user.uid) return reply.code(400).send({ error: '不能关注自己' })
        if (method === 'DELETE') {
          await query('DELETE FROM user_follows WHERE follower_uid=$1 AND followed_uid=$2', [
            request.user.uid,
            target,
          ])
          return { following: false }
        }
        const result = await query(
          `INSERT INTO user_follows(follower_uid,followed_uid)
           SELECT $1,uid FROM users WHERE uid=$2 AND status='active'
           ON CONFLICT DO NOTHING RETURNING followed_uid`,
          [request.user.uid, target],
        )
        if (
          !result.rowCount &&
          !(await query("SELECT 1 FROM users WHERE uid=$1 AND status='active'", [target])).rowCount
        )
          return reply.code(404).send({ error: '用户不存在或不可用' })
        return { following: true }
      },
    })
  }
}
