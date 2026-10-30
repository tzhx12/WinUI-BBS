import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { statfs, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import { pool, query, inTransaction } from './db.js'
import { readSettings } from './settings.js'
import { encryptStorageSecret, decryptStorageSecret } from './secrets.js'
import { replaceDeletedImages } from './media.js'

const storageError = (message: string, statusCode = 503) =>
  Object.assign(new Error(message), { statusCode })
const bytes = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
export const storageSchema = z.object({
  localMaxBytes: bytes,
  preference: z.enum(['local', 's3']),
  recycleBytes: bytes.min(1),
  s3: z.object({
    enabled: z.boolean(),
    endpoint: z.union([z.url({ protocol: /^https?$/ }), z.literal('')]),
    region: z.string().trim().min(1).max(80),
    bucket: z.string().trim().max(255),
    prefix: z
      .string()
      .max(255)
      .regex(/^[\w./-]*$/),
    accessKeyId: z.string().trim().max(500),
    secretAccessKey: z.string().max(2000),
    capacityBytes: bytes,
    forcePathStyle: z.boolean(),
  }),
})
export type StorageSettings = z.infer<typeof storageSchema>
type S3Settings = StorageSettings['s3']
export type StoredFile = {
  storage_key: string
  byte_size: string | number
  storage_backend: 'local' | 's3'
  storage_location: { id: string; key: string } | null
}
export async function readStorageSettings() {
  return (await readSettings(['media_storage']))
    .media_storage as StorageSettings
}
export function publicStorageSettings(value: StorageSettings) {
  return {
    ...value,
    s3: {
      ...value.s3,
      accessKeyId: '',
      secretAccessKey: '',
      hasCredentials: Boolean(value.s3.accessKeyId && value.s3.secretAccessKey),
    },
  }
}
export async function mergeStorageSettings(
  value: StorageSettings,
  previous: StorageSettings,
) {
  const s3 = {
    ...value.s3,
    accessKeyId: value.s3.accessKeyId
      ? encryptStorageSecret(value.s3.accessKeyId)
      : previous.s3.accessKeyId,
    secretAccessKey: value.s3.secretAccessKey
      ? encryptStorageSecret(value.s3.secretAccessKey)
      : previous.s3.secretAccessKey,
  }
  if (
    s3.enabled &&
    (!s3.endpoint ||
      !s3.bucket ||
      !s3.accessKeyId ||
      !s3.secretAccessKey ||
      !s3.capacityBytes)
  )
    throw storageError('启用对象存储需要端点、存储桶、凭据和本站容量配额', 400)
  if (value.preference === 's3' && !s3.enabled)
    throw storageError('请先启用对象存储，或选择优先使用本地存储', 400)
  return { ...value, s3 }
}
function s3Client(config: S3Settings) {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: decryptStorageSecret(config.accessKeyId),
      secretAccessKey: decryptStorageSecret(config.secretAccessKey),
    },
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 10000, requestTimeout: 30000 },
  })
}
async function withS3<T>(
  config: S3Settings,
  action: (client: S3Client) => Promise<T>,
) {
  const client = s3Client(config)
  try {
    return await action(client)
  } finally {
    client.destroy()
  }
}
export async function testObjectStorage(config: S3Settings) {
  if (
    !config.endpoint ||
    !config.bucket ||
    !config.accessKeyId ||
    !config.secretAccessKey
  )
    throw storageError('请填写端点、存储桶和凭据', 400)
  // A unique probe verifies read/write/delete permissions without touching existing objects.
  const key = `${config.prefix}.forum-probe-${randomUUID()}`
  try {
    await withS3(config, async (client) => {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: 'forum-storage-check',
          ContentType: 'text/plain',
        }),
      )
      try {
        const result = await client.send(
          new GetObjectCommand({ Bucket: config.bucket, Key: key }),
        )
        if ((await result.Body?.transformToString()) !== 'forum-storage-check')
          throw new Error('Unexpected probe content')
      } finally {
        await client.send(
          new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
        )
      }
    })
  } catch {
    throw storageError(
      '对象存储读写检查失败，请检查地址、存储桶和读写删除权限',
      502,
    )
  }
}

// All writers and settings changes share this cross-process lock, before taking user/post locks.
export async function withStorageLock<T>(work: () => Promise<T>) {
  // Waiting uploads must not occupy all pool connections needed by the current writer.
  let client: PoolClient
  for (;;) {
    client = await pool.connect()
    const locked = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext('forum-media-storage')) AS locked",
    )
    if (locked.rows[0]!.locked) break
    client.release()
    await delay(50)
  }
  try {
    return await work()
  } finally {
    await client.query(
      "SELECT pg_advisory_unlock(hashtext('forum-media-storage'))",
    )
    client.release()
  }
}

