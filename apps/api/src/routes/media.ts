import { unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { adminPermissions, authenticate, requirePermission } from '../auth.js'
import { inTransaction, query } from '../db.js'
import { replaceDeletedImages, mediaError, saveUpload } from '../media.js'
import {
  mediaLimitsSchema,
  readSettings,
  remoteEmojiSchema,
  saveSettings,
  userMediaLimits,
} from '../settings.js'
import { registerRemoteEmojiRoutes } from './remoteEmoji.js'

export async function registerMediaRoutes(app: FastifyInstance, uploadRoot: string) {
  app.post('/api/me/avatar', { preHandler: authenticate }, async (request, reply) => {
    const asset = await saveUpload(request, uploadRoot, 'avatar')
    return reply.code(201).send({ avatarUrl: asset.url })
  })
  app.post('/api/media', { preHandler: requirePermission('media.use') }, async (request, reply) =>
    reply.code(201).send(await saveUpload(request, uploadRoot, 'library')),
  )
  app.get('/api/emoji-packs', async (request, reply) => {
    let uid: string | null = null
    if (request.headers.authorization) {
      const result = await authenticate(request, reply)
      if (result) return result
      uid = request.user.uid
    }
    return (
      await query(
        `SELECT p.id,p.name,p.sort_order,
        COALESCE(json_agg(json_build_object('id',m.id,'url','/uploads/' || m.storage_key,'name',m.alt_text) ORDER BY m.created_at,m.id) FILTER (WHERE m.id IS NOT NULL),'[]'::json) AS emojis
       FROM emoji_packs p LEFT JOIN media_assets m ON m.emoji_pack_id=p.id
       WHERE (p.created_by IS NULL AND p.remote_source IS NULL) OR p.created_by=$1
         OR EXISTS(SELECT 1 FROM user_emoji_packs up WHERE up.pack_id=p.id AND up.user_uid=$1)
       GROUP BY p.id ORDER BY p.sort_order,p.name`,
        [uid],
      )
    ).rows
  })
  app.get('/api/admin/media-settings', { preHandler: adminPermissions.media }, async () =>
    readSettings(['media_limits', 'remote_emoji']),
  )
  app.patch('/api/admin/media-settings', { preHandler: adminPermissions.media }, async (request, reply) => {
    const parsed = z
      .object({
        mediaLimits: mediaLimitsSchema,
        remoteEmoji: remoteEmojiSchema,
      })
      .safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '请检查上传限额和远端地址' })
    await inTransaction((client) =>
      saveSettings(
        {
          media_limits: parsed.data.mediaLimits,
          remote_emoji: parsed.data.remoteEmoji,
        },
        client,
      ),
    )
    return { saved: true }
  })
  app.get('/api/me/media-usage', { preHandler: requirePermission('media.use') }, async (request) => {
    const [limits, settings, usage] = await Promise.all([
      userMediaLimits(request.user.uid),
      readSettings(['remote_emoji']),
      query<{ bytes: string; packs: number }>(
        `SELECT
        (SELECT COALESCE(SUM(byte_size),0)::text FROM media_assets WHERE created_by=$1 AND NOT remote_cached AND collection<>'site_icon') AS bytes,
        (SELECT COUNT(*)::int FROM emoji_packs WHERE created_by=$1) AS packs`,
        [request.user.uid],
      ),
    ])
    return {
      limits,
      usedBytes: Number(usage.rows[0]!.bytes),
      uploadedPacks: usage.rows[0]!.packs,
      remoteEmoji: settings.remote_emoji,
    }
  })
  for (const admin of [false, true]) {
    const prefix = admin ? '/api/admin' : '/api/me'
    const guard = admin ? adminPermissions.media : requirePermission('media.use')
    app.get(`${prefix}/media`, { preHandler: guard }, async (request, reply) => {
      const parsed = z
        .object({
          collection: z.enum(['library', 'emoji', 'site_icon']).optional(),
        })
        .safeParse(request.query)
      if (!parsed.success) return reply.code(400).send({ error: '媒体分类无效' })
      return (
        await query(
          `SELECT m.*,p.name AS pack_name,'/uploads/' || m.storage_key AS url FROM media_assets m
        LEFT JOIN emoji_packs p ON p.id=m.emoji_pack_id WHERE ($1::text IS NULL OR m.collection=$1)
        AND ($2::bigint IS NULL OR m.created_by=$2) ORDER BY m.created_at DESC`,
          [parsed.data.collection ?? null, admin ? null : request.user.uid],
        )
      ).rows
    })
    app.post(`${prefix}/media`, { preHandler: guard }, async (request, reply) => {
      const parsed = z
        .object({
          collection: z.enum(['library', 'emoji']).default('library'),
          packId: z.string().regex(/^\d+$/).optional(),
        })
        .safeParse(request.query)
      if (!parsed.success || (parsed.data.collection === 'emoji' && !parsed.data.packId))
        return reply.code(400).send({ error: '请选择上传位置和表情包' })
      return reply
        .code(201)
        .send(
          await saveUpload(request, uploadRoot, parsed.data.collection, parsed.data.packId ?? null, admin),
        )
    })
    app.patch(`${prefix}/media/:id`, { preHandler: guard }, async (request, reply) => {
      const parsed = z.object({ altText: z.string().trim().max(160) }).safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: '图片说明无效' })
      const result = await query(
        'UPDATE media_assets SET alt_text=$2 WHERE id=$1 AND NOT remote_cached AND ($3::bigint IS NULL OR created_by=$3) RETURNING id,alt_text',
        [(request.params as { id: string }).id, parsed.data.altText, admin ? null : request.user.uid],
      )
      if (!result.rowCount) return reply.code(404).send({ error: '图片不存在或不可编辑' })
      return result.rows[0]
    })
    app.delete(`${prefix}/media/:id`, { preHandler: guard }, async (request) => {
      const asset = await inTransaction(async (client) => {
        const result = await client.query<{ storage_key: string }>(
          'SELECT storage_key FROM media_assets WHERE id=$1 AND NOT remote_cached AND ($2::bigint IS NULL OR created_by=$2) FOR UPDATE',
          [(request.params as { id: string }).id, admin ? null : request.user.uid],
        )
        if (!result.rows[0]) throw mediaError('图片不存在或不可删除', 404)
        await replaceDeletedImages(client, [result.rows[0].storage_key])
        await client.query('DELETE FROM media_assets WHERE id=$1', [(request.params as { id: string }).id])
        return result.rows[0]
      })
      await unlink(resolve(uploadRoot, asset.storage_key))
      return { deleted: true }
    })
    app.get(
      `${prefix}/emoji-packs`,
      { preHandler: guard },
      async (request) =>
        (
          await query(
            `SELECT p.*,COUNT(m.id)::int AS emoji_count FROM emoji_packs p LEFT JOIN media_assets m ON m.emoji_pack_id=p.id
       WHERE $1::bigint IS NULL OR p.created_by=$1 OR EXISTS(SELECT 1 FROM user_emoji_packs up WHERE up.pack_id=p.id AND up.user_uid=$1)
       GROUP BY p.id ORDER BY p.sort_order,p.name`,
            [admin ? null : request.user.uid],
          )
        ).rows,
    )
    app.get(`${prefix}/emoji-packs/:id/images`, { preHandler: guard }, async (request, reply) => {
      const id = (request.params as { id: string }).id
      const access = await query(
        `SELECT 1 FROM emoji_packs p WHERE p.id=$1 AND ($2::bigint IS NULL OR p.created_by=$2 OR EXISTS(SELECT 1 FROM user_emoji_packs up WHERE up.pack_id=p.id AND up.user_uid=$2))`,
        [id, admin ? null : request.user.uid],
      )
      if (!access.rowCount) return reply.code(404).send({ error: '表情包不存在' })
      return (
        await query(
          "SELECT *, '/uploads/' || storage_key AS url FROM media_assets WHERE emoji_pack_id=$1 ORDER BY created_at,id",
          [id],
        )
      ).rows
    })
    app.post(`${prefix}/emoji-packs`, { preHandler: guard }, async (request, reply) => {
      const parsed = z
        .object({
          name: z.string().trim().min(2).max(64),
          sortOrder: z.number().int().default(0),
        })
        .safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: '表情包名称无效' })
      try {
        const pack = await inTransaction(async (client) => {
          await client.query('SELECT uid FROM users WHERE uid=$1 FOR UPDATE', [request.user.uid])
          if (!admin) {
            const limits = await userMediaLimits(request.user.uid, client)
            const count = await client.query<{ count: number }>(
              'SELECT COUNT(*)::int AS count FROM emoji_packs WHERE created_by=$1',
              [request.user.uid],
            )
            if (count.rows[0]!.count >= limits.emojiPackCount) throw mediaError('已达到表情包组数上限', 409)
          }
          return (
            await client.query(
              'INSERT INTO emoji_packs(name,sort_order,created_by) VALUES($1,$2,$3) RETURNING *',
              [parsed.data.name, parsed.data.sortOrder, admin ? null : request.user.uid],
            )
          ).rows[0]
        })
        return reply.code(201).send(pack)
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          return reply.code(409).send({ error: '表情包名称已存在' })
        throw error
      }
    })
    app.patch(`${prefix}/emoji-packs/:id`, { preHandler: guard }, async (request, reply) => {
      const parsed = z
        .object({
          name: z.string().trim().min(2).max(64).optional(),
          sortOrder: z.number().int().optional(),
        })
        .refine((v) => Object.keys(v).length > 0)
        .safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: '表情包资料无效' })
      try {
        const result = await query(
          'UPDATE emoji_packs SET name=COALESCE($2,name),sort_order=COALESCE($3,sort_order) WHERE id=$1 AND remote_source IS NULL AND ($4::bigint IS NULL OR created_by=$4) RETURNING *',
          [
            (request.params as { id: string }).id,
            parsed.data.name ?? null,
            parsed.data.sortOrder ?? null,
            admin ? null : request.user.uid,
          ],
        )
        if (!result.rowCount) return reply.code(404).send({ error: '表情包不存在或不可编辑' })
        return result.rows[0]
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          return reply.code(409).send({ error: '表情包名称已存在' })
        throw error
      }
    })
    app.delete(`${prefix}/emoji-packs/:id`, { preHandler: guard }, async (request) => {
      const id = (request.params as { id: string }).id
      const files = await inTransaction(async (client) => {
        const pack = await client.query<{ remote_source: string | null }>(
          'SELECT remote_source FROM emoji_packs WHERE id=$1 FOR UPDATE',
          [id],
        )
        if (!pack.rows[0]) throw mediaError('表情包不存在', 404)
        if (pack.rows[0].remote_source) {
          if (admin) throw mediaError('共用缓存不可直接删除，请由用户移除个人收藏', 409)
          const removed = await client.query(
            'DELETE FROM user_emoji_packs WHERE user_uid=$1 AND pack_id=$2 RETURNING pack_id',
            [request.user.uid, id],
          )
          if (!removed.rowCount) throw mediaError('尚未添加此表情包', 404)
          return []
        }
        if (!admin) {
          const owner = await client.query('SELECT 1 FROM emoji_packs WHERE id=$1 AND created_by=$2', [
            id,
            request.user.uid,
          ])
          if (!owner.rowCount) throw mediaError('表情包不存在', 404)
          const assets = await client.query<{ storage_key: string }>(
            'SELECT storage_key FROM media_assets WHERE emoji_pack_id=$1',
            [id],
          )
          await replaceDeletedImages(
            client,
            assets.rows.map((a) => a.storage_key),
          )
          await client.query('DELETE FROM media_assets WHERE emoji_pack_id=$1', [id])
          await client.query('DELETE FROM emoji_packs WHERE id=$1', [id])
          return assets.rows.map((a) => a.storage_key)
        }
        await client.query("UPDATE media_assets SET collection='library' WHERE emoji_pack_id=$1", [id])
        await client.query('DELETE FROM emoji_packs WHERE id=$1', [id])
        return []
      })
      await Promise.all(files.map((file) => unlink(resolve(uploadRoot, file))))
      return { deleted: true }
    })
  }
  app.post('/api/admin/site-icon', { preHandler: adminPermissions.settings }, async (request, reply) => {
    const asset = await saveUpload(request, uploadRoot, 'site_icon')
    await query("UPDATE app_settings SET setting_value=$1::jsonb WHERE setting_key='site_icon_url'", [
      JSON.stringify(asset.url),
    ])
    return reply.code(201).send(asset)
  })
  app.delete('/api/admin/site-icon', { preHandler: adminPermissions.settings }, async () => {
    await query("UPDATE app_settings SET setting_value='\"\"'::jsonb WHERE setting_key='site_icon_url'")
    return { reset: true }
  })
  await registerRemoteEmojiRoutes(app, uploadRoot)
}
