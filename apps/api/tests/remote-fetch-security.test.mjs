import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { fetchRemoteResource, isPublicAddress, readRemoteJson } from '../src/remoteFetch.ts'

test('remote fetch rejects private, reserved, mapped, alternative and DNS loopback targets', async () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254',
    '0.0.0.0', '100.64.0.1', '224.0.0.1', '::', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1'])
    assert.equal(isPublicAddress(address), false, address)
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])
    assert.equal(isPublicAddress(address), true, address)
  for (const url of ['http://127.0.0.1/', 'http://2130706433/', 'http://0x7f000001/',
    'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://localhost/', 'http://169.254.169.254/',
    'http://name:secret@example.test/', 'file:///etc/passwd'])
    await assert.rejects(fetchRemoteResource(url, 'https://configured.example.test', {}), undefined, url)
})

test('an explicitly configured API may be private, but cross-origin redirects cannot access private targets', async () => {
  let hits = 0
  const target = createServer((_req, res) => { hits++; res.end('private data') })
  await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve))
  const server = createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: `http://127.0.0.1:${target.address().port}/` })
      res.end()
    } else if (req.url === '/large') res.end('x'.repeat(4 * 1024 ** 2 + 1))
    else if (req.url === '/loop') { res.writeHead(302, { location: '/loop' }); res.end() }
    else { res.setHeader('content-type', 'application/json'); res.end('{"ok":true}') }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  try {
    assert.deepEqual(await readRemoteJson(await fetchRemoteResource(origin, origin, {})), { ok: true })
    await assert.rejects(fetchRemoteResource(origin + '/redirect', origin, {}), /私有或保留/)
    assert.equal(hits, 0)
    await assert.rejects(fetchRemoteResource(origin + '/loop', origin, {}), /重定向/)
    await assert.rejects(readRemoteJson(await fetchRemoteResource(origin + '/large', origin, {})), /4 MiB/)
  } finally {
    server.closeAllConnections(); target.closeAllConnections()
    await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => target.close(resolve))])
  }
})
