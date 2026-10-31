import assert from 'node:assert/strict'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { before, after, test } from 'node:test'
import { createManagementFixture } from './helpers/management-fixture.mjs'

let f
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWioAAAAASUVORK5CYII=',
  'base64',
)
const boundary = 'community-image-boundary'

function multipart(file = png, type = 'image/png') {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.png"\r\nContent-Type: ${type}\r\n\r\n`,
    ),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
}

function upload(url, user, file = png, type = 'image/png') {
  return f.app.inject({
    method: 'POST',
    url,
    headers: {
      authorization: `Bearer ${user.token}`,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: multipart(file, type),
  })
}

before(async () => {
  f = await createManagementFixture()
})

after(async () => {
  await f?.close()
})

test('community images stay outside the media library and require their admin permissions', async () => {
  const denied = f.managers.find((user) => user.permission === 'users.manage')
  const homeDenied = await f.request(
    'POST',
    '/api/admin/home-background',
    undefined,
    denied,
  )
  assert.equal(homeDenied.statusCode, 403)
  const publicHome = await f.request('GET', '/api/site')
  assert.equal(typeof publicHome.json().home_background_url, 'string')

  const categoryResponse = await f.request(
    'POST',
    '/api/admin/categories',
    {
      name: '自定义图片测试板块',
      slug: `community-image-${Date.now()}`,
    },
    f.owner,
  )
  assert.equal(categoryResponse.statusCode, 201, categoryResponse.body)
  const categoryId = categoryResponse.json().id
  const galleryCount = (
    await f.query('SELECT COUNT(*)::int AS count FROM media_assets')
  ).rows[0].count
  const home = await upload('/api/admin/home-background', f.owner)
  const icon = await upload(`/api/admin/categories/${categoryId}/icon`, f.owner)
  const header = await upload(
    `/api/admin/categories/${categoryId}/header-background`,
    f.owner,
  )
  for (const response of [home, icon, header])
    assert.equal(response.statusCode, 201, response.body)

  const homeUrl = home.json().url
  const iconUrl = icon.json().url
  const headerUrl = header.json().url
  assert.match(homeUrl, /^\/site-assets\/[0-9a-f-]{36}\.png$/)
  assert.match(iconUrl, /^\/site-assets\/[0-9a-f-]{36}\.png$/)
  assert.match(headerUrl, /^\/site-assets\/[0-9a-f-]{36}\.png$/)
  assert.equal(
    (await f.query('SELECT COUNT(*)::int AS count FROM media_assets')).rows[0]
      .count,
    galleryCount,
  )

  const publicCategory = (await f.request('GET', '/api/categories'))
    .json()
    .find((item) => item.id === categoryId)
  assert.equal(publicCategory.icon_image_url, iconUrl)
  assert.equal(publicCategory.header_background_url, headerUrl)
  assert.equal(
    (await f.request('GET', '/api/site')).json().home_background_url,
    homeUrl,
  )

  for (const url of [homeUrl, iconUrl, headerUrl]) {
    const response = await f.app.inject({ method: 'GET', url })
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['content-type'], 'image/png')
    assert.equal(response.headers['x-content-type-options'], 'nosniff')
    assert.deepEqual(response.rawPayload, png)
  }

  const homeReplacement = await upload('/api/admin/home-background', f.owner)
  assert.equal(homeReplacement.statusCode, 201, homeReplacement.body)
  assert.equal(
    (await f.app.inject({ method: 'GET', url: homeUrl })).statusCode,
    404,
  )
  assert.equal(
    (
      await stat(
        join(
          f.uploadRoot,
          '..',
          'site-assets',
          homeReplacement.json().url.slice('/site-assets/'.length),
        ),
      )
    ).isFile(),
    true,
  )

  const invalid = await upload(
    `/api/admin/categories/${categoryId}/icon`,
    f.owner,
    Buffer.from('not an image'),
  )
  assert.equal(invalid.statusCode, 415)
  assert.equal(
    (
      await f.request(
        'DELETE',
        `/api/admin/categories/${categoryId}/header-background`,
        undefined,
        f.owner,
      )
    ).statusCode,
    200,
  )
  assert.equal(
    (await f.app.inject({ method: 'GET', url: headerUrl })).statusCode,
    404,
  )
})

