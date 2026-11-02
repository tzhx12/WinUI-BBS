import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliCompressSync, gzipSync, brotliDecompressSync, gunzipSync } from 'node:zlib'
import Fastify from 'fastify'
import { registerWebAssets } from '../src/webAssets.ts'

test('production assets negotiate compressed variants, cache hashes and revalidate HTML', async () => {
  const root = await mkdtemp(join(tmpdir(), 'forum-web-assets-'))
  const source = Buffer.from('console.log("production asset");\n'.repeat(200))
  await mkdir(join(root, 'assets'))
  for (const [suffix, data] of [
    ['', source],
    ['.br', brotliCompressSync(source)],
    ['.gz', gzipSync(source)],
  ])
    await writeFile(join(root, 'assets/entry-abcdefgh.js' + suffix), data)
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Forum</title>')
  await writeFile(join(root, 'assets/unhashed.js'), source)
  const app = Fastify()
  try {
    await registerWebAssets(app, root)
    for (const [encoding, decompress] of [
      ['br', brotliDecompressSync],
      ['gzip', gunzipSync],
      ['identity', (value) => value],
    ]) {
      const response = await app.inject({
        url: '/assets/entry-abcdefgh.js',
        headers: { 'accept-encoding': encoding },
      })
      assert.equal(response.statusCode, 200)
      assert.equal(response.headers['content-encoding'], encoding === 'identity' ? undefined : encoding)
      assert.match(response.headers['cache-control'], /max-age=31536000, immutable/)
      assert.match(response.headers.vary.toLowerCase(), /accept-encoding/)
      assert.match(response.headers['content-type'], /javascript/)
      assert.deepEqual(decompress(response.rawPayload), source)
    }
    const html = await app.inject({ url: '/' })
    assert.equal(html.headers['cache-control'], 'no-cache')
    const same = await app.inject({ url: '/', headers: { 'if-none-match': html.headers.etag } })
    assert.equal(same.statusCode, 304)
    assert.equal((await app.inject({ url: '/assets/unhashed.js' })).headers['cache-control'], 'no-cache')
  } finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})
