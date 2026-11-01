import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createManagementFixture } from './helpers/management-fixture.mjs'
import { seedAdminPostLists } from './helpers/admin-post-fixture.mjs'

let f, author
const paths = ['/api/admin/posts', '/api/admin/reviews', '/api/admin/deleted-posts']
before(async () => {
  f = await createManagementFixture()
  ;({ author } = await seedAdminPostLists(f))
})
after(async () => {
  if (f) await f.close()
})
async function list(path, params = {}, user = f.owner) {
  const response = await f.request('GET', `${path}?${new URLSearchParams(params)}`, undefined, user)
  assert.equal(response.statusCode, 200, response.body)
  return response.json()
}

test('all management lists search titles and all four author identifiers before pagination', async () => {
  for (const path of paths) {
    const expected = path.endsWith('/posts') ? 238 : 79
    for (const q of [
      '检索验收',
      author.user.uid,
      author.user.uuid.toUpperCase(),
      '专用作者',
      'POST_SEARCH_AUTHOR',
    ]) {
      const value = await list(path, { q, page: 1 })
      assert.equal(value.total, q === '检索验收' && expected === 238 ? 237 : expected, `${path} ${q}`)
      assert.equal(value.posts.length, 25)
      assert.equal(value.pageSize, 25)
      assert.ok(value.posts.every((post) => post.author_uid === author.user.uid))
    }
    assert.equal(
      (await list(path, { q: '检索验收 pending 79', page: 1 })).total,
      path.endsWith('/deleted-posts') ? 0 : 1,
    )
    assert.equal((await list(path, { q: '找不到的帖子', page: 1 })).total, 0)
  }
})

test('pagination reaches records beyond 200 with stable ordering and a partial last page', async () => {
  for (const path of paths) {
    const first = await list(path, { q: '专用作者', page: 1 })
    const ids = []
    for (let page = 1; page <= first.totalPages; page++) {
      const value = await list(path, { q: '专用作者', page })
      assert.equal(value.posts.length, page === first.totalPages ? first.total % 25 : 25)
      ids.push(...value.posts.map((post) => post.id))
    }
    assert.equal(ids.length, first.total)
    assert.equal(new Set(ids).size, first.total)
    assert.deepEqual((await list(path, { q: '专用作者', page: 1 })).posts, first.posts)
    const last = await list(path, { q: '专用作者', page: 9999 })
    assert.equal(last.page, first.totalPages)
    const empty = await list(path, { q: '不存在', page: 9999 })
    assert.deepEqual([empty.posts.length, empty.page, empty.totalPages], [0, 1, 1])
  }
})

test('search composes with moderation filters and preserves deletion and review boundaries', async () => {
  for (const status of ['published', 'pending', 'rejected', 'hidden']) {
    const value = await list(paths[0], {
      q: author.user.uuid,
      page: 1,
      status,
    })
    assert.equal(value.total, status === 'hidden' ? 1 : 79)
    assert.ok(value.posts.every((post) => post.status === status))
  }
  for (const status of ['pending', 'published', 'rejected']) {
    const value = await list(paths[1], {
      q: author.user.uuid,
      page: 1,
      status,
    })
    assert.equal(value.total, 79)
    assert.ok(value.posts.every((post) => post.status === status))
  }
  const deleted = await list(paths[2], { q: '用户回收站', page: 1 })
  assert.equal(deleted.total, 0)
  const literal = await list(paths[0], { q: '%', page: 1 })
  assert.equal(literal.total, 1)
  assert.equal(literal.posts[0].title, '100%字面量隐藏帖子')
  assert.equal((await list(paths[0], { q: "' OR 1=1 --", page: 1 })).total, 0)
})

test('legacy arrays, query validation and list permissions remain available', async () => {
  for (const path of paths) {
    assert.ok(Array.isArray(await list(path)))
    for (const params of [{ page: 0 }, { page: 1.5 }, { page: 'abc' }, { q: 'x'.repeat(201), page: 1 }])
      assert.equal(
        (await f.request('GET', `${path}?${new URLSearchParams(params)}`, undefined, f.owner)).statusCode,
        400,
      )
    assert.equal((await f.request('GET', `${path}?page=1`)).statusCode, 401)
    assert.equal((await f.request('GET', `${path}?page=1`, undefined, author)).statusCode, 403)
    const permission = path.endsWith('/reviews') ? 'posts.review' : 'posts.manage'
    assert.equal(
      (
        await f.request(
          'GET',
          `${path}?page=1`,
          undefined,
          f.managers.find((m) => m.permission === permission),
        )
      ).statusCode,
      200,
    )
  }
  assert.equal((await list(paths[0])).length, 200)
})
