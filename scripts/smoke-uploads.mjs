import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

// Run only against the disposable installation used by smoke-installed.mjs.
export async function verifyImageUploads(origin, token) {
  const headers = { authorization: `Bearer ${token}` }
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWioAAAAASUVORK5CYII=',
    'base64',
  )
  const results = []
  async function api(path, options = {}) {
    const response = await fetch(origin + path, {
      ...options,
      headers: {
        ...headers,
        ...(options.body && !(options.body instanceof FormData)
          ? { 'content-type': 'application/json' }
          : {}),
      },
    })
    assert.ok(
      response.ok,
      `HTTP ${response.status}: ${path}: ${await response.clone().text()}`,
    )
    return response.json()
  }
  async function checkImage(url, path) {
    const response = await fetch(origin + url)
    assert.equal(response.status, 200, path)
    assert.equal(response.headers.get('content-type'), 'image/png', path)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), image, path)
    results.push(path)
  }
  function form(payload) {
    const body = new FormData()
    if (payload) body.append('payload', JSON.stringify(payload))
    body.append(
      payload ? 'draft:install' : 'file',
      new Blob([image], { type: 'image/png' }),
      'image.png',
    )
    return body
  }
  async function upload(path) {
    const asset = await api(path, { method: 'POST', body: form() })
    await checkImage(asset.avatarUrl ?? asset.url, path)
    return asset
  }
  const avatar = await upload('/api/me/avatar')
  assert.equal((await api('/api/auth/me')).avatarUrl, avatar.avatarUrl)

  const limits = await api('/api/admin/content-settings')
  await api('/api/admin/content-settings', {
    method: 'PATCH',
    body: JSON.stringify({ ...limits, directLibraryUploads: true }),
  })
  try {
    for (const path of ['/api/media', '/api/me/media', '/api/admin/media'])
      await upload(path)
  } finally {
    await api('/api/admin/content-settings', {
      method: 'PATCH',
      body: JSON.stringify(limits),
    })
  }
  for (const prefix of ['/api/me', '/api/admin']) {
    const pack = await api(`${prefix}/emoji-packs`, {
      method: 'POST',
      body: JSON.stringify({ name: `Install ${randomUUID()}` }),
    })
    await upload(`${prefix}/media?collection=emoji&packId=${pack.id}`)
  }
  await upload('/api/admin/site-icon')
  const category = (await api('/api/categories'))[0]
  for (const path of [
    '/api/admin/home-background',
    '/api/admin/popular-background',
    `/api/admin/categories/${category.id}/icon`,
    `/api/admin/categories/${category.id}/header-background`,
  ])
    await upload(path)

  const imageBody = {
    blocks: [
      { type: 'image', data: { file: { url: 'draft:install' }, caption: '' } },
    ],
  }
  const post = await api('/api/posts', {
    method: 'POST',
    body: form({
      categoryId: category.id,
      title: 'Installation image test',
      body: imageBody,
    }),
  })
  const detail = await api(`/api/posts/${post.post.id}`)
  await checkImage(
    detail.post.body.blocks[0].data.file.url,
    '/api/posts attachment',
  )
  const reply = await api(`/api/posts/${post.post.id}/replies`, {
    method: 'POST',
    body: form({ body: imageBody }),
  })
  const replies = (await api(`/api/posts/${post.post.id}`)).replies
  await checkImage(
    replies.find((item) => item.id === reply.reply.id).body.blocks[0].data.file
      .url,
    '/api/posts/:id/replies attachment',
  )
  console.log('systemd image uploads passed: ' + JSON.stringify(results))
  return results
}
