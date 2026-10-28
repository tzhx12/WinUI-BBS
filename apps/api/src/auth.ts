import type { FastifyReply, FastifyRequest } from 'fastify'
import { query } from './db.js'

declare module 'fastify' {
  interface FastifyRequest {
    user: { uid: string; uuid: string }
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
  } catch {
    return reply.code(401).send({ error: '请先登录' })
  }
  const active = await query(
    "SELECT 1 FROM users WHERE uid = $1 AND status = 'active' AND (banned_until IS NULL OR banned_until <= NOW())",
    [request.user.uid],
  )
  if (!active.rowCount) return reply.code(401).send({ error: '账号不可用' })
}

export function requirePermission(permission: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticate(request, reply)
    if (authResult) return authResult

    const result = await query(
      `SELECT 1
       FROM group_memberships gm
       JOIN group_permissions gp ON gp.group_id = gm.group_id
       WHERE gm.user_uid = $1
         AND gp.permission_key = $2
         AND (gm.expires_at IS NULL OR gm.expires_at > NOW())
       LIMIT 1`,
      [request.user.uid, permission],
    )
    if (!result.rowCount) return reply.code(403).send({ error: '没有执行此操作的权限' })
  }
}

export const adminPermissions = {
  users: requirePermission('users.manage'),
  groups: requirePermission('groups.manage'),
  levels: requirePermission('levels.manage'),
  posts: requirePermission('posts.manage'),
  categories: requirePermission('categories.manage'),
  media: requirePermission('media.manage'),
  settings: requirePermission('settings.manage'),
}
