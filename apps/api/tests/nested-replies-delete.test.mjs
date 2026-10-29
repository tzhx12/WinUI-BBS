import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createManagementFixture } from './helpers/management-fixture.mjs'

let f, alice, bob, manager, category
const body = (text) => ({ blocks: [{ type: 'paragraph', data: { text } }] })
const request = (method, path, payload, user) => f.request(method, path, payload, user)

async function createPost(user = alice) {
  const result = await request(
    'POST',
    '/api/posts',
    { title: '楼层与楼中楼测试', categoryId: category.id, body: body('主帖正文') },
    user,
  )
  assert.equal(result.statusCode, 201, result.body)
  return result.json().post
}
async function createReply(postId, user, value = {}) {
  const result = await request(
    'POST',
    `/api/posts/${postId}/replies`,
    { body: body('测试回复'), ...value },
    user,
  )
  assert.equal(result.statusCode, 201, result.body)
  return result.json().reply
}

before(async () => {
  f = await createManagementFixture()
  const register = async (username) => {
    const response = await request('POST', '/api/auth/register', {
      username,
      displayName: username,
      email: `${username}@example.test`,
      password: f.password,
    })
    assert.equal(response.statusCode, 201, response.body)
    return response.json()
  }
  alice = await register('reply_alice')
  bob = await register('reply_bob')
  manager = f.managers.find((member) => member.permission === 'posts.manage')
  assert.ok(manager)
  category = (await request('GET', '/api/categories')).json()[0]
})
after(async () => {
  if (f) await f.close()
})

test('root floors remain monotonic and child replies paginate independently with deep links to page numbers', async () => {
  const post = await createPost()
  const first = await createReply(post.id, alice)
  const second = await createReply(post.id, bob)
  assert.equal(first.floor_number, 1)
  assert.equal(first.child_number, null)
  assert.equal(second.floor_number, 2)
  for (let i = 1; i <= 12; i++)
    await createReply(post.id, i % 2 ? alice : bob, {
      parentReplyId: first.id,
      ...(i === 2 ? { replyToId: first.id } : {}),
    })

  const page1 = await request(
    'GET',
    `/api/posts/${post.id}/replies/${first.id}/children?page=1`,
    undefined,
    bob,
  )
  const page2 = await request(
    'GET',
    `/api/posts/${post.id}/replies/${first.id}/children?page=2`,
    undefined,
    bob,
  )
  const deepLink = await request(
    'GET',
    `/api/posts/${post.id}/replies/${first.id}/children?page=3`,
    undefined,
    bob,
  )
  assert.equal(page1.statusCode, 200, page1.body)
  assert.equal(page2.json().replies.length, 5)
  assert.equal(page1.json().totalPages, 3)
  assert.deepEqual(
    deepLink.json().replies.map((reply) => reply.child_number),
    [11, 12],
  )
  assert.equal(deepLink.json().replies[1].floor_number, 1)
  assert.equal(page1.json().replies[1].reply_to_uid, alice.user.uid)
  assert.equal((await request('GET', `/api/posts/${post.id}?page=1`, undefined, alice)).json().page, 1)
  assert.equal(
    (await request('GET', `/api/posts/${post.id}/replies/${first.id}/children?page=0`, undefined, bob))
      .statusCode,
    400,
  )

  assert.equal(
    (await request('DELETE', `/api/posts/${post.id}/replies/${first.id}`, undefined, bob)).statusCode,
    403,
  )
  assert.equal(
    (await request('DELETE', `/api/posts/${post.id}/replies/${first.id}`, undefined, alice)).statusCode,
    200,
  )
  const postPage = (await request('GET', `/api/posts/${post.id}?page=1`, undefined, bob)).json()
  const tombstone = postPage.replies.find((reply) => reply.id === first.id)
  assert.equal(tombstone.deletion_source, 'author')
  assert.equal(tombstone.author_uid, null)
  assert.equal(
    (await request('GET', `/api/posts/${post.id}/replies/${first.id}/children?page=3`, undefined, bob)).json()
      .total,
    12,
  )
  assert.equal(
    (
      await request(
        'POST',
        `/api/posts/${post.id}/replies`,
        { body: body('拒绝回复原文'), parentReplyId: first.id },
        bob,
      )
    ).statusCode,
    409,
  )
  const child = (
    await request('GET', `/api/posts/${post.id}/replies/${first.id}/children?page=1`, undefined, bob)
  ).json().replies[1]
  const continued = await createReply(post.id, bob, { parentReplyId: first.id, replyToId: child.id })
  assert.equal(continued.child_number, 13)
  const nextRoot = await createReply(post.id, alice)
  assert.equal(nextRoot.floor_number, 3)
  assert.equal(
    (await request('GET', `/api/posts/${post.id}?page=1`, undefined, bob)).json().totalThreadCount,
    3,
  )
})

