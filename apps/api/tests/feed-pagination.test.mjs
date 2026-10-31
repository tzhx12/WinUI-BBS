import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createManagementFixture } from './helpers/management-fixture.mjs'

let f, category, restricted, defaults, reader, ids
async function settings(changes) {
  const response = await f.request(
    'PATCH',
    '/api/admin/content-settings',
    { ...defaults, ...changes },
    f.owner,
  )
  assert.equal(response.statusCode, 200, response.body)
}
async function feed(params = '', user) {
  const response = await f.request('GET', '/api/posts?page=1' + params, undefined, user)
  assert.equal(response.statusCode, 200, response.body)
  return response.json()
}
before(async () => {
  f = await createManagementFixture()
  category = (await f.request('GET', '/api/categories')).json()[0]
  defaults = (await f.request('GET', '/api/admin/content-settings', undefined, f.owner)).json()
  const registered = await f.request('POST', '/api/auth/register', {
    username: 'feed_reader',
    displayName: '分页读者',
    email: 'feed@example.test',
    password: f.password,
  })
  assert.equal(registered.statusCode, 201, registered.body)
  reader = registered.json()
  const board = await f.request(
    'POST',
    '/api/admin/categories',
    { name: '等级限制板块', slug: 'private-feed', minimumReaderLevel: 9 },
    f.owner,
  )
  assert.equal(board.statusCode, 201, board.body)
  restricted = board.json()
  const result = await f.query(
    "INSERT INTO posts(category_id,author_uid,title,body,created_at) SELECT $1,$2,'分页讨论 ' || n,$3::jsonb,'2026-01-01'::timestamptz + n * INTERVAL '1 minute' FROM generate_series(1,73) n RETURNING id",
    [
      category.id,
      f.owner.user.uid,
      JSON.stringify({
        blocks: [
          {
            type: 'paragraph',
            data: { text: '公开内容 <span data-content-lock="reply">分页秘密</span>' },
          },
        ],
      }),
    ],
  )
  ids = result.rows.map((row) => row.id)
  for (const status of ['hidden', 'pending', 'rejected'])
    await f.query(
      "INSERT INTO posts(category_id,author_uid,title,body,status) VALUES($1,$2,'不可见帖子',$3::jsonb,$4)",
      [category.id, f.owner.user.uid, JSON.stringify({ blocks: [] }), status],
    )
  await f.query(
    "INSERT INTO posts(category_id,author_uid,title,body,minimum_reader_level) VALUES($1,$2,'高等级帖子','{\"blocks\":[]}'::jsonb,9)",
    [category.id, f.owner.user.uid],
  )
  await f.query(
    "INSERT INTO posts(category_id,author_uid,title,body) VALUES($1,$2,'受限板块帖子','{\"blocks\":[]}'::jsonb)",
    [restricted.id, f.owner.user.uid],
  )
  await f.query(
    "INSERT INTO posts(category_id,author_uid,title,body,deleted_at) VALUES($1,$2,'已删除帖子','{\"blocks\":[]}'::jsonb,NOW())",
    [category.id, f.owner.user.uid],
  )
})
after(async () => {
  if (f) await f.close()
})

test('post page settings default to 20, validate 10–50 and preserve old callers and existing values', async () => {
  assert.equal(defaults.postsPerPage, 20)
  assert.equal((await f.request('GET', '/api/site')).json().content_limits.postsPerPage, 20)
  for (const value of [9, 51, 10.5, null, '20'])
    assert.equal(
      (
        await f.request(
          'PATCH',
          '/api/admin/content-settings',
          { ...defaults, postsPerPage: value },
          f.owner,
        )
      ).statusCode,
      400,
    )
  assert.equal(
    (await f.request('PATCH', '/api/admin/content-settings', { ...defaults, postsPerPage: 10 }, reader))
      .statusCode,
    403,
  )
  await settings({ postsPerPage: 50 })
  const legacy = { ...defaults }
  delete legacy.postsPerPage
  assert.equal((await f.request('PATCH', '/api/admin/content-settings', legacy, f.owner)).statusCode, 200)
  assert.equal(
    (await f.request('GET', '/api/admin/content-settings', undefined, f.owner)).json().postsPerPage,
    50,
  )
  const { runMigrations } = await import('../src/db.ts')
  await runMigrations()
  assert.equal(
    (await f.request('GET', '/api/admin/content-settings', undefined, f.owner)).json().postsPerPage,
    50,
  )
  await settings({ postsPerPage: 20 })
})

