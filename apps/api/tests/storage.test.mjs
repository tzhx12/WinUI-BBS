import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { randomBytes } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import Fastify from 'fastify'
import { createManagementFixture } from './helpers/management-fixture.mjs'

let f, s3, endpoint, config, pack
const objects = new Map(),
  requests = []
let failUploads = false
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWioAAAAASUVORK5CYII=',
  'base64',
)
const upload = (
  url = '/api/admin/media?collection=library',
  user = f.owner,
  body = png,
) =>
  f.app.inject({
    method: 'POST',
    url,
    headers: {
      authorization: `Bearer ${user.token}`,
      'content-type': 'multipart/form-data; boundary=storage-boundary',
    },
    payload: Buffer.concat([
      Buffer.from(
        '--storage-boundary\r\nContent-Disposition: form-data; name="file"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n',
      ),
      body,
      Buffer.from('\r\n--storage-boundary--\r\n'),
    ]),
  })
async function configure(changes = {}) {
  config = { ...config, ...changes, s3: { ...config.s3, ...changes.s3 } }
  const response = await f.request(
    'PATCH',
    '/api/admin/storage',
    config,
    f.owner,
  )
  assert.equal(response.statusCode, 200, response.body)
}
async function clear() {
  const { deleteStoredFile } = await import('../src/storage.ts')
  for (const file of (await f.query('SELECT * FROM media_assets')).rows)
    await deleteStoredFile(f.uploadRoot, file)
  await f.query('DELETE FROM media_assets')
  await f.query('DELETE FROM storage_alerts')
  await f.query('DELETE FROM notifications')
  failUploads = false
  await configure({
    localMaxBytes: 0,
    preference: 'local',
    recycleBytes: 100,
    s3: { enabled: false },
  })
}
before(async () => {
  process.env.STORAGE_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  f = await createManagementFixture()
  s3 = Fastify()
  s3.addContentTypeParser('*', { parseAs: 'buffer' }, (req, body, done) =>
    done(null, body),
  )
  s3.route({
    method: ['PUT', 'GET', 'DELETE'],
    url: '/*',
    handler: async (req, reply) => {
      const key = new URL(req.url, 'http://fixture').pathname
      requests.push({
        method: req.method,
        key: req.url,
        signed: req.headers.authorization?.startsWith('AWS4-HMAC-SHA256'),
      })
      if (req.method === 'PUT') {
        if (failUploads)
          return reply
            .code(403)
            .type('application/xml')
            .send(
              '<Error><Code>AccessDenied</Code><Message>denied</Message></Error>',
            )
        objects.set(key, Buffer.from(req.body))
        return reply.header('ETag', '"fixture"').send('')
      }
      if (req.method === 'DELETE') {
        objects.delete(key)
        return reply.code(204).send()
      }
      if (!objects.has(key)) return reply.code(404).send('')
      return reply.type('image/png').send(objects.get(key))
    },
  })
  await s3.listen({ host: '127.0.0.1', port: 0 })
  endpoint = `http://127.0.0.1:${s3.server.address().port}`
  config = (
    await f.request('GET', '/api/admin/storage', undefined, f.owner)
  ).json().settings
  await configure({
    s3: {
      endpoint,
      bucket: 'test',
      accessKeyId: 'fixture-access',
      secretAccessKey: 'fixture-secret',
      capacityBytes: 100000,
      region: 'auto',
      prefix: 'forum/',
      forcePathStyle: true,
    },
  })
  pack = (
    await f.request(
      'POST',
      '/api/admin/emoji-packs',
      { name: '受保护表情' },
      f.owner,
    )
  ).json()
})
after(async () => {
  await s3?.close()
  await f?.close()
})

