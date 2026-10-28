import { randomBytes } from 'node:crypto'
import { inTransaction } from './db.js'
import type { PoolClient } from 'pg'

export const invitationCode = () => randomBytes(18).toString('base64url')

export async function grantLevelInvitations(uid: string, client?: PoolClient) {
  async function grant(client: PoolClient) {
    const user = await client.query<{
      experience: string
      level_offset: number
    }>('SELECT experience, level_offset FROM users WHERE uid = $1 FOR UPDATE', [uid])
    const setting = await client.query<{ points: number }>(
      "SELECT setting_value::text::integer AS points FROM app_settings WHERE setting_key = 'points_per_level'",
    )
    const level = Math.max(
      1,
      Math.floor(Number(user.rows[0]!.experience) / setting.rows[0]!.points) + 1 + user.rows[0]!.level_offset,
    )
    const rules = await client.query<{ id: string; quantity: number }>(
      `SELECT r.id, r.quantity FROM invitation_rules r WHERE r.is_enabled AND r.minimum_level <= $2
       AND NOT EXISTS (SELECT 1 FROM invitation_grants g WHERE g.user_uid = $1 AND g.rule_id = r.id)
       FOR SHARE OF r`,
      [uid, level],
    )
    for (const rule of rules.rows) {
      await client.query('INSERT INTO invitation_grants (user_uid, rule_id) VALUES ($1, $2)', [uid, rule.id])
      for (let index = 0; index < rule.quantity; index++)
        await client.query('INSERT INTO invitations (code, created_by, rule_id) VALUES ($1, $2, $3)', [
          invitationCode(),
          uid,
          rule.id,
        ])
    }
  }
  if (client) await grant(client)
  else await inTransaction(grant)
}