test('home pagination reaches all visible posts beyond the old 60 limit without duplicates', async () => {
  const all = [],
    first = await feed()
  assert.equal(first.pageSize, 20)
  assert.equal(first.totalPages, 4)
  assert.equal(first.total, 77)
  for (let page = 1; page <= first.totalPages; page++) {
    const response = await f.request('GET', '/api/posts?page=' + page)
    assert.equal(response.statusCode, 200, response.body)
    const value = response.json()
    assert.equal(value.posts.length, page === 4 ? 17 : 20)
    all.push(...value.posts.map((p) => p.id))
  }
  assert.equal(new Set(all).size, 77)
  assert.ok(ids.every((id) => all.includes(id)))
  assert.ok(!JSON.stringify(first.posts).includes('分页秘密'))
  const legacy = (await f.request('GET', '/api/posts')).json()
  assert.ok(Array.isArray(legacy))
  assert.equal(legacy.length, 60)
})

test('category pagination and total counts enforce moderation and reading permissions', async () => {
  const page = await feed('&category=' + category.id, reader)
  assert.equal(page.total, 74)
  assert.equal(page.totalPages, 4)
  assert.ok(page.posts.every((post) => post.category_id === category.id))
  assert.ok(!JSON.stringify(page.posts).includes('不可见帖子'))
  const denied = await feed('&category=' + restricted.id, reader)
  assert.equal(denied.total, 0)
  assert.equal(denied.posts.length, 0)
  assert.equal(denied.totalPages, 1)
})

test('configured sizes apply on new pages; out-of-range pages clamp and invalid pages fail', async () => {
  await settings({ postsPerPage: 10 })
  assert.equal((await feed()).posts.length, 10)
  const last = (await f.request('GET', '/api/posts?page=9999')).json()
  assert.equal(last.page, 8)
  assert.equal(last.totalPages, 8)
  assert.equal(last.posts.length, 7)
  for (const page of ['0', '-1', '1.5', 'NaN', ''])
    assert.equal((await f.request('GET', '/api/posts?page=' + page)).statusCode, 400)
  await settings({ postsPerPage: 50 })
  assert.equal((await feed()).posts.length, 50)
  await settings({ postsPerPage: 20 })
})

test('popular pagination preserves reply ranking and pin ordering', async () => {
  const hot = ids[0],
    pinned = ids[1]
  await f.query('UPDATE posts SET is_pinned=TRUE WHERE id=$1', [pinned])
  await f.query(
    'INSERT INTO replies(post_id,author_uid,body,floor_number) VALUES($1,$2,\'{"blocks":[]}\'::jsonb,1)',
    [hot, f.owner.user.uid],
  )
  const first = await feed('&sort=popular&followingFirst=false')
  assert.deepEqual(
    first.posts.slice(0, 2).map((post) => post.id),
    [pinned, hot],
  )
  const second = (await f.request('GET', '/api/posts?page=2&sort=popular&followingFirst=false')).json()
  assert.ok(second.posts.every((post) => !first.posts.some((previous) => previous.id === post.id)))
})

test('home pagination preserves followed-unread priority and search retains its array contract', async () => {
  const own = await f.request(
    'POST',
    '/api/posts',
    {
      categoryId: category.id,
      title: '读者新发布的帖子',
      body: { blocks: [{ type: 'paragraph', data: { text: '这是一篇新的公开帖子。' } }] },
    },
    reader,
  )
  assert.equal(own.statusCode, 201, own.body)
  const ownId = own.json().post.id
  await f.request('PUT', '/api/users/' + f.owner.user.uid + '/follow', undefined, reader)
  const first = await feed('', reader)
  const without = await feed('&followingFirst=false', reader)
  assert.equal(without.posts[1].id, ownId)
  assert.ok(first.posts.every((post) => post.id !== ownId))
  const search = await f.request('GET', '/api/posts?q=' + encodeURIComponent('分页讨论'))
  assert.equal(search.statusCode, 200, search.body)
  assert.ok(Array.isArray(search.json()))
  assert.equal(search.json().length, 60)
})
