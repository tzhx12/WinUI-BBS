import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { adminPermissions, authenticate } from '../auth.js'
import { query, inTransaction } from '../db.js'
import { grantLevelInvitations, invitationCode } from '../invitations.js'

export async function registerInvitationRoutes(app: FastifyInstance) {
  app.get('/api/me/invitations', { preHandler: authenticate }, async (request) => {
    if (!request.user.isBanned) await grantLevelInvitations(request.user.uid)
    return (
      await query(
        'SELECT id, code, max_uses, used_count, is_enabled, expires_at, created_at FROM invitations WHERE created_by = $1 ORDER BY created_at DESC',
        [request.user.uid],
      )
    ).rows
  })
  app.get('/api/admin/invitations', { preHandler: adminPermissions.users }, async () => {
    const [codes, rules] = await Promise.all([
      query(
        `SELECT i.*, u.display_name AS owner_name FROM invitations i LEFT JOIN users u ON u.uid = i.created_by ORDER BY i.created_at DESC`,
      ),
      query('SELECT * FROM invitation_rules ORDER BY minimum_level, id'),
    ])
    return { codes: codes.rows, rules: rules.rows }
  })
  app.post('/api/admin/invitations', { preHandler: adminPermissions.users }, async (request, reply) => {
    const parsed = z
      .object({
        quantity: z.number().int().min(1).max(100),
        maxUses: z.number().int().min(1).max(100000),
        expiresAt: z.iso.datetime().nullable().default(null),
      })
      .safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '邀请码数量或使用次数无效' })
    const result = await inTransaction(async (client) => {
      const codes = []
      for (let i = 0; i < parsed.data.quantity; i++) {
        const created = await client.query(
          'INSERT INTO invitations (code, created_by, max_uses, expires_at) VALUES ($1, $2, $3, $4) RETURNING *',
          [invitationCode(), request.user.uid, parsed.data.maxUses, parsed.data.expiresAt],
        )
        codes.push(created.rows[0])
      }
      return codes
    })
    return reply.code(201).send(result)
  })
  app.patch('/api/admin/invitations/:id', { preHandler: adminPermissions.users }, async (request, reply) => {
    const parsed = z.object({ isEnabled: z.boolean() }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '邀请码状态无效' })
    const result = await query('UPDATE invitations SET is_enabled = $2 WHERE id = $1 RETURNING id', [
      (request.params as { id: string }).id,
      parsed.data.isEnabled,
    ])
    if (!result.rowCount) return reply.code(404).send({ error: '邀请码不存在' })
    return { saved: true }
  })
  app.post('/api/admin/invitation-rules', { preHandler: adminPermissions.users }, async (request, reply) => {
    const parsed = z
      .object({
        minimumLevel: z.number().int().min(1).max(10000),
        quantity: z.number().int().min(1).max(100),
      })
      .safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '等级奖励规则无效' })
    return reply
      .code(201)
      .send(
        (
          await query('INSERT INTO invitation_rules (minimum_level, quantity) VALUES ($1, $2) RETURNING *', [
            parsed.data.minimumLevel,
            parsed.data.quantity,
          ])
        ).rows[0],
      )
  })
  app.patch(
    '/api/admin/invitation-rules/:id',
    { preHandler: adminPermissions.users },
    async (request, reply) => {
      const parsed = z.object({ isEnabled: z.boolean() }).safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: '规则状态无效' })
      const result = await query('UPDATE invitation_rules SET is_enabled = $2 WHERE id = $1 RETURNING id', [
        (request.params as { id: string }).id,
        parsed.data.isEnabled,
      ])
      if (!result.rowCount) return reply.code(404).send({ error: '规则不存在' })
      return { saved: true }
    },
  )
  app.delete(
    '/api/admin/invitation-rules/:id',
    { preHandler: adminPermissions.users },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const result = await inTransaction(async (client) => {
        const deleted = await client.query('DELETE FROM invitation_rules WHERE id = $1 RETURNING id', [id])
        if (!deleted.rowCount) return null
        await client.query(
          `INSERT INTO audit_events (actor_uid, action_key, target_type, target_id)
         VALUES ($1, 'invitation.rule.delete', 'invitation-rule', $2)`,
          [request.user.uid, id],
        )
        return { deleted: true }
      })
      if (!result) return reply.code(404).send({ error: '奖励规则不存在' })
      return result
    },
  )
}
