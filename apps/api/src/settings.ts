import { z } from 'zod'
import type { Pool, PoolClient } from 'pg'
import { pool } from './db.js'

export const contentLimitsSchema = z.object({
  postCharacters: z.number().int().min(1).max(100000),
  postImages: z.number().int().min(0).max(50),
  replyCharacters: z.number().int().min(1).max(10000),
  replyImages: z.number().int().min(0).max(20),
  repliesPerPage: z.number().int().min(1).max(100),
  directLibraryUploads: z.boolean(),
})
export type ContentLimits = z.infer<typeof contentLimitsSchema>

export async function contentLimits() {
  return (await readSettings(['content_limits'])).content_limits as ContentLimits
}

export const mediaLimitsSchema = z.object({
  storageBytes: z
    .number()
    .int()
    .min(1)
    .max(1024 ** 4),
  imageBytes: z
    .number()
    .int()
    .min(1)
    .max(100 * 1024 ** 2),
  emojiPackCount: z.number().int().min(0).max(10000),
  emojiImagesPerPack: z.number().int().min(1).max(150),
  emojiImageBytes: z
    .number()
    .int()
    .min(1)
    .max(3 * 1024 ** 2),
})
export type MediaLimits = z.infer<typeof mediaLimitsSchema>
export const httpUrl = z.url({ protocol: /^https?$/ })
export const remoteEmojiSchema = z.object({
  enabled: z.boolean(),
  countTowardPackLimit: z.boolean().default(true),
  sourceUrl: httpUrl,
  apiUrl: httpUrl,
})
export type RemoteEmojiSettings = z.infer<typeof remoteEmojiSchema>

export async function readSettings(keys: string[], client: Pool | PoolClient = pool) {
  const result = await client.query<{
    setting_key: string
    setting_value: unknown
  }>('SELECT setting_key, setting_value FROM app_settings WHERE setting_key = ANY($1)', [keys])
  return Object.fromEntries(result.rows.map((row) => [row.setting_key, row.setting_value]))
}

export async function saveSettings(settings: Record<string, unknown>, client: PoolClient) {
  for (const [key, value] of Object.entries(settings))
    await client.query('UPDATE app_settings SET setting_value = $2::jsonb WHERE setting_key = $1', [
      key,
      JSON.stringify(value),
    ])
}

export async function userMediaLimits(uid: string, client: Pool | PoolClient = pool): Promise<MediaLimits> {
  const settings = await readSettings(['media_limits'], client)
  const defaults = settings.media_limits as MediaLimits
  const groups = await client.query<{ media_limits: Partial<MediaLimits> }>(
    `SELECT g.media_limits FROM user_groups g JOIN group_memberships gm ON gm.group_id = g.id
     WHERE gm.user_uid = $1 AND (gm.expires_at IS NULL OR gm.expires_at > NOW())`,
    [uid],
  )
  return Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => {
      const overrides = groups.rows.flatMap((group) =>
        group.media_limits[key as keyof MediaLimits] === undefined
          ? []
          : [group.media_limits[key as keyof MediaLimits]!],
      )
      return [key, overrides.length ? Math.max(...overrides) : value]
    }),
  ) as MediaLimits
}