test('storage permissions, encrypted credentials, keep existing media-settings contract and probe cleanup', async () => {
  const mediaManager = f.managers.find((m) => m.permission === 'media.manage')
  const other = f.managers.find((m) => m.permission === 'settings.manage')
  assert.equal(
    (await f.request('GET', '/api/admin/storage', undefined, other)).statusCode,
    403,
  )
  assert.equal(
    (await f.request('PATCH', '/api/admin/storage', config, other)).statusCode,
    403,
  )
  assert.equal(
    (await f.request('POST', '/api/admin/storage/test', config, other))
      .statusCode,
    403,
  )
  const read = await f.request(
    'GET',
    '/api/admin/storage',
    undefined,
    mediaManager,
  )
  assert.equal(read.statusCode, 200, read.body)
  assert.equal(read.json().settings.s3.accessKeyId, '')
  assert.equal(read.json().settings.s3.secretAccessKey, '')
  assert.equal(read.json().settings.s3.hasCredentials, true)
  assert.ok(read.json().status.disks.some((d) => d.uploadDisk))
  const saved = (
    await f.query(
      "SELECT setting_value FROM app_settings WHERE setting_key='media_storage'",
    )
  ).rows[0].setting_value
  assert.ok(!JSON.stringify(saved).includes('fixture-secret'))
  assert.ok(!JSON.stringify(saved).includes('fixture-access'))
  assert.ok(
    !(
      await f.query(
        "SELECT details FROM audit_events WHERE action_key='media.storage_settings'",
      )
    ).rows.some((r) => JSON.stringify(r).includes('fixture-secret')),
  )
  await configure({ s3: { accessKeyId: '', secretAccessKey: '' } })
  const probe = await f.request(
    'POST',
    '/api/admin/storage/test',
    config,
    mediaManager,
  )
  assert.equal(probe.statusCode, 200, probe.body)
  assert.equal(objects.size, 0)
  assert.ok(requests.every((r) => r.signed))
  const old = (
    await f.request('GET', '/api/admin/media-settings', undefined, f.owner)
  ).json()
  assert.equal(
    (
      await f.request(
        'PATCH',
        '/api/admin/media-settings',
        { mediaLimits: old.media_limits, remoteEmoji: old.remote_emoji },
        f.owner,
      )
    ).statusCode,
    200,
  )
  const invalid = await f.request(
    'PATCH',
    '/api/admin/storage',
    { ...config, preference: 's3', s3: { ...config.s3, enabled: false } },
    f.owner,
  )
  assert.equal(invalid.statusCode, 400)
})

test('local limit switches to private S3, stable URL serves bytes, delete removes the right object', async () => {
  await clear()
  await configure({
    localMaxBytes: png.length,
    s3: { enabled: true, capacityBytes: 1000 },
  })
  const first = await upload(),
    second = await upload()
  assert.equal(first.statusCode, 201, first.body)
  assert.equal(second.statusCode, 201, second.body)
  assert.equal(first.json().storage_backend, 'local')
  assert.equal(second.json().storage_backend, 's3')
  assert.deepEqual(
    await readFile(join(f.uploadRoot, first.json().storage_key)),
    png,
  )
  const read = await f.app.inject({ method: 'GET', url: second.json().url })
  assert.equal(read.statusCode, 200, read.body)
  assert.deepEqual(read.rawPayload, png)
  const head = await f.app.inject({ method: 'HEAD', url: second.json().url })
  assert.equal(head.statusCode, 200)
  assert.equal(head.headers['content-length'], String(png.length))
  const status = (
    await f.request('GET', '/api/admin/storage', undefined, f.owner)
  ).json().status
  assert.equal(status.local.usedBytes, png.length)
  assert.equal(status.s3.usedBytes, png.length)
  assert.equal(status.totalFreeBytes, 1000 - png.length)
  assert.equal(
    (
      await f.request(
        'DELETE',
        `/api/admin/media/${second.json().id}`,
        undefined,
        f.owner,
      )
    ).statusCode,
    200,
  )
  assert.equal(objects.size, 0)
})

test('S3 preference falls back to local; disabled or changed config preserves existing object reads', async () => {
  await clear()
  await configure({
    localMaxBytes: 1000,
    preference: 's3',
    s3: { enabled: true, capacityBytes: png.length },
  })
  const first = await upload(),
    second = await upload()
  assert.equal(first.json().storage_backend, 's3')
  assert.equal(second.json().storage_backend, 'local')
  await configure({
    preference: 'local',
    s3: { enabled: false, bucket: 'different' },
  })
  assert.equal(
    (await f.app.inject({ method: 'GET', url: first.json().url })).statusCode,
    200,
  )
  await configure({ s3: { bucket: 'test' } })
})

