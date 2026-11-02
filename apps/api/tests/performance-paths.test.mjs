import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { readdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createManagementFixture } from './helpers/management-fixture.mjs'

let f, category, post, roots, remoteImportRequests, secondImportArrived
const body = { blocks: [{ type: 'paragraph', data: { text: '性能回归正文' } }] }
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWioAAAAASUVORK5CYII=',
  'base64',
)
before(async () => {
  remoteImportRequests = 0
  let resolveSecondImport
  secondImportArrived = new Promise((resolve) => {
    resolveSecondImport = resolve
  })
  f = await createManagementFixture({
    configure(app) {
      app.addHook('onRequest', (request, _reply, done) => {
        if (request.method === 'POST' && request.url === '/api/me/remote-emoji/import') {
          remoteImportRequests++
          if (remoteImportRequests === 2) resolveSecondImport()
        }
        done()
      })
    },
  })
  category = (await f.request('GET', '/api/categories')).json()[0]
  post = (
    await f.query(
      `INSERT INTO posts(category_id,author_uid,title,body)
    VALUES($1,$2,'批量子回复性能回归',$3) RETURNING id`,
      [category.id, f.owner.user.uid, body],
    )
  ).rows[0].id
  roots = (
    await f.query(
      `INSERT INTO replies(post_id,author_uid,body)
    SELECT $1,$2,$3::jsonb FROM generate_series(1,25) RETURNING id`,
      [post, f.owner.user.uid, JSON.stringify(body)],
    )
  ).rows.map((row) => row.id)
  for (const id of roots)
    await f.query(
      `INSERT INTO replies(post_id,author_uid,body,parent_reply_id)
      SELECT $1,$2,$3::jsonb,$4 FROM generate_series(1,7)`,
      [post, f.owner.user.uid, JSON.stringify(body), id],
    )
})
after(async () => {
  await f?.close()
})

test('reply previews use bounded SQL and preserve counts, child pages and tombstones', async () => {
  await f.query('UPDATE replies SET deleted_at=NOW() WHERE parent_reply_id=$1 AND child_number=2', [roots[0]])
  await f.query('UPDATE replies SET deleted_at=NOW(),author_uid=NULL WHERE id=$1', [roots[1]])
  const { replyPage, childReplyPage } = await import('../src/replies.ts')
  let queries = 0
  const original = f.pool.query
  f.pool.query = function (...args) {
    queries++
    return original.apply(this, args)
  }
  let page
  try {
    page = await replyPage({ query: { page: '1' } }, post)
  } finally {
    f.pool.query = original
  }
  assert.ok(queries <= 6, `20 roots issued ${queries} queries`)
  assert.equal(page.replies.length, 20)
  assert.equal(page.totalThreadCount, 25)
  assert.equal(page.totalReplyCount, 198)
  assert.equal(page.replies[0].children.total, 6)
  assert.deepEqual(
    page.replies[0].children.replies.map((r) => r.child_number),
    [1, 3, 4, 5, 6],
  )
  assert.equal(page.replies[1].author_uid, null)
  assert.equal(page.replies[1].children.total, 7)
  const next = await childReplyPage(roots[0], 2)
  assert.deepEqual(
    next.replies.map((r) => r.child_number),
    [7],
  )
})

test('stored reply counts follow soft deletion, restoration, rollback and cascading removal', async () => {
  const matches = async () => {
    const value = (
      await f.query(
        `SELECT p.reply_count,
      (SELECT COUNT(*)::int FROM replies WHERE post_id=p.id AND deleted_at IS NULL) AS actual
      FROM posts p WHERE id=$1`,
        [post],
      )
    ).rows[0]
    assert.equal(value.reply_count, value.actual)
  }
  await matches()
  await f.query('UPDATE replies SET deleted_at=NULL WHERE parent_reply_id=$1 AND child_number=2', [roots[0]])
  await matches()
  const { inTransaction } = await import('../src/db.ts')
  await assert.rejects(
    inTransaction(async (client) => {
      await client.query('INSERT INTO replies(post_id,author_uid,body) VALUES($1,$2,$3)', [
        post,
        f.owner.user.uid,
        body,
      ])
      throw new Error('rollback-count')
    }),
    /rollback-count/,
  )
  await matches()
  await f.query('DELETE FROM replies WHERE id=$1', [roots[2]])
  await matches()
  await f.query('UPDATE replies SET body=$2::jsonb WHERE post_id=$1', [post, JSON.stringify(body)])
  await matches()
  const list = (await f.request('GET', '/api/posts?sort=popular')).json()
  assert.equal(list.find((row) => row.id === post).reply_count, 191)
})