test('users can permanently delete their own replies; deleting the final child prunes an empty tombstone', async () => {
  const post = await createPost()
  const vacant = await createReply(post.id, alice)
  assert.equal(vacant.floor_number, 1)
  assert.equal(
    (await request('DELETE', `/api/posts/${post.id}/replies/${vacant.id}`, undefined, alice)).statusCode,
    200,
  )
  const root = await createReply(post.id, alice)
  assert.equal(root.floor_number, 2)
  const child = await createReply(post.id, bob, { parentReplyId: root.id })
  assert.equal(
    (await request('DELETE', `/api/posts/${post.id}/replies/${child.id}`, undefined, alice)).statusCode,
    403,
  )
  assert.equal(
    (await request('DELETE', `/api/posts/${post.id}/replies/${child.id}`, undefined, bob)).statusCode,
    200,
  )
  assert.equal(
    (await request('GET', `/api/posts/${post.id}/replies/${root.id}/children`, undefined, alice)).json()
      .total,
    0,
  )
  assert.equal(
    (await request('DELETE', `/api/posts/${post.id}/replies/${root.id}`, undefined, alice)).statusCode,
    200,
  )
  assert.ok(!(await f.query('SELECT 1 FROM replies WHERE id=$1', [root.id])).rowCount)
  const later = await createReply(post.id, alice)
  assert.equal(later.floor_number, 3)
  const one = await createReply(post.id, alice, { parentReplyId: later.id })
  const two = await createReply(post.id, bob, { parentReplyId: later.id })
  await request('DELETE', `/api/posts/${post.id}/replies/${one.id}`, undefined, alice)
  const three = await createReply(post.id, bob, { parentReplyId: later.id })
  assert.equal(three.child_number, 3)
  assert.deepEqual(
    (await request('GET', `/api/posts/${post.id}/replies/${later.id}/children`, undefined, alice))
      .json()
      .replies.map((r) => r.child_number),
    [2, 3],
  )
  await request('DELETE', `/api/posts/${post.id}/replies/${later.id}`, undefined, alice)
  for (const child of [two, three])
    await request('DELETE', `/api/posts/${post.id}/replies/${child.id}`, undefined, bob)
  assert.equal((await f.query('SELECT 1 FROM replies WHERE id=$1', [later.id])).rowCount, 0)
})

test('admin can retain a deleted main reply and children or permanently cascade the entire thread', async () => {
  const post = await createPost()
  const root = await createReply(post.id, alice)
  const childAlice = await createReply(post.id, alice, { parentReplyId: root.id })
  const childBob = await createReply(post.id, bob, { parentReplyId: root.id, replyToId: childAlice.id })

  const keep = await request(
    'DELETE',
    `/api/posts/${post.id}/replies/${root.id}?scope=reply`,
    undefined,
    manager,
  )
  assert.equal(keep.statusCode, 200, keep.body)
  assert.equal(keep.json().retainedChildren, true)
  const detail = (await request('GET', `/api/posts/${post.id}?page=1`, undefined, bob)).json()
  assert.equal(detail.replies.find((reply) => reply.id === root.id).deletion_source, 'admin')
  assert.equal(detail.replies.find((reply) => reply.id === root.id).author_uid, null)
  assert.equal(
    (await request('GET', `/api/posts/${post.id}/replies/${root.id}/children?page=1`, undefined, bob)).json()
      .total,
    2,
  )
  const notices = await request('GET', '/api/me/notifications', undefined, alice)
  assert.ok(
    notices.json().some((notice) => notice.kind === 'moderation' && notice.body.includes('第1楼回复')),
  )
  assert.ok(
    (await f.query("SELECT 1 FROM audit_events WHERE action_key='reply.delete' AND target_id=$1", [root.id]))
      .rowCount,
  )

  const cascadeRoot = await createReply(post.id, alice)
  const cascadeAlice = await createReply(post.id, alice, { parentReplyId: cascadeRoot.id })
  const cascadeBob = await createReply(post.id, bob, { parentReplyId: cascadeRoot.id })
  const cascade = await request(
    'DELETE',
    `/api/posts/${post.id}/replies/${cascadeRoot.id}?scope=thread`,
    undefined,
    manager,
  )
  assert.equal(cascade.statusCode, 200, cascade.body)
  assert.equal(cascade.json().removedCount, 3)
  assert.ok(
    !(
      await f.query('SELECT 1 FROM replies WHERE id=ANY($1::uuid[])', [
        [cascadeRoot.id, cascadeAlice.id, cascadeBob.id],
      ])
    ).rowCount,
  )
  assert.equal(
    (
      await request(
        'GET',
        `/api/posts/${post.id}/replies/${cascadeRoot.id}/children?page=1`,
        undefined,
        alice,
      )
    ).statusCode,
    404,
  )
  for (const user of [alice, bob]) {
    const inbox = (await request('GET', '/api/me/notifications', undefined, user)).json()
    assert.ok(
      inbox.some(
        (notice) => notice.kind === 'moderation' && notice.body.includes(`第${cascadeRoot.floor_number}楼`),
      ),
    )
  }
  const audit = await f.query(
    "SELECT details FROM audit_events WHERE action_key='reply.delete.cascade' AND target_id=$1",
    [cascadeRoot.id],
  )
  assert.equal(audit.rows[0].details.scope, 'thread')
  assert.equal(audit.rows[0].details.removed.length, 3)
  assert.equal(
    (
      await request(
        'DELETE',
        `/api/posts/${post.id}/replies/${cascadeRoot.id}?scope=thread`,
        undefined,
        manager,
      )
    ).statusCode,
    404,
  )
})