async function localCapacity(
  root: string,
  config: StorageSettings,
  db: Pool | PoolClient = pool,
) {
  const disk = await statfs(root)
  const result = await db.query<{
    bytes: string
  }>(`SELECT COALESCE(SUM(byte_size),0)::text AS bytes FROM (
    SELECT byte_size FROM media_assets WHERE storage_backend='local'
    UNION ALL SELECT byte_size FROM storage_deletions WHERE storage_backend='local') assets`)
  const usedBytes = Number(result.rows[0]!.bytes)
  const diskFreeBytes = disk.bavail * disk.bsize
  const capacityBytes = Math.min(
    config.localMaxBytes || Number.MAX_SAFE_INTEGER,
    usedBytes + diskFreeBytes,
  )
  const freeBytes = Math.max(
    0,
    Math.min(capacityBytes - usedBytes, diskFreeBytes),
  )
  return {
    backend: 'local' as const,
    usedBytes,
    capacityBytes,
    freeBytes,
    diskFreeBytes,
    diskTotalBytes: disk.blocks * disk.bsize,
    percent: capacityBytes ? (usedBytes / capacityBytes) * 100 : 100,
    diskPercent: (1 - diskFreeBytes / (disk.blocks * disk.bsize)) * 100,
  }
}
async function objectCapacity(
  config: S3Settings,
  db: Pool | PoolClient = pool,
) {
  const result = await db.query<{ bytes: string }>(
    `SELECT COALESCE(SUM(a.byte_size),0)::text AS bytes FROM (
    SELECT byte_size,storage_location FROM media_assets WHERE storage_backend='s3'
    UNION ALL SELECT byte_size,storage_location FROM storage_deletions WHERE storage_backend='s3') a
    JOIN storage_locations l ON l.id=(a.storage_location->>'id')::bigint
    WHERE l.config->>'endpoint'=$1 AND l.config->>'bucket'=$2`,
    [config.endpoint, config.bucket],
  )
  const usedBytes = Number(result.rows[0]!.bytes)
  return {
    backend: 's3' as const,
    usedBytes,
    capacityBytes: config.capacityBytes,
    freeBytes: Math.max(0, config.capacityBytes - usedBytes),
    percent: config.capacityBytes
      ? (usedBytes / config.capacityBytes) * 100
      : 0,
  }
}
async function capacities(
  root: string,
  config: StorageSettings,
  db: Pool | PoolClient = pool,
) {
  return {
    local: await localCapacity(root, config, db),
    s3: config.s3.enabled ? await objectCapacity(config.s3, db) : null,
  }
}

export async function serverDisks(root: string) {
  if (process.platform === 'win32') {
    const { stdout } = await promisify(execFile)(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,Size,FreeSpace | ConvertTo-Json -Compress",
      ],
      { windowsHide: true, timeout: 10000 },
    )
    const rows = JSON.parse(stdout)
    return (Array.isArray(rows) ? rows : [rows]).map((disk) => ({
      name: disk.DeviceID as string,
      totalBytes: Number(disk.Size),
      freeBytes: Number(disk.FreeSpace),
      uploadDisk: root
        .toLowerCase()
        .startsWith(String(disk.DeviceID).toLowerCase()),
    }))
  }
  const { stdout } = await promisify(execFile)('df', ['-Pk'], {
    timeout: 10000,
  })
  const rows = stdout
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
  const seen = new Set<string>()
  const disks = rows
    .filter(
      (parts) =>
        parts.length >= 6 &&
        !/^(tmpfs|devtmpfs|udev)$/.test(parts[0]!) &&
        !seen.has(parts[0]!) &&
        seen.add(parts[0]!),
    )
    .map((parts) => ({
      name: parts.slice(5).join(' '),
      totalBytes: Number(parts[1]) * 1024,
      freeBytes: Number(parts[3]) * 1024,
      uploadDisk: false,
    }))
  const upload = disks
    .filter(
      (disk) =>
        root === disk.name ||
        root.startsWith(disk.name.replace(/\/$/, '') + '/'),
    )
    .sort((a, b) => b.name.length - a.name.length)[0]
  if (upload) upload.uploadDisk = true
  return disks
}
export async function storageStatus(root: string) {
  const config = await readStorageSettings()
  const state = await capacities(root, config)
  const disks = await serverDisks(root)
  return {
    ...state,
    disks,
    serverFreeBytes: disks.reduce((sum, disk) => sum + disk.freeBytes, 0),
    totalFreeBytes: state.local.freeBytes + (state.s3?.freeBytes || 0),
  }
}