test('reply-count migration backfills live replies and leaves existing floor counters intact', async () => {
  const client = await f.pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('CREATE SCHEMA performance_count_upgrade')
    await client.query('SET LOCAL search_path=performance_count_upgrade,public')
    const directory = new URL('../migrations/', import.meta.url)
    for (const name of (await readdir(directory))
      .filter((name) => name.endsWith('.sql') && name < '027')
      .sort())
      await client.query(await readFile(new URL(name, directory), 'utf8'))
    const uid = (
      await client.query(`INSERT INTO users(username,email,password_hash,display_name)
      VALUES('migration_reader','migration@example.test','fixture','Migration') RETURNING uid`)
    ).rows[0].uid
    const cat = (await client.query('SELECT id FROM categories LIMIT 1')).rows[0].id
    const id = (
      await client.query(
        `INSERT INTO posts(category_id,author_uid,title,body)
      VALUES($1,$2,'existing post',$3) RETURNING id`,
        [cat, uid, body],
      )
    ).rows[0].id
    await client.query(
      `INSERT INTO replies(post_id,author_uid,body) SELECT $1,$2,$3::jsonb FROM generate_series(1,3)`,
      [id, uid, JSON.stringify(body)],
    )
    await client.query('UPDATE replies SET deleted_at=NOW() WHERE floor_number=2')
    await client.query(await readFile(new URL('027_feed_reply_counts.sql', directory), 'utf8'))
    assert.deepEqual(
      (await client.query('SELECT reply_count,reply_floor_counter FROM posts WHERE id=$1', [id])).rows[0],
      { reply_count: 2, reply_floor_counter: 3 },
    )
    await client.query('DELETE FROM posts WHERE id=$1', [id])
    assert.equal((await client.query('SELECT 1 FROM replies')).rowCount, 0)
  } finally {
    await client.query('ROLLBACK')
    client.release()
  }
})

test('numbered deep pages preserve ordering across the reverse-scan boundary', async () => {
  const id = (
    await f.query(`INSERT INTO categories(name,slug) VALUES('深分页回归','deep-page-test') RETURNING id`)
  ).rows[0].id
  await f.query(
    `INSERT INTO posts(category_id,author_uid,title,body,created_at,is_pinned)
    SELECT $1,$2,'深分页 ' || n,$3::jsonb,'2026-01-01'::timestamptz,n%19=0 FROM generate_series(1,113)n`,
    [id, f.owner.user.uid, JSON.stringify(body)],
  )
  for (const sort of ['latest', 'popular']) {
    const expected = (
      await f.query(
        `SELECT id FROM posts WHERE category_id=$1
      ORDER BY is_pinned DESC,${sort === 'popular' ? 'reply_count DESC,' : ''}created_at DESC,id DESC`,
        [id],
      )
    ).rows.map((r) => r.id)
    const actual = []
    for (let page = 1; page <= 6; page++) {
      const response = await f.request('GET', `/api/posts?category=${id}&sort=${sort}&page=${page}`)
      assert.equal(response.statusCode, 200, response.body)
      actual.push(...response.json().posts.map((row) => row.id))
    }
    assert.deepEqual(actual, expected)
    const clamped = (await f.request('GET', `/api/posts?category=${id}&sort=${sort}&page=99999`)).json()
    assert.equal(clamped.page, 6)
    assert.deepEqual(
      clamped.posts.map((row) => row.id),
      expected.slice(100),
    )
  }
})

