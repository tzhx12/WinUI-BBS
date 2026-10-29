import type { FastifyReply, FastifyRequest } from 'fastify'
import { effectiveLevel, query } from './db.js'

declare module 'fastify' {
  interface FastifyRequest {
    user: {
      uid: string
      uuid: string
      sessionVersion?: number
      isBanned?: boolean
      bannedUntil?: Date | null
    }
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
  } catch {
    return reply.code(401).send({ error: '请先登录' })
  }
  const active = await query<{ is_banned: boolean; banned_until: Date | null }>(
    "SELECT COALESCE(banned_until > NOW(),FALSE) AS is_banned,banned_until FROM users WHERE uid = $1 AND status = 'active' AND session_version=$2",
    [request.user.uid, request.user.sessionVersion ?? 0],
  )
  if (!active.rowCount) return reply.code(401).send({ error: '账号不可用' })
  request.user.isBanned = active.rows[0]!.is_banned
  request.user.bannedUntil = active.rows[0]!.banned_until
  if (request.user.isBanned && !['GET', 'HEAD'].includes(request.method))
    return reply
      .code(403)
      .send({ error: '账号封禁期间仅可浏览，无法进行交互', bannedUntil: request.user.bannedUntil })
}

export function requirePermission(permission: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticate(request, reply)
    if (authResult) return authResult
    if (request.user.isBanned) {
      if (['GET', 'HEAD'].includes(request.method) && permission === 'media.use') return
      return reply.code(403).send({ error: '账号封禁期间仅可浏览' })
    }

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

export async function readerLevel(uid: string) {
  const result = await query<{ experience: string; level_offset: number; is_banned: boolean }>(
    "SELECT experience,level_offset,COALESCE(banned_until > NOW(),FALSE) AS is_banned FROM users WHERE uid=$1 AND status='active'",
    [uid],
  )
  const user = result.rows[0]
  return user ? (user.is_banned ? 1 : effectiveLevel(user.experience, user.level_offset)) : 0
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