export async function monitorStorage(root: string) {
  const config = await readStorageSettings()
  const state = await capacities(root, config)
  await inTransaction(async (client) => {
    // Independent from the writer lock, so a failed upload still leaves its warning delivered.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('forum-storage-alerts'))",
    )
    for (const backend of ['local', 's3'] as const) {
      const capacity = state[backend]
      const percent =
        backend === 'local'
          ? Math.max(state.local.percent, state.local.diskPercent)
          : capacity?.percent || 0
      const warn =
        capacity && percent >= 95 && (backend === 's3' || !config.s3.enabled)
      if (!warn) {
        await client.query('DELETE FROM storage_alerts WHERE backend=$1', [
          backend,
        ])
        continue
      }
      const sent = await client.query(
        `INSERT INTO storage_alerts(backend) VALUES($1)
        ON CONFLICT(backend) DO UPDATE SET notified_at=NOW() WHERE storage_alerts.notified_at<NOW()-INTERVAL '24 hours' RETURNING backend`,
        [backend],
      )
      if (!sent.rowCount) continue
      const notification = await client.query<{ id: string }>(
        `INSERT INTO notifications(title,body,kind)
        VALUES($1,$2,'storage') RETURNING id`,
        [
          `${backend === 'local' ? '本地' : '对象'}存储空间即将用尽`,
          `${backend === 'local' ? '本地存储或所在磁盘' : '对象存储的本站配额'}使用率已达到 ${Math.min(100, percent).toFixed(1)}%。请前往管理后台“图床与表情 → 存储设置”清理图片或扩容。所有可用存储都满时，继续上传将按时间从早到晚回收普通图片；表情包、头像和站点图标始终保留。`,
        ],
      )
      await client.query(
        `INSERT INTO notification_recipients(notification_id,user_uid)
        SELECT $1,u.uid FROM users u WHERE u.status='active' AND (u.banned_until IS NULL OR u.banned_until<=NOW()) AND EXISTS (
        SELECT 1 FROM group_memberships gm JOIN group_permissions gp ON gp.group_id=gm.group_id
        WHERE gm.user_uid=u.uid AND gp.permission_key='media.manage' AND (gm.expires_at IS NULL OR gm.expires_at>NOW()))`,
        [notification.rows[0]!.id],
      )
    }
  })
}