test('remote downloads leave uploads unblocked and concurrent imports share one cache', async () => {
  let release,
    started,
    queueRejected,
    downloads = 0,
    completed = false
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const begun = new Promise((resolve) => {
    started = resolve
  })
  const queueFull = new Promise((resolve) => {
    queueRejected = resolve
  })
  const remote = createServer(async (req, res) => {
    if (req.url.startsWith('/info')) {
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({
          id: 987,
          text: '慢下载',
          emote: [1, 2].map((n) => ({
            text: '表情' + n,
            url: `http://127.0.0.1:${remote.address().port}/image${n}`,
            gif_url: '',
            type: 1,
          })),
        }),
      )
    } else {
      downloads++
      started()
      await gate
      res.setHeader('content-type', 'image/png')
      res.end(png)
    }
  })
  await new Promise((resolve) => remote.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${remote.address().port}`
  remoteImportRequests = 0
  const previous = (await f.query("SELECT setting_value FROM app_settings WHERE setting_key='remote_emoji'"))
    .rows[0].setting_value
  let importing,
    second,
    timer,
    queued = []
  try {
    await f.query(
      `UPDATE app_settings SET setting_value=setting_value || $1::jsonb WHERE setting_key='remote_emoji'`,
      [JSON.stringify({ enabled: true, countTowardPackLimit: false, apiUrl: base, sourceUrl: base })],
    )
    importing = f
      .request('POST', '/api/me/remote-emoji/import', { remoteId: 987, variant: 'static' }, f.owner)
      .then((response) => {
        completed = true
        return response
      })
    await begun
    second = f.request(
      'POST',
      '/api/me/remote-emoji/import',
      { remoteId: 987, variant: 'static' },
      f.managers[0],
    )
    await secondImportArrived
    queued = Array.from({ length: 38 }, () =>
      f
        .request('POST', '/api/me/remote-emoji/import', { remoteId: 987, variant: 'static' }, f.managers[0])
        .then((response) => {
          if (response.statusCode === 503) queueRejected()
          return response
        }),
    )
    const uploading = f.app.inject({
      method: 'POST',
      url: '/api/admin/media',
      headers: {
        authorization: `Bearer ${f.owner.token}`,
        'content-type': 'multipart/form-data; boundary=perf-upload',
      },
      payload: Buffer.concat([
        Buffer.from(
          '--perf-upload\r\nContent-Disposition: form-data; name="file"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n',
        ),
        png,
        Buffer.from('\r\n--perf-upload--\r\n'),
      ]),
    })
    const uploaded = await Promise.race([
      uploading,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('upload blocked by remote download')), 8000)
      }),
    ])
    assert.equal(uploaded.statusCode, 201, uploaded.body)
    assert.equal(completed, false)
    // Observe saturation before releasing downloads, including on a busy test runner.
    clearTimeout(timer)
    await Promise.race([
      queueFull,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('import queue did not reject excess requests')), 8000)
      }),
    ])
    release()
    const results = await Promise.all([importing, second])
    assert.ok(
      results.every((r) => r.statusCode === 201),
      results.map((r) => r.body).join('\n'),
    )
    assert.equal(results[0].json().id, results[1].json().id)
    assert.equal(downloads, 2)
    const saturated = await Promise.all(queued)
    assert.ok(saturated.some((r) => r.statusCode === 503))
    assert.ok(saturated.every((r) => [201, 503].includes(r.statusCode)))
    assert.equal(
      (await f.query('SELECT 1 FROM media_assets WHERE emoji_pack_id=$1', [results[0].json().id])).rowCount,
      2,
    )
  } finally {
    clearTimeout(timer)
    release()
    await Promise.allSettled([importing, second, ...queued].filter(Boolean))
    await f.query("UPDATE app_settings SET setting_value=$1 WHERE setting_key='remote_emoji'", [previous])
    await new Promise((resolve) => remote.close(resolve))
  }
})
