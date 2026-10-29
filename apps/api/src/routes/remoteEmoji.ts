import { randomUUID } from 'node:crypto'
import { unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { adminPermissions, requirePermission } from '../auth.js'
import { inTransaction } from '../db.js'
import { imageTypes, mediaError } from '../media.js'
import { readSettings, type RemoteEmojiSettings } from '../settings.js'
import { checkEmojiPackLimit, setCommunityEmojiPack } from '../emoji.js'

const remotePackage = z.object({
  id: z.number(),
  text: z.string(),
  type: z.number(),
  url: z.string(),
  UrlType: z.number(),
})
const remoteEmote = z.object({
  text: z.string(),
  url: z.string(),
  gif_url: z.string(),
  type: z.number(),
})
const detailSchema = z.object({
  id: z.number(),
  text: z.string(),
  emote: z.array(remoteEmote),
})
const importSchema = z.object({
  remoteId: z.number().int().positive(),
  variant: z.enum(['static', 'animated']),
  community: z.boolean().default(false),
})
function endpoint(remote: RemoteEmojiSettings, path: string) {
  return `${remote.apiUrl.replace(/\/$/, '')}/${path}`
}
function imageUrl(value: string, urlType = 0) {
  const url = new URL(value, `https://i0.hdslb.com/bfs/${urlType >= 2 ? 'garb' : 'emote'}/`)
  if (!['http:', 'https:'].includes(url.protocol)) throw mediaError('远端图片地址无效', 502)
  if (url.hostname.endsWith('.hdslb.com')) url.protocol = 'https:'
  return url.href
}
async function fetchRemote(url: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30000),
    headers: {
      'User-Agent': 'WinUI-BBS/0.1.0',
      Referer: 'https://www.bilibili.com/',
    },
  })
  if (!response.ok) throw mediaError(`远端请求失败 (${response.status})`, 502)
  return response
}
async function remoteSettings() {
  const settings = await readSettings(['remote_emoji'])
  const remote = settings.remote_emoji as RemoteEmojiSettings
  if (!remote.enabled) throw mediaError('管理员尚未开放远端表情包', 403)
  return remote
}
async function downloadImage(url: string) {
  const response = await fetchRemote(url)
  const type = response.headers.get('content-type')?.split(';')[0] || ''
  const extension = imageTypes.get(type)
  if (!extension) {
    await response.body?.cancel()
    throw mediaError('远端返回了不支持的图片格式', 415)
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of response.body!) {
    size += chunk.byteLength
    if (size > 3 * 1024 ** 2) throw mediaError('远端表情超过 3 MiB，未导入此表情包', 413)
    chunks.push(Buffer.from(chunk))
  }
  return { buffer: Buffer.concat(chunks), extension, type }
}
export async function registerRemoteEmojiRoutes(app: FastifyInstance, uploadRoot: string) {
  const search = async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = z
      .object({
        q: z.string().trim().max(80).default(''),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: '搜索条件无效' })
    const remote = await remoteSettings()
    const payload = (await (await fetchRemote(endpoint(remote, 'list'))).json()) as {
      data: { all_packages: unknown[] }
    }
    const packages = z
      .array(remotePackage)
      .parse(payload.data.all_packages)
      .filter((item) => item.type !== 4)
    const filtered = packages.filter(
      (item) => !parsed.data.q || item.text.toLowerCase().includes(parsed.data.q.toLowerCase()),
    )
    return {
      total: filtered.length,
      items: filtered.slice(parsed.data.offset, parsed.data.offset + 40).map((item) => ({
        id: item.id,
        name: item.text,
        thumbnail: imageUrl(item.url, item.UrlType),
      })),
    }
  }
  const preview = async (request: FastifyRequest) => {
    const remote = await remoteSettings()
    const { id } = request.params as { id: string }
    if (!/^\d+$/.test(id)) throw mediaError('表情包标识无效')
    const detail = detailSchema.parse(await (await fetchRemote(endpoint(remote, `info?id=${id}`))).json())
    return {
      id: detail.id,
      name: detail.text,
      hasAnimated: detail.emote.some((item) => Boolean(item.gif_url)),
      items: detail.emote
        .filter((item) => item.type !== 4)
        .map((item) => ({
          name: item.text,
          url: imageUrl(item.url),
          animatedUrl: item.gif_url ? imageUrl(item.gif_url) : null,
        })),
    }
  }
  const importRemote = async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = importSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '远端表情包参数无效' })
    const admin = request.url.startsWith('/api/admin/')
    if (parsed.data.community && !admin) return reply.code(403).send({ error: '仅管理员可设置社区表情包' })
    const remote = await remoteSettings()
    const source = remote.apiUrl.replace(/\/$/, '')
    const files: string[] = []
    try {
      const pack = await inTransaction(async (client) => {
        await client.query('SELECT uid FROM users WHERE uid=$1 FOR UPDATE', [request.user.uid])
        // Serialize downloads for this source, pack and variant across all users.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `${source}:${parsed.data.remoteId}:${parsed.data.variant}`,
        ])
        const existing = await client.query<{
          id: string
          is_community: boolean
          subscribed: boolean
        }>(
          `SELECT id,is_community,EXISTS(SELECT 1 FROM user_emoji_packs WHERE pack_id=p.id AND user_uid=$4) AS subscribed
           FROM emoji_packs p WHERE remote_source=$1 AND remote_id=$2 AND variant=$3`,
          [source, String(parsed.data.remoteId), parsed.data.variant, request.user.uid],
        )
        if (
          !parsed.data.community &&
          !existing.rows[0]?.is_community &&
          !existing.rows[0]?.subscribed &&
          remote.countTowardPackLimit
        )
          await checkEmojiPackLimit(request.user.uid, client)
        let packId: string
        if (existing.rows[0]) packId = existing.rows[0].id
        else {
          const detail = detailSchema.parse(
            await (await fetchRemote(endpoint(remote, `info?id=${parsed.data.remoteId}`))).json(),
          )
          const emotes = detail.emote.filter(
            (item) => item.type !== 4 && (parsed.data.variant === 'static' || Boolean(item.gif_url)),
          )
          if (!emotes.length) throw mediaError('此表情包没有可用的所选版本', 409)
          packId = (
            await client.query(
              'INSERT INTO emoji_packs(name,remote_source,remote_id,variant) VALUES($1,$2,$3,$4) RETURNING id',
              [detail.text.slice(0, 64), source, String(parsed.data.remoteId), parsed.data.variant],
            )
          ).rows[0].id
          for (const item of emotes) {
            const asset = await downloadImage(
              imageUrl(parsed.data.variant === 'animated' ? item.gif_url : item.url),
            )
            const storageKey = `${randomUUID()}${asset.extension}`
            await writeFile(resolve(uploadRoot, storageKey), asset.buffer, {
              flag: 'wx',
            })
            files.push(storageKey)
            await client.query(
              `INSERT INTO media_assets(storage_key,original_name,mime_type,byte_size,alt_text,collection,emoji_pack_id,remote_cached)
              VALUES($1,$2,$3,$4,$5,'emoji',$6,TRUE)`,
              [
                storageKey,
                `${item.text}${asset.extension}`,
                asset.type,
                asset.buffer.byteLength,
                item.text,
                packId,
              ],
            )
          }
        }
        if (parsed.data.community) await setCommunityEmojiPack(packId, client)
        else if (!existing.rows[0]?.is_community)
          await client.query(
            'INSERT INTO user_emoji_packs(user_uid,pack_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
            [request.user.uid, packId],
          )
        return { id: packId }
      })
      return reply.code(201).send(pack)
    } catch (error) {
      await Promise.all(files.map((file) => unlink(resolve(uploadRoot, file))))
      throw error
    }
  }
  for (const admin of [false, true]) {
    const prefix = admin ? '/api/admin' : '/api/me'
    const guard = admin ? adminPermissions.media : requirePermission('media.use')
    app.get(`${prefix}/remote-emoji/packages`, { preHandler: guard }, search)
    app.get(`${prefix}/remote-emoji/packages/:id`, { preHandler: guard }, preview)
    app.post(`${prefix}/remote-emoji/import`, { preHandler: guard }, importRemote)
  }
}
