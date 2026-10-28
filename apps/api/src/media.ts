import { randomUUID } from 'node:crypto'
import { unlink, writeFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import type { FastifyRequest } from 'fastify'
import type { PoolClient } from 'pg'
import { inTransaction } from './db.js'
import { userMediaLimits } from './settings.js'

export const imageTypes = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
])
export const mediaError = (message: string, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode })

export const deletedImageUrl = '/deleted-image.png'

export async function replaceDeletedImages(client: PoolClient, storageKeys: string[]) {
  if (!storageKeys.length) return
  const protectedUse = await client.query(
    `SELECT 1 FROM unnest($1::text[]) AS key WHERE
       EXISTS (SELECT 1 FROM users WHERE avatar_url = '/uploads/' || key) OR
       EXISTS (SELECT 1 FROM app_settings WHERE setting_key = 'site_icon_url' AND setting_value::text LIKE '%' || key || '%') LIMIT 1`,
    [storageKeys],
  )
  if (protectedUse.rowCount) throw mediaError('图片仍被头像或站点图标使用', 409)
  const paths = new Set(storageKeys.map((key) => `/uploads/${key}`))
  function replaceUrl(value: unknown) {
    if (typeof value !== 'string') return value
    try {
      return paths.has(new URL(value, 'http://forum.local').pathname) ? deletedImageUrl : value
    } catch {
      return value
    }
  }
  function replace(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(replace)
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, key === 'url' ? replaceUrl(item) : replace(item)]),
      )
    return value
  }
  for (const table of ['posts', 'replies'] as const) {
    const references = await client.query<{ id: string; body: unknown }>(
      `SELECT id, body FROM ${table} WHERE EXISTS (
        SELECT 1 FROM unnest($1::text[]) AS key WHERE body::text LIKE '%' || key || '%'
      ) FOR UPDATE`,
      [storageKeys],
    )
    for (const row of references.rows)
      await client.query(`UPDATE ${table} SET body = $2::jsonb WHERE id = $1`, [
        row.id,
        JSON.stringify(replace(row.body)),
      ])
  }
}

export async function saveUpload(
  request: FastifyRequest,
  uploadRoot: string,
  collection: 'library' | 'emoji' | 'site_icon' | 'avatar',
  packId: string | null = null,
  admin = false,
) {
  const limits = await userMediaLimits(request.user.uid)
  const file = await request.file({
    limits: {
      fileSize: collection === 'emoji' ? limits.emojiImageBytes : limits.imageBytes,
    },
  })
  if (!file) throw mediaError('请选择图片')
  const extension = imageTypes.get(file.mimetype)
  if (!extension) throw mediaError('仅支持 PNG、JPEG、WebP 和 GIF 图片', 415)
  let buffer: Buffer
  try {
    buffer = await file.toBuffer()
  } catch (error) {
    if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE')
      throw mediaError('图片超过单张上传限制', 413)
    throw error
  }
  const storageKey = `${randomUUID()}${extension}`
  await writeFile(resolve(uploadRoot, storageKey), buffer, { flag: 'wx' })
  try {
    return await inTransaction(async (client) => {
      await client.query('SELECT uid FROM users WHERE uid = $1 FOR UPDATE', [request.user.uid])
      if (collection === 'emoji') {
        const pack = await client.query<{
          created_by: string | null
          remote_source: string | null
        }>('SELECT created_by, remote_source FROM emoji_packs WHERE id = $1 FOR UPDATE', [packId])
        if (
          !pack.rows[0] ||
          pack.rows[0].remote_source ||
          (!admin && pack.rows[0].created_by !== request.user.uid)
        )
          throw mediaError('表情包不存在或不可上传', 404)
        const count = await client.query<{ count: number }>(
          'SELECT COUNT(*)::int AS count FROM media_assets WHERE emoji_pack_id = $1',
          [packId],
        )
        if (count.rows[0]!.count >= limits.emojiImagesPerPack)
          throw mediaError('此表情包已达到图片数量上限', 409)
      }
      if (collection !== 'site_icon') {
        const usage = await client.query<{ bytes: string }>(
          "SELECT COALESCE(SUM(byte_size),0)::text AS bytes FROM media_assets WHERE created_by = $1 AND NOT remote_cached AND collection <> 'site_icon'",
          [request.user.uid],
        )
        if (Number(usage.rows[0]!.bytes) + buffer.byteLength > limits.storageBytes)
          throw mediaError('图床容量不足', 409)
      }
      const result = await client.query(
        `INSERT INTO media_assets (storage_key, original_name, mime_type, byte_size, alt_text, collection, emoji_pack_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          storageKey,
          file.filename,
          file.mimetype,
          buffer.byteLength,
          file.filename.replace(extname(file.filename), ''),
          collection === 'avatar' ? 'library' : collection,
          packId,
          request.user.uid,
        ],
      )
      if (collection === 'avatar')
        await client.query('UPDATE users SET avatar_url = $2 WHERE uid = $1', [
          request.user.uid,
          `/uploads/${storageKey}`,
        ])
      return { ...result.rows[0], url: `/uploads/${storageKey}` }
    })
  } catch (error) {
    await unlink(resolve(uploadRoot, storageKey))
    throw error
  }
}
