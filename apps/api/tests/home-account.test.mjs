import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createManagementFixture } from './helpers/management-fixture.mjs'
import { auditSummary } from '../src/auditSummary.ts'

let f, member
before(async () => {
  f = await createManagementFixture()
  const response = await f.request('POST', '/api/auth/register', {
    username: 'profile_member',
    displayName: '资料验收成员',
    email: 'profile@example.test',
    password: f.password,
  })
  assert.equal(response.statusCode, 201, response.body)
  member = response.json()
})
after(async () => {
  if (f) await f.close()
})

test('home settings persist separately from site settings and require settings.manage', async () => {
  const url = '/api/admin/home-settings'
  const content = {
    homeTitle: '新的社区首页',
    homeDescription: '首页说明',
    popularTitle: '正在热议',
    popularDescription: '',
  }
  assert.equal((await f.request('GET', url)).statusCode, 401)
  assert.equal((await f.request('PATCH', url, content, member)).statusCode, 403)
  for (const user of f.managers)
    assert.equal(
      (await f.request('GET', url, undefined, user)).statusCode,
      user.permission === 'settings.manage' ? 200 : 403,
    )
  assert.equal((await f.request('PATCH', url, { ...content, homeTitle: ' ' }, f.owner)).statusCode, 400)
  assert.equal(
    (await f.request('PATCH', url, { ...content, popularDescription: 'a'.repeat(501) }, f.owner))
      .statusCode,
    400,
  )
  assert.equal((await f.request('PATCH', url, content, f.owner)).statusCode, 200)
  assert.deepEqual((await f.request('GET', url, undefined, f.owner)).json().home_content, content)
  assert.deepEqual((await f.request('GET', '/api/site')).json().home_content, content)
  await f.request('PATCH', '/api/admin/settings', { siteTitle: '站点名称' }, f.owner)
  assert.deepEqual((await f.request('GET', '/api/site')).json().home_content, content)
})

test('public profile includes UUID, level, experience, active groups and followers without private account data', async () => {
  await f.request('PUT', `/api/users/${member.user.uid}/follow`, undefined, f.owner)
  await f.query('UPDATE users SET experience=345,level_offset=2 WHERE uid=$1', [member.user.uid])
  const expired = (
    await f.query("INSERT INTO user_groups(name,group_type) VALUES('过期组','temporary') RETURNING id")
  ).rows[0]
  await f.query(
    "INSERT INTO group_memberships(user_uid,group_id,expires_at) VALUES($1,$2,NOW()-INTERVAL '1 day')",
    [member.user.uid, expired.id],
  )
  const publicUser = (await f.request('GET', `/api/users/${member.user.uid}`)).json().user
  const own = (await f.request('GET', '/api/auth/me', undefined, member)).json()
  assert.equal(publicUser.uuid, own.uuid)
  assert.equal(publicUser.experience, 345)
  assert.equal(publicUser.level, own.level)
  assert.equal(publicUser.follower_count, 1)
  assert.equal(own.followerCount, 1)
  assert.deepEqual(publicUser.groups, own.groups)
  assert.ok(!publicUser.groups.some((g) => g.id === expired.id))
  assert.ok(publicUser.groups.length > 0)
  for (const field of ['email', 'password_hash', 'permissions', 'banned_until', 'level_offset'])
    assert.ok(!(field in publicUser), field)
  assert.equal((await f.request('GET', '/api/users/99999999')).statusCode, 404)
})

test('avatars stay out of the personal gallery including explicit filters, but remain in the admin gallery and quota', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWioAAAAASUVORK5CYII=',
    'base64',
  )
  const boundary = 'avatar-gallery-boundary'
  const upload = await f.app.inject({
    method: 'POST',
    url: '/api/me/avatar',
    headers: {
      authorization: `Bearer ${member.token}`,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="avatar.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  })
  assert.equal(upload.statusCode, 201, upload.body)
  for (const suffix of ['', '?collection=avatar'])
    assert.equal((await f.request('GET', `/api/me/media${suffix}`, undefined, member)).json().length, 0)
  const assets = (await f.request('GET', '/api/admin/media?collection=avatar', undefined, f.owner)).json()
  assert.equal(assets.length, 1)
  assert.equal(assets[0].url, upload.json().avatarUrl)
  assert.equal(
    (await f.request('GET', '/api/me/media-usage', undefined, member)).json().usedBytes,
    png.length,
  )
  assert.equal(
    (await f.request('GET', '/api/auth/me', undefined, member)).json().avatarUrl,
    assets[0].url,
  )
})

test('audit details describe edits and preserve deleted content summaries', async () => {
  const category = (await f.request('GET', '/api/categories')).json()[0]
  const created = await f.request(
    'POST',
    '/api/posts',
    {
      categoryId: category.id,
      title: '删除内容摘要验收',
      body: {
        blocks: [
          {
            type: 'paragraph',
            data: { text: '这是一段超过十个字的<b>正文摘要</b>，应当保留可读内容。' },
          },
        ],
      },
    },
    f.owner,
  )
  assert.equal(created.statusCode, 201, created.body)
  const id = created.json().post.id
  assert.equal((await f.request('DELETE', `/api/admin/posts/${id}`, undefined, f.owner)).statusCode, 200)
  const events = (await f.request('GET', '/api/admin/audit', undefined, f.owner)).json()
  const deleted = events.find((event) => event.action_key === 'post.delete' && event.target_id === id)
  assert.equal(deleted.summary.action, '删除帖子')
  assert.ok(deleted.summary.lines.includes('标题：删除内容摘要验收'))
  assert.ok(deleted.summary.lines.some((line) => line.includes('超过十个字的正文摘要')))
  assert.ok(deleted.summary.lines.every((line) => !line.includes('<b>')))
  const settings = events.find((event) => event.action_key === 'home.settings.update')
  assert.ok(settings.summary.lines.includes('热门讨论说明：已清空'))
  assert.ok(events.every((event) => event.summary.action && event.summary.lines.length))
})

test('audit formatter translates nested values, permissions and historical empty records', () => {
  const entry = {
    action_key: 'group.update',
    target_type: 'group',
    target_id: '12',
    details: {
      isJoinable: true,
      groupType: 'public',
      permissions: ['posts.create'],
      mediaLimits: { imageBytes: 100 },
      expiresAt: null,
    },
  }
  const summary = auditSummary(entry)
  assert.ok(summary.lines.includes('允许自行加入：是'))
  assert.ok(summary.lines.includes('用户组类型：公开用户组'))
  assert.ok(summary.lines.includes('权限：发帖'))
  assert.ok(summary.lines.includes('图床配额 · 单图上限（字节）：100'))
  assert.ok(summary.lines.includes('到期时间：永久'))
  assert.match(auditSummary({ ...entry, details: {} }).lines[0], /历史记录未保存内容摘要/)
})
