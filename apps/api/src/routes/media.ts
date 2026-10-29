import { unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { adminPermissions, authenticate, requirePermission } from '../auth.js'
import { inTransaction, query } from '../db.js'
import { replaceDeletedImages, mediaError, saveUpload } from '../media.js'
import {
  mediaLimitsSchema,
  contentLimits,
  readSettings,
  remoteEmojiSchema,
  saveSettings,
  userMediaLimits,
} from '../settings.js'
import { registerRemoteEmojiRoutes } from './remoteEmoji.js'
import { checkEmojiPackLimit, personalEmojiPackCount, setCommunityEmojiPack } from '../emoji.js'

export async function registerMediaRoutes(app: FastifyInstance, uploadRoot: string) {
  app.post('/api/me/avatar', { preHandler: authenticate }, async (request, reply) => {
    const asset = await saveUpload(request, uploadRoot, 'avatar')
    return reply.code(201).send({ avatarUrl: asset.url })
  })
  app.post('/api/media', { preHandler: requirePermission('media.use') }, async (request, reply) => {
    if (!(await contentLimits()).directLibraryUploads)
      return reply.code(403).send({ error: '请在发帖或回复时添加图片，发布后才会上传' })
    return reply.code(201).send(await saveUpload(request, uploadRoot, 'library'))
  })
  app.get('/api/emoji-packs', async (request, reply) => {
    let uid: string | null = null
    if (request.headers.authorization) {
      const result = await authenticate(request, reply)
      if (result) return result
      uid = request.user.uid
    }
    return (
      await query(
        `SELECT p.id,p.name,p.is_community,COALESCE(o.sort_order,p.sort_order) AS sort_order,
        COALESCE(json_agg(json_build_object('id',m.id,'url','/uploads/' || m.storage_key,'name',m.alt_text,'remote',m.remote_cached) ORDER BY m.created_at,m.id) FILTER (WHERE m.id IS NOT NULL),'[]'::json) AS emojis
       FROM emoji_packs p LEFT JOIN media_assets m ON m.emoji_pack_id=p.id
       LEFT JOIN user_emoji_pack_order o ON o.pack_id=p.id AND o.user_uid=$1
       WHERE p.is_community OR p.created_by=$1
         OR EXISTS(SELECT 1 FROM user_emoji_packs up WHERE up.pack_id=p.id AND up.user_uid=$1)
       GROUP BY p.id,o.sort_order HAVING COUNT(m.id)>0
       ORDER BY p.is_community DESC,COALESCE(o.sort_order,p.sort_order),p.name,p.id`,
        [uid],
      )
    ).rows
  })
  app.put(
    '/api/admin/community-emoji-pack',
    { preHandler: adminPermissions.media },
    async (request, reply) => {
      const parsed = z.object({ packId: z.string().regex(/^\d+$/).nullable() }).safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: '表情包标识无效' })
      await inTransaction((client) => setCommunityEmojiPack(parsed.data.packId, client))
      return { saved: true }
    },
  )
  app.put(
    '/api/me/emoji-pack-order',
    { preHandler: requirePermission('media.use') },
    async (request, reply) => {
      const parsed = z
        .object({ packIds: z.array(z.string().regex(/^\d+$/)).max(10000) })
        .safeParse(request.body)
      if (!parsed.success || new Set(parsed.data.packIds).size !== parsed.data.packIds.length)
        return reply.code(400).send({ error: '表情包排序无效' })
      await inTransaction(async (client) => {
        await client.query('SELECT uid FROM users WHERE uid=$1 FOR UPDATE', [request.user.uid])
        const packs = await client.query<{ id: string }>(
          `SELECT id FROM emoji_packs p WHERE NOT p.is_community AND (p.created_by=$1 OR EXISTS (
          SELECT 1 FROM user_emoji_packs up WHERE up.pack_id=p.id AND up.user_uid=$1))`,
          [request.user.uid],
        )
        const ids = new Set(packs.rows.map((p) => p.id))
        if (ids.size !== parsed.data.packIds.length || parsed.data.packIds.some((id) => !ids.has(id)))
          throw mediaError('表情包列表已变化，请刷新后重新排序', 409)
        for (const [index, id] of parsed.data.packIds.entries())
          await client.query(
            `INSERT INTO user_emoji_pack_order(user_uid,pack_id,sort_order) VALUES($1,$2,$3)
          ON CONFLICT(user_uid,pack_id) DO UPDATE SET sort_order=EXCLUDED.sort_order`,
            [request.user.uid, id, index],
          )
      })
      return { saved: true }
    },
  )
  app.get('/api/admin/media/search', { preHandler: adminPermissions.media }, async (request, reply) => {
    const parsed = z
      .object({
        collection: z.enum(['library', 'emoji', 'site_icon']).optional(),
        packId: z.string().regex(/^\d+$/).optional(),
        q: z.string().trim().max(160).default(''),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50),
      })
      .safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: '图片搜索条件无效' })
    const { collection, packId, q, pageSize } = parsed.data
    const where = `FROM media_assets m LEFT JOIN emoji_packs p ON p.id=m.emoji_pack_id
      WHERE ($1::text IS NULL OR m.collection=$1) AND ($2::bigint IS NULL OR m.emoji_pack_id=$2)
      AND ($3='' OR strpos(lower(concat_ws(' ',m.original_name,m.alt_text,p.name)),lower($3))>0)`
    const params = [collection ?? null, packId ?? null, q]
    const count = await query<{ total: number }>(`SELECT COUNT(*)::int AS total ${where}`, params)
    const total = count.rows[0]!.total
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const page = Math.min(parsed.data.page, totalPages)
    const images = await query(
      `SELECT m.*,p.name AS pack_name,'/uploads/' || m.storage_key AS url
      ${where} ORDER BY m.created_at DESC,m.id DESC LIMIT $4 OFFSET $5`,
      [...params, pageSize, (page - 1) * pageSize],
    )
    return { items: images.rows, total, page, pageSize, totalPages }
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
    const [limits, settings, usage, packCount] = await Promise.all([
      userMediaLimits(request.user.uid),
      readSettings(['remote_emoji']),
      query<{ bytes: string }>(
        `SELECT
        (SELECT COALESCE(SUM(byte_size),0)::text FROM media_assets WHERE created_by=$1 AND NOT remote_cached AND collection<>'site_icon') AS bytes`,
        [request.user.uid],
      ),
      personalEmojiPackCount(request.user.uid),
    ])
    return {
      limits,
      usedBytes: Number(usage.rows[0]!.bytes),
      uploadedPacks: packCount,
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
      if (!admin && parsed.data.collection === 'library' && !(await contentLimits()).directLibraryUploads)
        return reply.code(403).send({ error: '请在发帖或回复时添加图片，发布后才会上传' })
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
            `SELECT p.*,COALESCE(o.sort_order,p.sort_order) AS sort_order,COUNT(m.id)::int AS emoji_count,
              (array_agg('/uploads/' || m.storage_key ORDER BY m.created_at,m.id) FILTER(WHERE m.id IS NOT NULL))[1:4] AS preview_urls
       FROM emoji_packs p LEFT JOIN media_assets m ON m.emoji_pack_id=p.id
       LEFT JOIN user_emoji_pack_order o ON o.pack_id=p.id AND o.user_uid=$1
       WHERE $1::bigint IS NULL OR p.is_community OR p.created_by=$1 OR EXISTS(SELECT 1 FROM user_emoji_packs up WHERE up.pack_id=p.id AND up.user_uid=$1)
       GROUP BY p.id,o.sort_order ORDER BY p.is_community DESC,COALESCE(o.sort_order,p.sort_order),p.name,p.id`,
            [admin ? null : request.user.uid],
          )
        ).rows,
    )
    app.get(`${prefix}/emoji-packs/:id/images`, { preHandler: guard }, async (request, reply) => {
      const id = (request.params as { id: string }).id
      const access = await query(
        `SELECT 1 FROM emoji_packs p WHERE p.id=$1 AND ($2::bigint IS NULL OR p.is_community OR p.created_by=$2 OR EXISTS(SELECT 1 FROM user_emoji_packs up WHERE up.pack_id=p.id AND up.user_uid=$2))`,
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
          if (!admin) await checkEmojiPackLimit(request.user.uid, client)
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
          'UPDATE emoji_packs SET name=COALESCE($2,name),sort_order=COALESCE($3,sort_order) WHERE id=$1 AND remote_source IS NULL AND ($4::bigint IS NULL OR (created_by=$4 AND NOT is_community)) RETURNING *',
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
        if (!admin) await client.query('SELECT uid FROM users WHERE uid=$1 FOR UPDATE', [request.user.uid])
        const pack = await client.query<{
          remote_source: string | null
          is_community: boolean
        }>('SELECT remote_source,is_community FROM emoji_packs WHERE id=$1 FOR UPDATE', [id])
        if (!pack.rows[0]) throw mediaError('表情包不存在', 404)
        if (!admin && pack.rows[0].is_community) throw mediaError('社区表情包由管理员管理', 403)
        if (pack.rows[0].remote_source) {
          if (admin && pack.rows[0].is_community) {
            await client.query('UPDATE emoji_packs SET is_community=FALSE WHERE id=$1', [id])
            return []
          }
          if (admin) throw mediaError('共用缓存不可直接删除，请由用户移除个人收藏', 409)
          const removed = await client.query(
            'DELETE FROM user_emoji_packs WHERE user_uid=$1 AND pack_id=$2 RETURNING pack_id',
            [request.user.uid, id],
          )
          if (!removed.rowCount) throw mediaError('尚未添加此表情包', 404)
          await client.query('DELETE FROM user_emoji_pack_order WHERE user_uid=$1 AND pack_id=$2', [
            request.user.uid,
            id,
          ])
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