test('95% alerts reach only active media managers, deduplicate and rearm after recovery', async () => {
  await clear()
  await configure({ localMaxBytes: png.length })
  const first = await upload()
  assert.equal(first.statusCode, 201, first.body)
  const { monitorStorage } = await import('../src/storage.ts')
  await monitorStorage(f.uploadRoot)
  let notices = await f.query(
    "SELECT * FROM notifications WHERE kind='storage'",
  )
  assert.equal(notices.rowCount, 1)
  const recipients = (
    await f.query(
      'SELECT user_uid FROM notification_recipients WHERE notification_id=$1',
      [notices.rows[0].id],
    )
  ).rows
    .map((r) => r.user_uid)
    .sort()
  assert.deepEqual(
    recipients,
    [
      f.owner.user.uid,
      f.managers.find((m) => m.permission === 'media.manage').user.uid,
    ].sort(),
  )
  await configure({ localMaxBytes: 1000 })
  await configure({ localMaxBytes: png.length })
  assert.equal(
    (await f.query("SELECT * FROM notifications WHERE kind='storage'"))
      .rowCount,
    2,
  )
  await clear()
  await configure({
    localMaxBytes: png.length,
    s3: { enabled: true, capacityBytes: png.length },
  })
  await upload()
  assert.equal(
    (await f.query("SELECT * FROM notifications WHERE kind='storage'"))
      .rowCount,
    0,
  )
  await upload()
  notices = await f.query("SELECT * FROM notifications WHERE kind='storage'")
  assert.equal(notices.rowCount, 1)
  assert.ok(notices.rows[0].title.includes('对象'))
})

test('all full: oldest-first batch, protected emoji/avatar/icon survive, references replaced and audited', async () => {
  await clear()
  const emoji = await upload(
    `/api/admin/media?collection=emoji&packId=${pack.id}`,
  )
  const avatar = await upload('/api/me/avatar')
  const oldAvatar = (
    await f.query("SELECT * FROM media_assets WHERE collection='avatar'")
  ).rows[0]
  const nextAvatar = await upload('/api/me/avatar')
  const icon = await upload('/api/admin/site-icon')
  const first = await upload(),
    second = await upload(),
    third = await upload()
  for (const result of [emoji, avatar, nextAvatar, icon, first, second, third])
    assert.equal(result.statusCode, 201, result.body)
  await f.query(
    "UPDATE media_assets SET created_at=created_at-INTERVAL '1 day' WHERE id=$1",
    [first.json().id],
  )
  const category = (await f.request('GET', '/api/categories')).json()[0]
  const post = await f.request(
    'POST',
    '/api/posts',
    {
      title: '回收引用替换测试',
      categoryId: category.id,
      body: {
        blocks: [{ type: 'image', data: { file: { url: first.json().url } } }],
      },
    },
    f.owner,
  )
  assert.equal(post.statusCode, 201, post.body)
  const usage = (
    await f.query('SELECT SUM(byte_size)::int AS bytes FROM media_assets')
  ).rows[0].bytes
  await configure({ localMaxBytes: usage, recycleBytes: png.length * 2 })
  const result = await upload()
  assert.equal(result.statusCode, 201, result.body)
  const remaining = (await f.query('SELECT id FROM media_assets')).rows.map(
    (r) => r.id,
  )
  assert.ok(!remaining.includes(first.json().id))
  assert.ok(!remaining.includes(second.json().id))
  assert.ok(remaining.includes(third.json().id))
  assert.ok(remaining.includes(oldAvatar.id))
  assert.ok(remaining.includes(emoji.json().id))
  assert.ok(remaining.includes(icon.json().id))
  assert.equal(
    (await f.query('SELECT body FROM posts WHERE id=$1', [post.json().post.id]))
      .rows[0].body.blocks[0].data.file.url,
    '/deleted-image.png',
  )
  assert.equal(
    (
      await f.query(
        "SELECT * FROM audit_events WHERE action_key='media.auto_recycle'",
      )
    ).rowCount,
    2,
  )
  assert.equal((await f.query('SELECT * FROM storage_deletions')).rowCount, 0)
})

test('protected-only full storage rejects uploads; S3 errors do not evict images', async () => {
  await clear()
  const avatar = await upload('/api/me/avatar')
  assert.equal(avatar.statusCode, 201)
  await configure({ localMaxBytes: png.length })
  const failed = await upload()
  assert.equal(failed.statusCode, 507, failed.body)
  assert.equal((await f.query('SELECT * FROM media_assets')).rowCount, 1)
  await configure({
    localMaxBytes: 1000,
    preference: 's3',
    s3: { enabled: true, capacityBytes: 1000 },
  })
  failUploads = true
  const outage = await upload()
  assert.equal(outage.statusCode, 502, outage.body)
  assert.equal((await f.query('SELECT * FROM media_assets')).rowCount, 1)
  failUploads = false
})

