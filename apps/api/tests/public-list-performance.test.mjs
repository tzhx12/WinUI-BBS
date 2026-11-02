import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createManagementFixture } from './helpers/management-fixture.mjs'

let f, member, category, defaults, db, ids
const body = (text) => ({ blocks: [{ type: 'paragraph', data: { text } }] })

before(async () => {
  f = await createManagementFixture()
  db = await import('../src/db.ts')
  const registered = await f.request('POST', '/api/auth/register', {
    username: 'bounded_list_member',
    displayName: '分页读者',
    email: 'bounded-list@example.test',
    password: f.password,
  })
  assert.equal(registered.statusCode, 201, registered.body)
  member = registered.json()
  category = (await f.request('GET', '/api/categories')).json()[0]
  defaults = (await f.request('GET', '/api/admin/content-settings', undefined, f.owner)).json()
  ids = (
    await f.query(
      `INSERT INTO posts(category_id,author_uid,title,body,created_at)
       SELECT $1,$2,'bounded-list ' || n,$3::jsonb,'2026-01-01'::timestamptz
       FROM generate_series(1,125)n RETURNING id`,
      [category.id, member.user.uid, JSON.stringify(body('分页正文'))],
    )
  ).rows.map((post) => post.id)
  for (const status of ['pending', 'hidden', 'rejected'])
    await f.query(
      'INSERT INTO posts(category_id,author_uid,title,body,status) VALUES($1,$2,$3,$4::jsonb,$5)',
      [category.id, member.user.uid, 'bounded-list excluded', JSON.stringify(body('不计入列表')), status],
    )
  await f.query(
    `INSERT INTO posts(category_id,author_uid,title,body,minimum_reader_level)
     VALUES($1,$2,'bounded-list restricted',$3::jsonb,9)`,
    [category.id, member.user.uid, JSON.stringify(body('高等级帖子'))],
  )
  await f.query(
    `INSERT INTO posts(category_id,author_uid,title,body,deleted_at)
     VALUES($1,$2,'bounded-list deleted',$3::jsonb,NOW())`,
    [category.id, member.user.uid, JSON.stringify(body('已删除帖子'))],
  )
})

after(async () => {
  await f?.close()
})

// Keep one connection available: transactions must not need a second pool slot.
async function withLastConnection(work) {
  const held = await Promise.all(Array.from({ length: 11 }, () => f.pool.connect()))
  let timer, pending
  try {
    pending = work()
    const result = await Promise.race([
      pending,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), 5000)
      }),
    ])
    assert.notEqual(result, null, 'operation waited for another connection while holding the last pool slot')
    return result
  } finally {
    clearTimeout(timer)
    held.forEach((client) => client.release())
    await pending
  }
}

test('experience awards finish using the last available transaction connection', async () => {
  const result = await withLastConnection(() =>
    db.inTransaction((client) => db.awardExperience(member.user.uid, 'create_reply', client)),
  )
  assert.ok(result.points > 0)
  const user = (await f.query('SELECT experience,level_offset FROM users WHERE uid=$1', [member.user.uid]))
    .rows[0]
  assert.equal(result.level, await db.effectiveLevel(user.experience, user.level_offset))
})

test('check-in finishes without borrowing a second connection inside its transaction', async () => {
  const response = await withLastConnection(() => f.request('POST', '/api/check-in', undefined, member))
  assert.equal(response.statusCode, 200, response.body)
  assert.ok(response.json().points > 0)
})

test('public user pages cover every readable post once and preserve legacy responses', async () => {
  const path = `/api/users/${member.user.uid}`
  const first = (await f.request('GET', path + '?page=1')).json()
  assert.equal(first.pageSize, 20)
  assert.equal(first.total, 125)
  assert.equal(first.totalPages, 7)
  const all = []
  for (let page = 1; page <= first.totalPages; page++) {
    const response = await f.request('GET', path + '?page=' + page)
    assert.equal(response.statusCode, 200, response.body)
    const value = response.json()
    assert.equal(value.posts.length, page === 7 ? 5 : 20)
    assert.equal(value.user.uid, member.user.uid)
    assert.ok(Array.isArray(value.folders))
    all.push(...value.posts.map((post) => post.id))
  }
  assert.equal(new Set(all).size, 125)
  assert.deepEqual(new Set(all), new Set(ids))
  const legacy = (await f.request('GET', path)).json()
  assert.equal(legacy.posts.length, 125)
  assert.equal(legacy.page, undefined)
})

