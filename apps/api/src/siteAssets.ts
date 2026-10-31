import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { FastifyBaseLogger, FastifyRequest } from 'fastify'
import { imageTypes, mediaError } from './media.js'
import { query } from './db.js'

export const siteAssetRoot = (uploadRoot: string) =>
  resolve(uploadRoot, '../site-assets')
const assetKey = /^[0-9a-f-]{36}\.(png|jpg|webp|gif)$/

export async function removeSiteAsset(
  uploadRoot: string,
  url: string,
  log: FastifyBaseLogger,
) {
  const key = url.replace(/^\/site-assets\//, '')
  if (!assetKey.test(key)) return
  await rm(resolve(siteAssetRoot(uploadRoot), key), { force: true }).catch(
    (error) => {
      log.error(error, 'Unable to remove unused community image')
    },
  )
}

export async function removeSiteAssetIfUnused(
  uploadRoot: string,
  url: string,
  log: FastifyBaseLogger,
) {
  if (!isSiteAssetKey(url.replace(/^\/site-assets\//, ''))) return
  const reference = await query<{ used: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM categories WHERE icon_image_url=$1 OR header_background_url=$1
     ) OR EXISTS (
       SELECT 1 FROM app_settings WHERE setting_key='home_background_url' AND setting_value #>> '{}' = $1
     ) AS used`,
    [url],
  )
  if (!reference.rows[0]?.used) await removeSiteAsset(uploadRoot, url, log)
}

export async function readSiteImage(request: FastifyRequest, icon: boolean) {
  const file = await request.file({
    limits: { fileSize: (icon ? 2 : 10) * 1024 * 1024, files: 1, fields: 0 },
  })
  if (!file) throw mediaError('请选择图片')
  const extension = imageTypes.get(file.mimetype)
  if (!extension) throw mediaError('仅支持 PNG、JPEG、WebP 和 GIF 图片', 415)
  let buffer: Buffer
  try {
    buffer = await file.toBuffer()
  } catch (error) {
    if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE')
      throw mediaError(
        icon ? '图标不能超过 2 MiB' : '背景图不能超过 10 MiB',
        413,
      )
    throw error
  }
  const signatures: Record<string, boolean> = {
    '.png': buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    '.jpg': buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255,
    '.gif': ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6)),
    '.webp':
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP',
  }
  if (!signatures[extension]) throw mediaError('图片内容与格式不符', 415)
  return { buffer, key: `${randomUUID()}${extension}` }
}

export async function writeSiteImage(
  uploadRoot: string,
  image: { key: string; buffer: Buffer },
) {
  await mkdir(siteAssetRoot(uploadRoot), { recursive: true })
  await writeFile(resolve(siteAssetRoot(uploadRoot), image.key), image.buffer, {
    flag: 'wx',
  })
  return `/site-assets/${image.key}`
}

export const isSiteAssetKey = (key: string) => assetKey.test(key)