test('concurrent reply allocation stays unique and child targets cannot cross threads or posts', async () => {
  const post = await createPost()
  const roots = await Promise.all(Array.from({ length: 6 }, () => createReply(post.id, alice)))
  assert.deepEqual(
    roots.map((r) => r.floor_number).sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6],
  )
  const children = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      createReply(post.id, i % 2 ? alice : bob, { parentReplyId: roots[0].id }),
    ),
  )
  assert.deepEqual(
    children.map((r) => r.child_number).sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6],
  )
  const foreign = await createPost()
  const foreignRoot = await createReply(foreign.id, alice)
  for (const value of [
    { parentReplyId: foreignRoot.id },
    { parentReplyId: children[0].id },
    { parentReplyId: roots[0].id, replyToId: roots[1].id },
  ])
    assert.equal(
      (await request('POST', `/api/posts/${post.id}/replies`, { body: body('无效目标'), ...value }, bob))
        .statusCode,
      404,
    )
  assert.equal(
    (await request('DELETE', `/api/posts/${post.id}/replies/${roots[0].id}?scope=thread`, undefined, alice))
      .statusCode,
    403,
  )
  assert.equal(
    (
      await request(
        'DELETE',
        `/api/posts/${post.id}/replies/${children[0].id}?scope=thread`,
        undefined,
        manager,
      )
    ).statusCode,
    400,
  )
})

test('child pages retain post access boundaries and author-trash privacy', async () => {
  const post = await createPost()
  const root = await createReply(post.id, alice)
  await createReply(post.id, bob, { parentReplyId: root.id })
  const path = `/api/posts/${post.id}/replies/${root.id}/children`
  await f.query('UPDATE posts SET minimum_reader_level=99 WHERE id=$1', [post.id])
  assert.equal((await request('GET', path, undefined, bob)).statusCode, 403)
  await f.query("UPDATE posts SET minimum_reader_level=0,status='pending' WHERE id=$1", [post.id])
  assert.equal((await request('GET', path, undefined, bob)).statusCode, 404)
  assert.equal((await request('GET', path, undefined, alice)).statusCode, 200)
  await request('DELETE', `/api/me/posts/${post.id}`, undefined, alice)
  assert.equal((await request('GET', path, undefined, alice)).statusCode, 404)
  const trash = `/api/me/trash/${post.id}/replies/${root.id}/children`
  assert.equal((await request('GET', trash, undefined, alice)).statusCode, 200)
  assert.equal((await request('GET', trash, undefined, bob)).statusCode, 404)
})

test('an audit failure rolls back reply cascade deletion and all recipient notifications', async () => {
  const post = await createPost(),
    root = await createReply(post.id, alice)
  const child = await createReply(post.id, bob, { parentReplyId: root.id })
  const count = async () =>
    Number(
      (
        await f.query("SELECT COUNT(*) AS n FROM notifications WHERE post_id=$1 AND kind='moderation'", [
          post.id,
        ])
      ).rows[0].n,
    )
  const before = await count()
  await f.query(
    `CREATE FUNCTION reject_reply_audit_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action_key='reply.delete.cascade' THEN RAISE EXCEPTION 'test rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_reply_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_reply_audit_test()`,
  )
  try {
    assert.equal(
      (await request('DELETE', `/api/posts/${post.id}/replies/${root.id}?scope=thread`, undefined, manager))
        .statusCode,
      500,
    )
    assert.equal(
      (await f.query('SELECT 1 FROM replies WHERE id=ANY($1::uuid[])', [[root.id, child.id]])).rowCount,
      2,
    )
    assert.equal(await count(), before)
  } finally {
    await f.query('DROP TRIGGER reject_reply_audit ON audit_events; DROP FUNCTION reject_reply_audit_test()')
  }
})

test('reply deletion is forbidden to guests, banned users and non-owning ordinary users', async () => {
  const post = await createPost()
  const root = await createReply(post.id, alice)
  assert.equal((await request('DELETE', `/api/posts/${post.id}/replies/${root.id}`)).statusCode, 401)
  await f.query("UPDATE users SET banned_until=NOW()+INTERVAL '1 hour' WHERE uid=$1", [alice.user.uid])
  assert.equal(
    (await request('DELETE', `/api/posts/${post.id}/replies/${root.id}`, undefined, alice)).statusCode,
    403,
  )
})