async function locationConfig(
  location: NonNullable<StoredFile['storage_location']>,
) {
  const result = await query<{ config: S3Settings }>(
    'SELECT config FROM storage_locations WHERE id=$1',
    [location.id],
  )
  if (!result.rows[0]) throw storageError('找不到此图片的对象存储配置')
  return result.rows[0].config
}
export async function deleteStoredFile(root: string, file: StoredFile) {
  if (file.storage_backend === 's3') {
    const config = await locationConfig(file.storage_location!)
    await withS3(config, (client) =>
      client.send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: file.storage_location!.key,
        }),
      ),
    )
  } else {
    try {
      await unlink(resolve(root, file.storage_key))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
export async function queueStorageDeletion(
  client: PoolClient,
  file: StoredFile,
) {
  await client.query(
    `INSERT INTO storage_deletions(storage_key,byte_size,storage_backend,storage_location)
    VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [
      file.storage_key,
      file.byte_size,
      file.storage_backend,
      file.storage_location,
    ],
  )
}
export async function flushStorageDeletions(root: string) {
  const files = await query<StoredFile>('SELECT * FROM storage_deletions')
  for (const file of files.rows) {
    await deleteStoredFile(root, file)
    await query('DELETE FROM storage_deletions WHERE storage_key=$1', [
      file.storage_key,
    ])
  }
}

async function recycleStorage(
  root: string,
  backends: Array<'local' | 's3'>,
  target: number,
  config: StorageSettings,
  excluded: string[],
) {
  let released = 0
  while (released < target) {
    const file = await inTransaction(async (client) => {
      const candidate = await client.query<StoredFile & { id: string }>(
        `SELECT m.* FROM media_assets m
        LEFT JOIN storage_locations l ON l.id=(m.storage_location->>'id')::bigint
        WHERE m.storage_backend=ANY($1::text[]) AND m.collection='library' AND NOT m.recycle_protected AND NOT m.remote_cached AND m.emoji_pack_id IS NULL
        AND NOT (m.storage_key=ANY($2::text[]))
        AND (m.storage_backend='local' OR (l.config->>'endpoint'=$3 AND l.config->>'bucket'=$4))
        AND NOT EXISTS(SELECT 1 FROM users WHERE avatar_url='/uploads/' || m.storage_key)
        AND NOT EXISTS(SELECT 1 FROM app_settings WHERE setting_key='site_icon_url' AND setting_value::text LIKE '%' || m.storage_key || '%')
        ORDER BY m.created_at,m.id LIMIT 1 FOR UPDATE OF m`,
        [backends, excluded, config.s3.endpoint, config.s3.bucket],
      )
      const asset = candidate.rows[0]
      if (!asset) return null
      await replaceDeletedImages(client, [asset.storage_key])
      await queueStorageDeletion(client, asset)
      await client.query('DELETE FROM media_assets WHERE id=$1', [asset.id])
      await client.query(
        `INSERT INTO audit_events(action_key,target_type,target_id,details)
        VALUES('media.auto_recycle','media',$1,$2)`,
        [
          asset.id,
          JSON.stringify({
            storageKey: asset.storage_key,
            bytes: Number(asset.byte_size),
            backend: asset.storage_backend,
          }),
        ],
      )
      return asset
    })
    if (!file) break
    await deleteStoredFile(root, file)
    await query('DELETE FROM storage_deletions WHERE storage_key=$1', [
      file.storage_key,
    ])
    released += Number(file.byte_size)
  }
  return released
}

export async function putStoredFile(
  root: string,
  key: string,
  body: Buffer,
  mime: string,
  db: PoolClient,
  excluded: string[] = [],
): Promise<StoredFile> {
  const config = await readStorageSettings()
  let state = await capacities(root, config, db)
  const order: Array<'local' | 's3'> =
    config.preference === 's3' ? ['s3', 'local'] : ['local', 's3']
  const enabled = order.filter((backend) => state[backend] !== null)
  let backend = enabled.find((name) => state[name]!.freeBytes >= body.length)
  if (!backend) {
    // Reclaim in global upload order, only when all configured backends lack room.
    const usable = enabled.filter(
      (name) => state[name]!.capacityBytes >= body.length,
    )
    while (usable.length) {
      const released = await recycleStorage(
        root,
        usable,
        config.recycleBytes,
        config,
        excluded,
      )
      if (!released) break
      state = await capacities(root, config, db)
      backend = enabled.find((name) => state[name]!.freeBytes >= body.length)
      if (backend) break
    }
  }
  if (!backend)
    throw storageError(
      '存储空间已满，且没有足够的可回收普通图片；表情包和头像已保留',
      507,
    )
  if (backend === 'local') {
    try {
      await writeFile(resolve(root, key), body, { flag: 'wx' })
    } catch (error) {
      if (
        ['ENOSPC', 'EDQUOT'].includes(
          (error as NodeJS.ErrnoException).code || '',
        ) &&
        config.s3.enabled &&
        state.s3!.freeBytes >= body.length
      )
        backend = 's3'
      else throw error
    }
    if (backend === 'local')
      return {
        storage_key: key,
        byte_size: body.length,
        storage_backend: 'local',
        storage_location: null,
      }
  }
  const s3 = config.s3
  const location = await query<{ id: string }>(
    "SELECT id FROM storage_locations WHERE config->>'endpoint'=$1 AND config->>'bucket'=$2 LIMIT 1",
    [s3.endpoint, s3.bucket],
  )
  const id =
    location.rows[0]?.id ||
    (
      await query<{ id: string }>(
        'INSERT INTO storage_locations(config) VALUES($1) RETURNING id',
        [s3],
      )
    ).rows[0]!.id
  const objectKey = `${s3.prefix}${key}`
  try {
    await withS3(s3, (client) =>
      client.send(
        new PutObjectCommand({
          Bucket: s3.bucket,
          Key: objectKey,
          Body: body,
          ContentType: mime,
        }),
      ),
    )
  } catch (error) {
    // Connectivity/permission errors must never trigger eviction of existing images.
    throw storageError('对象存储上传失败，请稍后重试或联系管理员', 502)
  }
  return {
    storage_key: key,
    byte_size: body.length,
    storage_backend: 's3',
    storage_location: { id, key: objectKey },
  }
}

export async function getObjectFile(file: StoredFile) {
  const config = await locationConfig(file.storage_location!)
  const client = s3Client(config)
  try {
    const result = await client.send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: file.storage_location!.key,
      }),
    )
    const stream = result.Body as import('node:stream').Readable
    stream.once('close', () => client.destroy())
    return stream
  } catch {
    client.destroy()
    throw storageError('对象存储暂时不可用', 502)
  }
}
