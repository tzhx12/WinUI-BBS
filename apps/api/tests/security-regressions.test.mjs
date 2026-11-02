import assert from 'node:assert/strict'
import { after, before, mock, test } from 'node:test'
import { randomBytes } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import passwords from '../src/passwords.ts'
import { createManagementFixture } from './helpers/management-fixture.mjs'

let f, category
before(async () => {
  process.env.MAIL_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  f = await createManagementFixture()
  category = (await f.request('GET', '/api/categories')).json()[0]
})
after(async () => { if (f) await f.close() })

const html = Buffer.from('<!doctype html><script>alert(document.domain)</script>')
function forgedUpload(url, payload) {
  const parts = []
  if (payload) parts.push(Buffer.from('--security-test\r\nContent-Disposition: form-data; name="payload"\r\n\r\n' + JSON.stringify(payload) + '\r\n'))
  parts.push(Buffer.from('--security-test\r\nContent-Disposition: form-data; name="' + (payload ? 'draft:test' : 'file') + '"; filename="fake.png"\r\nContent-Type: image/png\r\n\r\n'), html, Buffer.from('\r\n--security-test--\r\n'))
  return f.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${f.owner.token}`, 'content-type': 'multipart/form-data; boundary=security-test' }, payload: Buffer.concat(parts) })
}

test('forged MIME types cannot store HTML as an avatar, gallery image or published attachment', async () => {
  const before = (await f.query('SELECT COUNT(*)::int AS n FROM media_assets')).rows[0].n
  for (const url of ['/api/me/avatar', '/api/admin/media', '/api/admin/site-icon']) {
    const response = await forgedUpload(url)
    assert.equal(response.statusCode, 415, response.body)
  }
  const response = await forgedUpload('/api/posts', { categoryId: category.id, title: '伪装图片不应发布', body: { blocks: [{ type: 'image', data: { file: { url: 'draft:test' } } }] } })
  assert.equal(response.statusCode, 415, response.body)
  assert.equal((await f.query('SELECT COUNT(*)::int AS n FROM media_assets')).rows[0].n, before)
  assert.deepEqual(await readdir(f.uploadRoot), [])
})

test('invalid reset tokens do not consume password workers', async () => {
  const hashing = mock.method(passwords, 'hash', async () => { throw new Error('invalid token reached password hashing') })
  try {
    const response = await f.request('POST', '/api/auth/reset-password', { token: 'x'.repeat(43), password: 'new-password-security-123' })
    assert.equal(response.statusCode, 400, response.body)
    assert.equal(hashing.mock.callCount(), 0)
  } finally { hashing.mock.restore() }
})
