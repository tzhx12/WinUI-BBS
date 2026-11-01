import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createManagementFixture } from './helpers/management-fixture.mjs'
let f, member, category
before(async () => {
  f = await createManagementFixture()
  const response = await f.request('POST', '/api/auth/register', {
    username: 'granular_member',
    displayName: '权限成员',
    email: 'granular@example.test',
    password: f.password,
  })
  assert.equal(response.statusCode, 201, response.body)
  member = response.json()
  category = (await f.request('GET', '/api/categories')).json()[0]
})
after(async () => {
  if (f) await f.close()
})
const request = (method, path, body, user = f.owner) => f.request(method, path, body, user)
test('user filters distinguish active, banned, expired and suspended accounts and include avatar and UID search', async () => {
  const uid = member.user.uid
  const avatar = '/uploads/fixture-avatar.png'
  await f.query('UPDATE users SET avatar_url=$2 WHERE uid=$1', [uid, avatar])
  const list = async (status, q = uid) => {
    const response = await request('GET', `/api/admin/users?status=${status}&q=${q}`)
    assert.equal(response.statusCode, 200, response.body)
    return response.json()
  }
  assert.equal((await list('active'))[0].avatar_url, avatar)
  await request('PATCH', `/api/admin/users/${uid}`, { banMinutes: 30 })
  assert.equal((await list('active')).length, 0)
  assert.equal((await list('banned'))[0].uid, uid)
  assert.equal((await list('banned', 'granular_member')).length, 1)
  assert.equal((await list('banned', 'no_matching_user')).length, 0)
  let space = (await request('GET', `/api/users/${uid}`, undefined, null)).json().user
  assert.ok(new Date(space.banned_until) > new Date())
  assert.equal(space.email, undefined)
  await request('PATCH', `/api/admin/users/${uid}`, { status: 'suspended' })
  assert.equal((await list('banned')).length, 0)
  assert.equal((await list('suspended')).length, 1)
  await f.query("UPDATE users SET status='active', banned_until=NOW()-INTERVAL '1 minute' WHERE uid=$1", [
    uid,
  ])
  assert.equal((await list('active')).length, 1)
  space = (await request('GET', `/api/users/${uid}`, undefined, null)).json().user
  assert.equal(space.banned_until, null)
  assert.equal((await request('GET', '/api/admin/users?status=unknown')).statusCode, 400)
  assert.equal((await request('PATCH', '/api/admin/users/1', { status: 'suspended' })).statusCode, 403)
  assert.equal((await request('PATCH', '/api/admin/users/01', { status: 'suspended' })).statusCode, 403)
  assert.equal((await request('PATCH', '/api/admin/users/1', { banMinutes: 30 })).statusCode, 403)
  assert.equal((await request('PATCH', '/api/admin/users/1', { level: 2, status: 'active' })).statusCode, 200)
})
test('each lock condition is enforced separately, including mixed-condition bodies', async () => {
  const uid = member.user.uid
  const groups = (await request('GET', '/api/admin/groups')).json()
  const normal = groups.find((g) => g.is_default)
  await request('PATCH', `/api/admin/groups/${normal.id}`, {
    permissions: ['posts.create', 'replies.create', 'media.use'],
  })
  const created = await request('POST', '/api/admin/groups', {
    name: '独立解锁权限',
    groupType: 'special',
    permissions: ['posts.hide_content.like'],
  })
  assert.equal(created.statusCode, 201, created.body)
  await request('POST', `/api/admin/groups/${created.json().id}/memberships`, { userUid: uid })
  const publish = (conditions) =>
    request(
      'POST',
      '/api/posts',
      {
        categoryId: category.id,
        title: '独立锁定测试',
        body: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: conditions.map((c) => `<span data-content-lock="${c}">私密文字</span>`).join(' '),
              },
            },
          ],
        },
      },
      member,
    )
  assert.equal((await publish(['like'])).statusCode, 201)
  for (const conditions of [['reply'], ['follow'], ['like', 'reply']])
    assert.equal((await publish(conditions)).statusCode, 403)
  await f.query(
    "UPDATE group_memberships SET expires_at=NOW()-INTERVAL '1 minute' WHERE user_uid=$1 AND group_id=$2",
    [uid, created.json().id],
  )
  assert.equal((await publish(['like'])).statusCode, 403)
})
test('legacy hidden permission inputs expand to three keys and review bans require explicit review authority', async () => {
  const legacy = await request('POST', '/api/admin/groups', {
    name: '旧接口兼容',
    groupType: 'normal',
    permissions: ['posts.hide_content'],
  })
  assert.equal(legacy.statusCode, 201, legacy.body)
  const group = (await request('GET', '/api/admin/groups')).json().find((g) => g.id === legacy.json().id)
  assert.deepEqual(group.permissions.sort(), [
    'posts.hide_content.follow',
    'posts.hide_content.like',
    'posts.hide_content.reply',
  ])
  for (const groupType of ['normal', 'special'])
    assert.equal(
      (
        await request('POST', '/api/admin/groups', {
          name: `无主权限 ${groupType}`,
          groupType,
          permissions: ['posts.review.ban'],
        })
      ).statusCode,
      400,
    )
  assert.equal(
    (
      await request('POST', '/api/admin/groups', {
        name: '普通组不能审核封禁',
        groupType: 'normal',
        permissions: ['posts.review', 'posts.review.ban'],
      })
    ).statusCode,
    400,
  )
  const reviewer = f.managers.find((m) => m.permission === 'posts.review')
  assert.ok(
    !(await request('GET', '/api/auth/me', undefined, reviewer))
      .json()
      .permissions.includes('posts.review.ban'),
  )
  await assert.rejects(
    f.query("INSERT INTO group_permissions(group_id,permission_key) VALUES($1,'posts.review.ban')", [
      legacy.json().id,
    ]),
    { code: '23514' },
  )
  const global = (await request('GET', '/api/admin/groups')).json().find((g) => g.group_type === 'global')
  for (const key of [
    'posts.review.ban',
    'posts.hide_content.reply',
    'posts.hide_content.like',
    'posts.hide_content.follow',
  ])
    await assert.rejects(
      f.query('DELETE FROM group_permissions WHERE group_id=$1 AND permission_key=$2', [global.id, key]),
      { code: '23514' },
    )
})