test('concurrent uploads respect shared local quota and use S3 without over-allocation', async () => {
  await clear()
  await configure({
    localMaxBytes: png.length,
    s3: { enabled: true, capacityBytes: 10000 },
  })
  const results = await Promise.all(Array.from({ length: 16 }, () => upload()))
  for (const result of results)
    assert.equal(result.statusCode, 201, result.body)
  assert.equal(
    results.filter((r) => r.json().storage_backend === 'local').length,
    1,
  )
  assert.equal(
    results.filter((r) => r.json().storage_backend === 's3').length,
    15,
  )
  assert.equal((await readdir(f.uploadRoot)).length, 1)
})

test('S3 recycling follows global age and removes only reclaimed objects', async () => {
  await clear()
  await configure({
    localMaxBytes: png.length,
    s3: { enabled: true, capacityBytes: png.length * 2 },
    recycleBytes: png.length,
  })
  const local = await upload(),
    older = await upload(),
    newer = await upload()
  await f.query(
    "UPDATE media_assets SET created_at=NOW()-INTERVAL '5 days' WHERE id=$1",
    [older.json().id],
  )
  const before = objects.size
  const result = await upload()
  assert.equal(result.statusCode, 201, result.body)
  assert.equal(result.json().storage_backend, 's3')
  assert.equal(
    (
      await f.query('SELECT id FROM media_assets WHERE id=$1', [
        older.json().id,
      ])
    ).rowCount,
    0,
  )
  assert.equal(
    (
      await f.query('SELECT id FROM media_assets WHERE id=ANY($1::uuid[])', [
        [local.json().id, newer.json().id],
      ])
    ).rowCount,
    2,
  )
  assert.equal(objects.size, before)
  assert.ok(
    ![...objects.keys()].some((key) => key.endsWith(older.json().storage_key)),
  )
})

test('post/reply attachments use S3, pending batch bytes count, failed publication removes files', async () => {
  await clear()
  await configure({
    localMaxBytes: 1,
    s3: { enabled: true, capacityBytes: png.length * 3 },
  })
  const category = (await f.request('GET', '/api/categories')).json()[0]
  const multipart = (payload, count) =>
    Buffer.concat([
      Buffer.from(
        `--submit\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${JSON.stringify(payload)}\r\n`,
      ),
      ...Array.from({ length: count }, (_, i) =>
        Buffer.concat([
          Buffer.from(
            `--submit\r\nContent-Disposition: form-data; name="draft:image-${i}"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n`,
          ),
          png,
          Buffer.from('\r\n'),
        ]),
      ),
      Buffer.from('--submit--\r\n'),
    ])
  const body = {
    blocks: [0, 1].map((i) => ({
      type: 'image',
      data: { file: { url: `draft:image-${i}` } },
    })),
  }
  const post = await f.app.inject({
    method: 'POST',
    url: '/api/posts',
    headers: {
      authorization: `Bearer ${f.owner.token}`,
      'content-type': 'multipart/form-data; boundary=submit',
    },
    payload: multipart(
      { categoryId: category.id, title: 'S3 附件测试', body },
      2,
    ),
  })
  assert.equal(post.statusCode, 201, post.body)
  assert.equal(objects.size, 2)
  const replyBody = {
    blocks: [{ type: 'image', data: { file: { url: 'draft:image-0' } } }],
  }
  const reply = await f.app.inject({
    method: 'POST',
    url: `/api/posts/${post.json().post.id}/replies`,
    headers: {
      authorization: `Bearer ${f.owner.token}`,
      'content-type': 'multipart/form-data; boundary=submit',
    },
    payload: multipart({ body: replyBody }, 1),
  })
  assert.equal(reply.statusCode, 201, reply.body)
  assert.equal(objects.size, 3)
  await configure({ s3: { capacityBytes: 1000 } })
  const failed = await f.app.inject({
    method: 'POST',
    url: `/api/posts/00000000-0000-4000-8000-000000000001/replies`,
    headers: {
      authorization: `Bearer ${f.owner.token}`,
      'content-type': 'multipart/form-data; boundary=submit',
    },
    payload: multipart({ body: replyBody }, 1),
  })
  assert.equal(failed.statusCode, 404, failed.body)
  assert.equal(objects.size, 3)
})
