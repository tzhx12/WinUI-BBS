import { randomUUID } from 'node:crypto'
import { unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { FastifyRequest } from 'fastify'
import type { PoolClient } from 'pg'
import { decodeHTML } from 'entities'
import { z } from 'zod'
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5'
import { inTransaction, query } from './db.js'
import { contentLimits, userMediaLimits } from './settings.js'
import { imageTypes, mediaError } from './media.js'

export const editorBodySchema = z
  .object({
    blocks: z
      .array(
        z.object({
          id: z.string().optional(),
          type: z.enum([
            'paragraph',
            'header',
            'quote',
            'list',
            'image',
            'emoji',
            'code',
            'delimiter',
            'spoiler',
          ]),
          data: z.record(z.string(), z.unknown()),
        }),
      )
      .min(1)
      .max(2000),
  })
  .passthrough()
type Body = z.infer<typeof editorBodySchema>
type Attachment = { id: string; name: string; mime: string; buffer: Buffer }

function textLength(value: unknown, key = ''): number {
  if (typeof value === 'string') {
    // Count visible text, including nested lists and captions, never URLs/formatting metadata.
    if (!['text', 'content', 'caption', 'code', ''].includes(key)) return 0
    if (key === 'code') return Array.from(value).length
    return Array.from(decodeHTML(value.replace(/<[^>]*>/g, ''))).length
  }
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + textLength(item), 0)
  if (value && typeof value === 'object')
    return Object.entries(value).reduce((sum, [k, v]) => sum + textLength(v, k), 0)
  return 0
}

function inlineEmojiImages(value: unknown, key = ''): Array<{ id: string; url: string }> {
  if (typeof value === 'string') {
    if (!['text', 'content', 'caption', ''].includes(key) || !value.includes('<')) return []
    const images: Array<{ id: string; url: string }> = []
    function visit(node: DefaultTreeAdapterTypes.Node) {
      if ('tagName' in node && node.tagName === 'img') {
        const attrs = Object.fromEntries(node.attrs.map((attr) => [attr.name, attr.value]))
        images.push({
          id: attrs['data-remote-emoji'] || '',
          url: attrs.src || '',
        })
      }
      if ('childNodes' in node) node.childNodes.forEach(visit)
    }
    visit(parseFragment(value))
    return images
  }
  if (Array.isArray(value)) return value.flatMap((item) => inlineEmojiImages(item))
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([k, v]) => inlineEmojiImages(v, k))
  return []
}

export async function validateContent(body: Body, kind: 'post' | 'reply') {
  const limits = await contentLimits()
  const chars = body.blocks.reduce((sum, block) => sum + textLength(block.data), 0)
  const inline = body.blocks
    .filter((block) => block.type !== 'code')
    .flatMap((block) => inlineEmojiImages(block.data))
  const images = body.blocks.filter((block) => ['image', 'emoji'].includes(block.type)).length + inline.length
  const maxChars = kind === 'post' ? limits.postCharacters : limits.replyCharacters
  const maxImages = kind === 'post' ? limits.postImages : limits.replyImages
  if (chars > maxChars) throw mediaError(`正文最多 ${maxChars} 字，当前 ${chars} 字`)
  if (images > maxImages) throw mediaError(`正文最多 ${maxImages} 张图片（含表情），当前 ${images} 张`)
  if (!chars && !images) throw mediaError('正文不能为空')
  if (inline.length) {
    if (inline.some((image) => !z.uuid().safeParse(image.id).success))
      throw mediaError('行内表情无效，请从选择器重新添加')
    const assets = await query<{ id: string; url: string }>(
      "SELECT id,'/uploads/' || storage_key AS url FROM media_assets WHERE remote_cached AND id=ANY($1::uuid[])",
      [inline.map((image) => image.id)],
    )
    const urls = new Map(assets.rows.map((asset) => [asset.id, asset.url]))
    if (inline.some((image) => urls.get(image.id) !== image.url))
      throw mediaError('行内表情仅支持已下载的远端表情，请重新选择')
  }
  for (const block of body.blocks) {
    if (!['image', 'emoji'].includes(block.type)) continue
    const url = block.type === 'image' ? (block.data.file as { url?: unknown })?.url : block.data.url
    if (
      typeof url !== 'string' ||
      !/^(https?:\/\/\S+|\/uploads\/[^/]+|\/deleted-image\.png|draft:[\w-]+)$/.test(url) ||
      (block.type === 'emoji' && url.startsWith('draft:'))
    )
      throw mediaError('正文图片地址无效，请重新选择图片')
  }
}

