import type { Pool, PoolClient } from 'pg'
import { pool } from './db.js'
import { mediaError } from './media.js'
import { readSettings, userMediaLimits, type RemoteEmojiSettings } from './settings.js'

export async function personalEmojiPackCount(uid: string, client: Pool | PoolClient = pool) {
  const settings = await readSettings(['remote_emoji'], client)
  const remote = settings.remote_emoji as RemoteEmojiSettings
  const result = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM emoji_packs p WHERE NOT p.is_community AND
      (p.created_by=$1 OR ($2 AND EXISTS (
        SELECT 1 FROM user_emoji_packs up WHERE up.pack_id=p.id AND up.user_uid=$1)))`,
    [uid, remote.countTowardPackLimit],
  )
  return result.rows[0]!.count
}

// Call while holding the user's row lock, including remote imports and local pack creation.
export async function checkEmojiPackLimit(uid: string, client: PoolClient) {
  const limits = await userMediaLimits(uid, client)
  if ((await personalEmojiPackCount(uid, client)) >= limits.emojiPackCount)
    throw mediaError('已达到表情包组数上限', 409)
}

export async function setCommunityEmojiPack(packId: string | null, client: PoolClient) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('community-emoji-pack'))")
  if (packId) {
    const pack = await client.query('SELECT 1 FROM emoji_packs WHERE id=$1 AND created_by IS NULL', [packId])
    if (!pack.rowCount) throw mediaError('请选择管理员添加的表情包', 404)
  }
  await client.query('UPDATE emoji_packs SET is_community=FALSE WHERE is_community')
  if (packId) await client.query('UPDATE emoji_packs SET is_community=TRUE WHERE id=$1', [packId])
}