test('category and settings managers have separate image permissions; guests and ordinary users cannot manage images', async () => {
  const category = (
    await f.request('GET', '/api/admin/categories', undefined, f.owner)
  ).json()[0]
  const categoryManager = f.managers.find(
    (user) => user.permission === 'categories.manage',
  )
  const settingsManager = f.managers.find(
    (user) => user.permission === 'settings.manage',
  )
  const ordinary = (
    await f.request('POST', '/api/auth/register', {
      username: 'community_reader',
      displayName: '读者',
      email: 'community-reader@example.test',
      password: f.password,
    })
  ).json()
  for (const [url, allowed, denied] of [
    ['/api/admin/home-background', settingsManager, categoryManager],
    [
      `/api/admin/categories/${category.id}/icon`,
      categoryManager,
      settingsManager,
    ],
    [
      `/api/admin/categories/${category.id}/header-background`,
      categoryManager,
      settingsManager,
    ],
  ]) {
    for (const method of ['POST', 'DELETE']) {
      assert.equal((await f.request(method, url)).statusCode, 401)
      assert.equal(
        (await f.request(method, url, undefined, ordinary)).statusCode,
        403,
      )
      assert.equal(
        (await f.request(method, url, undefined, denied)).statusCode,
        403,
      )
    }
    assert.equal((await upload(url, allowed)).statusCode, 201)
    assert.equal(
      (await f.request('DELETE', url, undefined, allowed)).statusCode,
      200,
    )
  }
})

test('community image validation and an audit failure preserve the current image and clean new files', async () => {
  const url = '/api/admin/home-background'
  const first = await upload(url, f.owner)
  assert.equal(first.statusCode, 201)
  const before = (await readdir(join(f.uploadRoot, '..', 'site-assets'))).sort()
  assert.equal(
    (await upload(url, f.owner, Buffer.from('<svg/>'), 'image/svg+xml'))
      .statusCode,
    415,
  )
  assert.equal(
    (await upload(url, f.owner, Buffer.alloc(10 * 1024 * 1024 + 1))).statusCode,
    413,
  )
  await f.query(`CREATE FUNCTION reject_community_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action_key='community.image.upload' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$`)
  await f.query(
    'CREATE TRIGGER reject_community_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_community_audit()',
  )
  try {
    assert.equal((await upload(url, f.owner)).statusCode, 500)
  } finally {
    await f.query('DROP TRIGGER reject_community_audit ON audit_events')
    await f.query('DROP FUNCTION reject_community_audit()')
  }
  assert.equal(
    (await f.request('GET', '/api/site')).json().home_background_url,
    first.json().url,
  )
  assert.deepEqual(
    (await readdir(join(f.uploadRoot, '..', 'site-assets'))).sort(),
    before,
  )
  assert.equal(
    (await f.app.inject({ method: 'GET', url: first.json().url })).statusCode,
    200,
  )
})

test('concurrent replacements keep only the active image and deleting a category removes its images', async () => {
  const responses = await Promise.all([
    upload('/api/admin/home-background', f.owner),
    upload('/api/admin/home-background', f.owner),
  ])
  for (const response of responses)
    assert.equal(response.statusCode, 201, response.body)
  const active = (await f.request('GET', '/api/site')).json()
    .home_background_url
  for (const response of responses)
    assert.equal(
      (await f.app.inject({ method: 'GET', url: response.json().url }))
        .statusCode,
      response.json().url === active ? 200 : 404,
    )
  const category = (
    await f.request(
      'POST',
      '/api/admin/categories',
      { name: '可删除板块', slug: 'deletable-community' },
      f.owner,
    )
  ).json()
  const icon = await upload(
    `/api/admin/categories/${category.id}/icon`,
    f.owner,
  )
  const header = await upload(
    `/api/admin/categories/${category.id}/header-background`,
    f.owner,
  )
  assert.equal(
    (
      await f.request(
        'DELETE',
        `/api/admin/categories/${category.id}`,
        undefined,
        f.owner,
      )
    ).statusCode,
    200,
  )
  for (const response of [icon, header])
    assert.equal(
      (await f.app.inject({ method: 'GET', url: response.json().url }))
        .statusCode,
      404,
    )
  assert.equal(
    (await upload('/api/admin/categories/99999999/icon', f.owner)).statusCode,
    404,
  )
})