test('user pagination clamps pages, validates input and follows the configured page size', async () => {
  const path = `/api/users/${member.user.uid}`
  const last = (await f.request('GET', path + '?page=99999')).json()
  assert.equal(last.page, 7)
  assert.equal(last.posts.length, 5)
  for (const page of ['0', '-1', '1.5', '', 'NaN', '2147483648'])
    assert.equal((await f.request('GET', path + '?page=' + page)).statusCode, 400)
  const empty = (await f.request('GET', `/api/users/${f.managers[0].user.uid}?page=3`)).json()
  assert.equal(empty.total, 0)
  assert.equal(empty.page, 1)
  assert.equal(empty.totalPages, 1)
  assert.deepEqual(empty.posts, [])
  try {
    const configured = await f.request(
      'PATCH',
      '/api/admin/content-settings',
      { ...defaults, postsPerPage: 10 },
      f.owner,
    )
    assert.equal(configured.statusCode, 200, configured.body)
    const value = (await f.request('GET', path + '?page=2')).json()
    assert.equal(value.pageSize, 10)
    assert.equal(value.totalPages, 13)
    assert.equal(value.posts.length, 10)
  } finally {
    await f.request('PATCH', '/api/admin/content-settings', defaults, f.owner)
  }
})

test('bounded search preserves latest, popular and pinned ordering and the 60-post array contract', async () => {
  await f.query('UPDATE posts SET is_pinned=TRUE WHERE id=ANY($1::uuid[])', [ids.slice(0, 2)])
  await f.query('INSERT INTO replies(post_id,author_uid,body) VALUES($1,$2,$3::jsonb)', [
    ids[3],
    member.user.uid,
    JSON.stringify(body('热门排序')),
  ])
  for (const sort of ['latest', 'popular']) {
    const expected = (
      await f.query(
        `SELECT p.id FROM posts p WHERE p.id=ANY($1::uuid[]) ORDER BY p.is_pinned DESC,
       ${sort === 'popular' ? '(SELECT COUNT(*) FROM replies r WHERE r.post_id=p.id AND r.deleted_at IS NULL) DESC,' : ''}
       p.created_at DESC,p.id DESC LIMIT 60`,
        [ids],
      )
    ).rows.map((post) => post.id)
    const response = await f.request('GET', '/api/posts?q=bounded-list&sort=' + sort + '&page=2')
    assert.equal(response.statusCode, 200, response.body)
    assert.ok(Array.isArray(response.json()))
    assert.deepEqual(
      response.json().map((post) => post.id),
      expected,
    )
    assert.ok(response.json().every((post) => post.search_cursor_created_at === undefined))
  }
})

test('search continues past non-visible matches with precise timestamps across batch boundaries', async () => {
  const candidates = (
    await f.query(
      `INSERT INTO posts(category_id,author_uid,title,body,created_at,is_pinned)
     SELECT $1,$2,'seek candidate ' || n,CASE WHEN n<3 THEN $3::jsonb ELSE $4::jsonb END,
       '2030-01-01'::timestamptz+n*INTERVAL '1 microsecond',n>=60
     FROM generate_series(0,72)n RETURNING id,title`,
      [
        category.id,
        f.owner.user.uid,
        JSON.stringify(body('seekNeedle 可见正文')),
        JSON.stringify(body('<span data-content-lock="like">seekNeedle 隐藏正文</span>')),
      ],
    )
  ).rows
  const visibleIds = candidates
    .filter((post) => /^seek candidate [0-2]$/.test(post.title))
    .map((post) => post.id)
  await f.query('INSERT INTO replies(post_id,author_uid,body) VALUES($1,$2,$3::jsonb)', [
    visibleIds[0],
    member.user.uid,
    JSON.stringify(body('排序回复')),
  ])
  for (const sort of ['latest', 'popular']) {
    const expected = (
      await f.query(
        `SELECT p.id FROM posts p WHERE p.id=ANY($1::uuid[]) ORDER BY p.is_pinned DESC,
       ${sort === 'popular' ? '(SELECT COUNT(*) FROM replies r WHERE r.post_id=p.id AND r.deleted_at IS NULL) DESC,' : ''}
       p.created_at DESC,p.id DESC`,
        [visibleIds],
      )
    ).rows.map((post) => post.id)
    const response = await f.request('GET', '/api/posts?q=seekNeedle&sort=' + sort)
    assert.equal(response.statusCode, 200, response.body)
    assert.deepEqual(
      response.json().map((post) => post.id),
      expected,
    )
    assert.doesNotMatch(response.body, /隐藏正文/)
  }
})
