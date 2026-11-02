import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { adminPermissions, requirePermission } from '../auth.js'
import { inTransaction, query } from '../db.js'
import { imageTypes, mediaError } from '../media.js'
import { readSettings, type RemoteEmojiSettings } from '../settings.js'
import { checkEmojiPackLimit, setCommunityEmojiPack } from '../emoji.js'
import { currentVersion } from '../version.js'
import { stageFile, withStagingDirectory } from '../staging.js'
import {
  deleteStoredFile,
  monitorStorage,
  putStoredFile,
  withStorageLock,
  type StoredFile,
} from '../storage.js'

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
async function fetchRemote(url: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
    headers: {
      'User-Agent': `WinUI-BBS/${currentVersion}`,
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
async function downloadImage(url: string, path: string, signal: AbortSignal) {
  const response = await fetchRemote(url, signal)
  const type = response.headers.get('content-type')?.split(';')[0] || ''
  const extension = imageTypes.get(type)
  if (!extension) {
    await response.body?.cancel()
    throw mediaError('远端返回了不支持的图片格式', 415)
  }
  await stageFile(response.body!, path, 3 * 1024 ** 2, '远端表情超过 3 MiB，未导入此表情包')
  return { path, extension, type }
}

// Queue the same pack without holding a database connection or buffering its images.
const imports = new Map<string, Promise<void>>()
let importRequests = 0
async function serialImport<T>(key: string, work: () => Promise<T>) {
  if (importRequests >= 34) throw mediaError('远端表情导入繁忙，请稍后重试', 503)
  importRequests++
  const previous = imports.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  imports.set(key, current)
  await previous
  try {
    return await work()
  } finally {
    importRequests--
    release()
    if (imports.get(key) === current) imports.delete(key)
  }
}

let preparing = 0
const waiting: Array<() => void> = []
async function preparationSlot<T>(work: () => Promise<T>) {
  if (preparing >= 2) {
    await new Promise<void>((resolve) => waiting.push(resolve))
  } else preparing++
  try {
    return await work()
  } finally {
    const next = waiting.shift()
    if (next) next()
    else preparing--
  }
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
    const key = `${source}:${parsed.data.remoteId}:${parsed.data.variant}`
    const existingSql = `SELECT id,is_community,EXISTS(SELECT 1 FROM user_emoji_packs WHERE pack_id=p.id AND user_uid=$4) AS subscribed
      FROM emoji_packs p WHERE remote_source=$1 AND remote_id=$2 AND variant=$3`
    const values = [source, String(parsed.data.remoteId), parsed.data.variant, request.user.uid]
    type Existing = { id: string; is_community: boolean; subscribed: boolean }
    return serialImport(key, () =>
      preparationSlot(() =>
        withStagingDirectory(async (directory) => {
          let prepared:
            | {
                name: string
                assets: Array<Awaited<ReturnType<typeof downloadImage>> & { name: string }>
              }
            | undefined
          if (!(await query<Existing>(existingSql, values)).rowCount) {
            if (!parsed.data.community && remote.countTowardPackLimit)
              await inTransaction(async (client) => {
                await client.query('SELECT uid FROM users WHERE uid=$1 FOR UPDATE', [request.user.uid])
                await checkEmojiPackLimit(request.user.uid, client)
              })
            const detail = detailSchema.parse(
              await (await fetchRemote(endpoint(remote, `info?id=${parsed.data.remoteId}`))).json(),
            )
            const emotes = detail.emote.filter(
              (item) => item.type !== 4 && (parsed.data.variant === 'static' || Boolean(item.gif_url)),
            )
            if (!emotes.length) throw mediaError('此表情包没有可用的所选版本', 409)
            const assets: NonNullable<typeof prepared>['assets'] = new Array(emotes.length)
            const abort = new AbortController()
            let next = 0,
              downloadError: unknown
            await Promise.all(
              Array.from({ length: Math.min(3, emotes.length) }, async () => {
                try {
                  while (next < emotes.length && !abort.signal.aborted) {
                    const index = next++,
                      item = emotes[index]!
                    const asset = await downloadImage(
                      imageUrl(parsed.data.variant === 'animated' ? item.gif_url : item.url),
                      join(directory, String(index)),
                      abort.signal,
                    )
                    assets[index] = { ...asset, name: item.text }
                  }
                } catch (error) {
                  downloadError ??= error
                  abort.abort()
                }
              }),
            )
            if (downloadError) throw downloadError
            prepared = { name: detail.text.slice(0, 64), assets }
          }
          const files: StoredFile[] = []
          return withStorageLock(async () => {
            await monitorStorage(uploadRoot)
            try {
              const pack = await inTransaction(async (client) => {
                await client.query('SELECT uid FROM users WHERE uid=$1 FOR UPDATE', [request.user.uid])
                // Recheck the shared cache after preparation, including other API processes.
                await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key])
                const existing = await client.query<Existing>(existingSql, values)
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
                  if (!prepared) throw mediaError('表情包缓存已变更，请重新导入', 409)
                  packId = (
                    await client.query(
                      'INSERT INTO emoji_packs(name,remote_source,remote_id,variant) VALUES($1,$2,$3,$4) RETURNING id',
                      [prepared.name, source, String(parsed.data.remoteId), parsed.data.variant],
                    )
                  ).rows[0].id
                  for (const asset of prepared.assets) {
                    const buffer = await readFile(asset.path)
                    const storageKey = `${randomUUID()}${asset.extension}`
                    const stored = await putStoredFile(uploadRoot, storageKey, buffer, asset.type, client)
                    files.push(stored)
                    await client.query(
                      `INSERT INTO media_assets(storage_key,original_name,mime_type,byte_size,alt_text,collection,emoji_pack_id,remote_cached,storage_backend,storage_location,recycle_protected)
              VALUES($1,$2,$3,$4,$5,'emoji',$6,TRUE,$7,$8,TRUE)`,
                      [
                        storageKey,
                        `${asset.name}${asset.extension}`,
                        asset.type,
                        buffer.byteLength,
                        asset.name,
                        packId,
                        stored.storage_backend,
                        stored.storage_location,
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
              await Promise.all(files.map((file) => deleteStoredFile(uploadRoot, file)))
              throw error
            } finally {
              await monitorStorage(uploadRoot)
            }
          })
        }),
      ),
    )
  }
  for (const admin of [false, true]) {
    const prefix = admin ? '/api/admin' : '/api/me'
    const guard = admin ? adminPermissions.media : requirePermission('media.use')
    app.get(`${prefix}/remote-emoji/packages`, { preHandler: guard }, search)
    app.get(`${prefix}/remote-emoji/packages/:id`, { preHandler: guard }, preview)
    app.post(`${prefix}/remote-emoji/import`, { preHandler: guard }, importRemote)
  }
}
