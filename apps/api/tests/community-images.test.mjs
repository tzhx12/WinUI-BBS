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
    ['/api/admin/popular-background', settingsManager, categoryManager],
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

test('background range defaults preserve half-screen categories and popular images are independent of home', async () => {
  const category = (await f.request('GET', '/api/categories')).json()[0]
  const before = (await f.request('GET', '/api/site')).json()
  assert.equal(category.header_background_height, 50)
  assert.equal(before.popular_background_height, 50)
  assert.equal(before.popular_background_url, '')
  const first = await upload('/api/admin/popular-background', f.owner)
  assert.equal(first.statusCode, 201, first.body)
  const updated = (await f.request('GET', '/api/site')).json()
  assert.equal(updated.popular_background_url, first.json().url)
  assert.equal(updated.home_background_url, before.home_background_url)
  assert.deepEqual(updated.home_content, before.home_content)
  const admin = (
    await f.request('GET', '/api/admin/home-settings', undefined, f.owner)
  ).json()
  assert.equal(admin.popular_background_url, first.json().url)
  assert.equal(admin.popular_background_height, 50)
  const replacement = await upload('/api/admin/popular-background', f.owner)
  assert.equal(replacement.statusCode, 201, replacement.body)
  assert.equal(
    (await f.app.inject({ method: 'GET', url: first.json().url })).statusCode,
    404,
  )
  assert.equal(
    (
      await f.request(
        'DELETE',
        '/api/admin/popular-background',
        undefined,
        f.owner,
      )
    ).statusCode,
    200,
  )
  assert.equal(
    (await f.app.inject({ method: 'GET', url: replacement.json().url }))
      .statusCode,
    404,
  )
  assert.equal(
    (await f.request('GET', '/api/site')).json().home_background_url,
    before.home_background_url,
  )
})

test('background range endpoints enforce permissions, exact supported values and persist independently', async () => {
  const category = (await f.request('GET', '/api/categories')).json()[0]
  const homeBefore = (await f.request('GET', '/api/site')).json()
  for (const [url, permission] of [
    [
      `/api/admin/categories/${category.id}/header-background`,
      'categories.manage',
    ],
    ['/api/admin/popular-background', 'settings.manage'],
  ]) {
    assert.equal(
      (await f.request('PATCH', url, { height: 75 })).statusCode,
      401,
    )
    for (const user of f.managers) {
      assert.equal(
        (await f.request('PATCH', url, { height: 75 }, user)).statusCode,
        user.permission === permission ? 200 : 403,
      )
    }
    for (const body of [
      {},
      { height: 0 },
      { height: 100 },
      { height: 50.1 },
      { height: '75' },
      { height: 75, url: 'invalid' },
    ])
      assert.equal(
        (await f.request('PATCH', url, body, f.owner)).statusCode,
        400,
      )
    assert.equal(
      (await f.request('PATCH', url, { height: 50 }, f.owner)).statusCode,
      200,
    )
    assert.equal(
      (await f.request('PATCH', url, { height: 75 }, f.owner)).statusCode,
      200,
    )
  }
  const current = (await f.request('GET', '/api/categories'))
    .json()
    .find((c) => c.id === category.id)
  assert.equal(current.header_background_height, 75)
  assert.equal(current.header_background_url, category.header_background_url)
  const site = (await f.request('GET', '/api/site')).json()
  assert.equal(site.popular_background_height, 75)
  assert.equal(site.home_background_url, homeBefore.home_background_url)
  assert.deepEqual(site.home_content, homeBefore.home_content)
  assert.equal(
    (
      await f.request(
        'PATCH',
        '/api/admin/categories/99999999/header-background',
        { height: 75 },
        f.owner,
      )
    ).statusCode,
    404,
  )
  assert.equal(
    (
      await f.request(
        'PATCH',
        '/api/admin/categories/invalid/header-background',
        { height: 75 },
        f.owner,
      )
    ).statusCode,
    404,
  )
  const audit = (await f.request('GET', '/api/admin/audit', undefined, f.owner))
    .json()
    .find((e) => e.action_key === 'community.background.update')
  assert.equal(audit.summary.action, '更新背景显示范围')
  assert.ok(audit.summary.lines.includes('背景显示范围：固定 3/4 屏渐变'))
})

test('popular image validation and transaction failures preserve the saved image and range', async () => {
  const url = '/api/admin/popular-background'
  const first = await upload(url, f.owner)
  assert.equal(first.statusCode, 201)
  const before = (await readdir(join(f.uploadRoot, '..', 'site-assets'))).sort()
  assert.equal(
    (await upload(url, f.owner, Buffer.from('invalid'))).statusCode,
    415,
  )
  assert.equal(
    (await upload(url, f.owner, Buffer.alloc(10 * 1024 * 1024 + 1))).statusCode,
    413,
  )
  await f.query(`CREATE FUNCTION reject_background_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action_key IN ('community.image.upload','community.background.update') THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$`)
  await f.query(
    'CREATE TRIGGER reject_background_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_background_audit()',
  )
  try {
    assert.equal((await upload(url, f.owner)).statusCode, 500)
    assert.equal(
      (await f.request('PATCH', url, { height: 50 }, f.owner)).statusCode,
      500,
    )
    const category = (await f.request('GET', '/api/categories')).json()[0]
    assert.equal(
      (
        await f.request(
          'PATCH',
          `/api/admin/categories/${category.id}/header-background`,
          { height: 50 },
          f.owner,
        )
      ).statusCode,
      500,
    )
    assert.equal(
      (await f.request('GET', '/api/categories')).json()[0]
        .header_background_height,
      75,
    )
  } finally {
    await f.query('DROP TRIGGER reject_background_audit ON audit_events')
    await f.query('DROP FUNCTION reject_background_audit()')
  }
  const site = (await f.request('GET', '/api/site')).json()
  assert.equal(site.popular_background_url, first.json().url)
  assert.equal(site.popular_background_height, 75)
  assert.deepEqual(
    (await readdir(join(f.uploadRoot, '..', 'site-assets'))).sort(),
    before,
  )
})

test('deleting a category preserves an image still referenced by popular discussions', async () => {
  const category = (
    await f.request(
      'POST',
      '/api/admin/categories',
      { name: '共享背景板块', slug: 'shared-background' },
      f.owner,
    )
  ).json()
  const uploaded = await upload(
    `/api/admin/categories/${category.id}/header-background`,
    f.owner,
  )
  assert.equal(uploaded.statusCode, 201)
  const url = uploaded.json().url
  // Deliberately share an existing asset to exercise cross-target reference protection.
  await f.query(
    "UPDATE app_settings SET setting_value=$1::jsonb WHERE setting_key='popular_background_url'",
    [JSON.stringify(url)],
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
  assert.equal((await f.app.inject({ method: 'GET', url })).statusCode, 200)
  assert.equal(
    (
      await f.request(
        'DELETE',
        '/api/admin/popular-background',
        undefined,
        f.owner,
      )
    ).statusCode,
    200,
  )
  assert.equal((await f.app.inject({ method: 'GET', url })).statusCode, 404)
})
