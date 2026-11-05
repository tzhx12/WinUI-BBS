import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createManagementFixture } from './helpers/management-fixture.mjs'

let f, member, category
const body = {
  blocks: [{ type: 'paragraph', data: { text: '版权声明应独立于正文保存。' } }],
}
const payload = (extra = {}) => ({
  title: '帖子版权声明验收',
  categoryId: category.id,
  body,
  ...extra,
})

before(async () => {
  f = await createManagementFixture()
  const registration = await f.request('POST', '/api/auth/register', {
    username: 'copyright_author',
    displayName: '版权声明作者',
    email: 'copyright-author@example.test',
    password: f.password,
  })
  assert.equal(registration.statusCode, 201, registration.body)
  member = registration.json()
  category = (await f.request('GET', '/api/categories')).json()[0]
})
after(async () => {
  if (f) await f.close()
})

test('legacy posts and callers without a copyright selection keep the none default', async () => {
  const legacy = await f.query('SELECT copyright_license FROM posts')
  assert.ok(legacy.rowCount > 0)
  assert.ok(legacy.rows.every((post) => post.copyright_license === 'none'))
  const created = await f.request('POST', '/api/posts', payload(), member)
  assert.equal(created.statusCode, 201, created.body)
  const detail = await f.request('GET', `/api/posts/${created.json().post.id}`)
  assert.equal(detail.statusCode, 200, detail.body)
  assert.equal(detail.json().post.copyright_license, 'none')
  assert.deepEqual(detail.json().post.body, body)
})

test('every copyright selection survives publishing and public detail reads without changing the body', async () => {
  for (const copyrightLicense of [
    'none',
    'cc0',
    'cc-by-4.0',
    'cc-by-sa-4.0',
    'cc-by-nc-4.0',
    'cc-by-nc-sa-4.0',
    'cc-by-nd-4.0',
    'cc-by-nc-nd-4.0',
    'all-rights-reserved',
  ]) {
    const created = await f.request('POST', '/api/posts', payload({ copyrightLicense }), member)
    assert.equal(created.statusCode, 201, created.body)
    const id = created.json().post.id
    const stored = (await f.query('SELECT copyright_license, body FROM posts WHERE id=$1', [id])).rows[0]
    assert.equal(stored.copyright_license, copyrightLicense)
    assert.deepEqual(stored.body, body)
    for (const user of [undefined, member]) {
      const detail = await f.request('GET', `/api/posts/${id}`, undefined, user)
      assert.equal(detail.statusCode, 200, detail.body)
      assert.equal(detail.json().post.copyright_license, copyrightLicense)
    }
  }
})

test('invalid selections are rejected before a post is created; the database also enforces the selection', async () => {
  const count = (await f.query('SELECT COUNT(*)::int AS count FROM posts')).rows[0].count
  for (const copyrightLicense of ['', 'cc-by-3.0', 'unknown', null, 1, {}]) {
    const response = await f.request('POST', '/api/posts', payload({ copyrightLicense }), member)
    assert.equal(response.statusCode, 400, response.body)
    assert.equal(response.json().error, '版权声明无效')
  }
  assert.equal((await f.query('SELECT COUNT(*)::int AS count FROM posts')).rows[0].count, count)
  await assert.rejects(
    f.query(
      "UPDATE posts SET copyright_license='unknown' WHERE id=(SELECT id FROM posts ORDER BY id LIMIT 1)",
    ),
    { code: '23514', constraint: 'posts_copyright_license_check' },
  )
})

test('copyright is saved with multipart image submissions', async () => {
  const boundary = 'forum-copyright-boundary'
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWioAAAAASUVORK5CYII=',
    'base64',
  )
  const imageBody = {
    blocks: [
      {
        type: 'image',
        data: { file: { url: 'draft:copyright' }, caption: '' },
      },
    ],
  }
  const created = await f.app.inject({
    method: 'POST',
    url: '/api/posts',
    headers: {
      authorization: `Bearer ${member.token}`,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${JSON.stringify(payload({ copyrightLicense: 'cc0', body: imageBody }))}\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="draft:copyright"; filename="copyright.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  })
  assert.equal(created.statusCode, 201, created.body)
  const detail = (await f.request('GET', `/api/posts/${created.json().post.id}`)).json().post
  assert.equal(detail.copyright_license, 'cc0')
  assert.match(detail.body.blocks[0].data.file.url, /^\/uploads\//)
})

test('review, author trash and restoration preserve the selected copyright and existing visibility', async () => {
  await f.query(
    "UPDATE app_settings SET setting_value='true'::jsonb WHERE setting_key='posts_require_review'",
  )
  const created = await f.request(
    'POST',
    '/api/posts',
    payload({ copyrightLicense: 'cc-by-nc-sa-4.0' }),
    member,
  )
  assert.equal(created.statusCode, 201, created.body)
  const { id, status } = created.json().post
  assert.equal(status, 'pending')
  assert.equal((await f.request('GET', `/api/posts/${id}`)).statusCode, 404)
  const authorDetail = await f.request('GET', `/api/posts/${id}`, undefined, member)
  assert.equal(authorDetail.statusCode, 200, authorDetail.body)
  assert.equal(authorDetail.json().post.copyright_license, 'cc-by-nc-sa-4.0')
  const review = await f.request('GET', `/api/admin/reviews/${id}`, undefined, f.owner)
  assert.equal(review.statusCode, 200, review.body)
  assert.equal(review.json().copyright_license, 'cc-by-nc-sa-4.0')
  const approval = await f.request(
    'POST',
    `/api/admin/reviews/${id}/decision`,
    { action: 'approve' },
    f.owner,
  )
  assert.equal(approval.statusCode, 200, approval.body)
  assert.equal((await f.request('DELETE', `/api/me/posts/${id}`, undefined, member)).statusCode, 200)
  const trash = await f.request('GET', `/api/me/trash/${id}`, undefined, member)
  assert.equal(trash.statusCode, 200, trash.body)
  assert.equal(trash.json().post.copyright_license, 'cc-by-nc-sa-4.0')
  assert.equal((await f.request('GET', `/api/me/trash/${id}`)).statusCode, 401)
  assert.equal((await f.request('GET', `/api/posts/${id}`)).statusCode, 404)
  assert.equal((await f.request('POST', `/api/me/trash/${id}/restore`, undefined, member)).statusCode, 200)
  const restored = await f.request('GET', `/api/posts/${id}`)
  assert.equal(restored.statusCode, 200, restored.body)
  assert.equal(restored.json().post.copyright_license, 'cc-by-nc-sa-4.0')
})