// Files exist only in memory until every post/reply validation has passed.
export async function readSubmission(request: FastifyRequest) {
  if (!request.isMultipart()) return { payload: request.body, attachments: [] as Attachment[] }
  const limits = await userMediaLimits(request.user.uid)
  const attachments: Attachment[] = []
  let payload: unknown
  let bytes = 0
  for await (const part of request.parts({
    limits: {
      files: 50,
      fields: 1,
      parts: 51,
      fileSize: limits.imageBytes,
      fieldSize: 1500000,
    },
  })) {
    if (part.type === 'field') {
      if (part.fieldname !== 'payload' || payload !== undefined || part.valueTruncated)
        throw mediaError('提交内容无效')
      try {
        payload = JSON.parse(String(part.value))
      } catch {
        throw mediaError('提交内容无效')
      }
    } else {
      if (!/^draft:[\w-]+$/.test(part.fieldname) || attachments.some((a) => a.id === part.fieldname))
        throw mediaError('图片标识无效')
      if (!imageTypes.has(part.mimetype)) throw mediaError('仅支持 PNG、JPEG、WebP 和 GIF 图片', 415)
      const buffer = await part.toBuffer()
      bytes += buffer.length
      if (bytes > Math.min(limits.storageBytes, 100 * 1024 ** 2))
        throw mediaError('单次发布图片总大小不能超过个人容量或 100 MiB', 413)
      attachments.push({
        id: part.fieldname,
        name: part.filename,
        mime: part.mimetype,
        buffer,
      })
    }
  }
  return { payload, attachments }
}

export async function withSubmission<T>(
  uid: string,
  body: Body,
  attachments: Attachment[],
  root: string,
  action: (client: PoolClient) => Promise<T>,
) {
  const paths: string[] = []
  const refs = new Set(
    body.blocks
      .filter((b) => b.type === 'image')
      .map((b) => (b.data.file as { url: string }).url)
      .filter((url) => url.startsWith('draft:')),
  )
  if (attachments.length !== refs.size || attachments.some((a) => !refs.has(a.id)))
    throw mediaError('待发图片不完整，请重新选择图片')
  try {
    return await inTransaction(async (client) => {
      // Keep one lock order for replies with and without attachments: author, then post.
      await client.query('SELECT uid FROM users WHERE uid=$1 FOR NO KEY UPDATE', [uid])
      if (attachments.length) {
        const permission = await client.query(
          `SELECT 1 FROM group_memberships gm JOIN group_permissions gp ON gp.group_id=gm.group_id WHERE gm.user_uid=$1 AND gp.permission_key='media.use' AND (gm.expires_at IS NULL OR gm.expires_at>NOW()) LIMIT 1`,
          [uid],
        )
        if (!permission.rowCount) throw mediaError('当前用户组没有图片上传权限', 403)
        const limits = await userMediaLimits(uid, client)
        const usage = await client.query<{ bytes: string }>(
          "SELECT COALESCE(SUM(byte_size),0)::text AS bytes FROM media_assets WHERE created_by=$1 AND NOT remote_cached AND collection<>'site_icon'",
          [uid],
        )
        if (
          Number(usage.rows[0]!.bytes) + attachments.reduce((sum, a) => sum + a.buffer.length, 0) >
          limits.storageBytes
        )
          throw mediaError('图床容量不足', 409)
        for (const a of attachments) {
          const key = `${randomUUID()}${imageTypes.get(a.mime)}`
          const path = resolve(root, key)
          await writeFile(path, a.buffer, { flag: 'wx' })
          paths.push(path)
          await client.query(
            "INSERT INTO media_assets(storage_key,original_name,mime_type,byte_size,alt_text,collection,created_by) VALUES($1,$2,$3,$4,$2,'library',$5)",
            [key, a.name, a.mime, a.buffer.length, uid],
          )
          for (const block of body.blocks)
            if (block.type === 'image' && (block.data.file as { url: string }).url === a.id)
              block.data.file = { url: `/uploads/${key}` }
        }
      }
      return action(client)
    })
  } catch (error) {
    await Promise.all(paths.map((path) => unlink(path)))
    throw error
  }
}
