import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createManagementFixture } from './helpers/management-fixture.mjs'
import { compareVersions, selectRelease, parseVersion } from '../src/release.ts'
import { currentVersion } from '../src/version.ts'

let f, directory, checkAutomaticUpdates
const originalFetch = globalThis.fetch
const release = (version, prerelease = false) => ({
  tag_name: `v${version}`,
  prerelease,
  draft: false,
  body: 'Release notes',
  published_at: '2026-10-30T12:00:00Z',
  assets: [
    {
      name: 'winui-bbs.tar.gz',
      browser_download_url: `https://github.com/tzhx12/WinUI-BBS/releases/download/v${version}/winui-bbs.tar.gz`,
    },
  ],
})
before(async () => {
  delete process.env.FORUM_UPDATE_DIR
  f = await createManagementFixture()
  ;({ checkAutomaticUpdates } = await import('../src/routes/updates.ts'))
  directory = await mkdtemp(join(tmpdir(), 'forum-update-'))
})
after(async () => {
  globalThis.fetch = originalFetch
  delete process.env.FORUM_UPDATE_DIR
  await f?.close()
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('release channels filter drafts, Alpha, legacy tags and mismatched flags; RCs sort numerically', () => {
  const items = [
    release('0.2.2'),
    release('0.3.0-rc.2', true),
    release('0.3.0-rc.10', true),
    release('0.3.0-Alpha.abcdef1', true),
    release('0.2.2-rc1', true),
    release('0.6.0-rc.1'),
    release('0.7.0', true),
    { ...release('0.8.0'), draft: true },
    { ...release('0.9.0'), assets: [] },
  ]
  assert.equal(selectRelease(items, 'releases').version, '0.2.2')
  assert.equal(selectRelease(items, 'pre-releases').version, '0.3.0-rc.10')
  items.push(release('0.3.0'))
  assert.equal(selectRelease(items, 'releases').version, '0.3.0')
  assert.equal(selectRelease(items, 'pre-releases').version, '0.3.0')
})
test('SemVer places the next pre-release above the current stable and below its own stable', () => {
  const versions = [
    '0.2.2',
    '0.3.0-Alpha.abcdef1',
    '0.3.0-rc.1',
    '0.3.0-rc.2',
    '0.3.0-rc.10',
    '0.3.0',
    '0.4.0-rc.1',
    '0.4.0',
  ]
  for (let i = 1; i < versions.length; i++)
    assert.ok(compareVersions(versions[i], versions[i - 1]) > 0, versions[i])
  assert.equal(compareVersions('0.3.0+build.1', '0.3.0+build.2'), 0)
  assert.equal(parseVersion('0.3.0-rc.01'), null)
  // Existing installations keep a readable current version after the rule change.
  assert.ok(compareVersions('0.3.0', '0.2.2-rc1') > 0)
  assert.ok(compareVersions('0.3.0', '0.2.2-Alpha-abcdef1') > 0)
})
test('all update endpoints require settings.manage', async () => {
  const user = f.managers.find((m) => m.permission === 'users.manage')
  for (const [method, url, body] of [
    ['GET', '/api/admin/updates'],
    ['PATCH', '/api/admin/updates', { automatic: false, channel: 'releases' }],
    ['POST', '/api/admin/updates/check'],
    ['POST', '/api/admin/updates/install'],
  ]) {
    assert.equal((await f.request(method, url, body)).statusCode, 401)
    assert.equal((await f.request(method, url, body, user)).statusCode, 403)
  }
})
test('source deployments can check and select channels; auto install needs the service', async () => {
  const status = await f.request(
    'GET',
    '/api/admin/updates',
    undefined,
    f.owner,
  )
  assert.equal(status.json().managed, false)
  assert.deepEqual(status.json().settings, {
    automatic: false,
    channel: 'releases',
  })
  assert.equal(
    (
      await f.request(
        'PATCH',
        '/api/admin/updates',
        { automatic: true, channel: 'releases' },
        f.owner,
      )
    ).statusCode,
    409,
  )
  assert.equal(
    (await f.request('POST', '/api/admin/updates/install', undefined, f.owner))
      .statusCode,
    409,
  )
  assert.equal(
    (
      await f.request(
        'PATCH',
        '/api/admin/updates',
        { automatic: false, channel: 'ci' },
        f.owner,
      )
    ).statusCode,
    400,
  )
})
test('checking reports no release, available update and GitHub failures without losing settings', async () => {
  await f.request(
    'PATCH',
    '/api/admin/updates',
    { automatic: false, channel: 'pre-releases' },
    f.owner,
  )
  const next = `${Number(currentVersion.split('.')[0]) + 1}.0.0-rc.1`
  globalThis.fetch = async () => Response.json([release(next, true)])
  let result = await f.request(
    'POST',
    '/api/admin/updates/check',
    undefined,
    f.owner,
  )
  assert.equal(result.statusCode, 200)
  assert.equal(result.json().available, true)
  globalThis.fetch = async () => Response.json([])
  assert.equal(
    (
      await f.request('POST', '/api/admin/updates/check', undefined, f.owner)
    ).json().latest,
    null,
  )
  globalThis.fetch = async () => new Response('', { status: 403 })
  assert.equal(
    (await f.request('POST', '/api/admin/updates/check', undefined, f.owner))
      .statusCode,
    502,
  )
  assert.equal(
    (await f.request('GET', '/api/admin/updates', undefined, f.owner)).json()
      .settings.channel,
    'pre-releases',
  )
})
test('managed deployment persists automatic settings, queues the channel, and exposes results', async () => {
  process.env.FORUM_UPDATE_DIR = directory
  await writeFile(join(directory, 'enabled'), '')
  const saved = await f.request(
    'PATCH',
    '/api/admin/updates',
    { automatic: true, channel: 'pre-releases' },
    f.owner,
  )
  assert.equal(saved.statusCode, 200, saved.body)
  const queued = await f.request(
    'POST',
    '/api/admin/updates/install',
    undefined,
    f.owner,
  )
  assert.equal(queued.statusCode, 202)
  const request = JSON.parse(await readFile(join(directory, 'request.json')))
  assert.equal(request.channel, 'pre-releases')
  assert.equal(request.id, queued.json().id)
  await writeFile(
    join(directory, 'status.json'),
    JSON.stringify({ state: 'failed', message: '下载失败' }),
  )
  const status = (
    await f.request('GET', '/api/admin/updates', undefined, f.owner)
  ).json()
  assert.equal(status.settings.automatic, true)
  assert.equal(status.job.state, 'failed')
  assert.equal(
    (
      await f.query(
        "SELECT COUNT(*)::int AS count FROM audit_events WHERE action_key LIKE 'site.updates.%'",
      )
    ).rows[0].count,
    3,
  )
})
test('automatic checks queue enabled channels and stop after disabling', async () => {
  await rm(join(directory, 'request.json'), { force: true })
  const id = await checkAutomaticUpdates()
  assert.equal(
    JSON.parse(await readFile(join(directory, 'request.json'))).id,
    id,
  )
  await f.request(
    'PATCH',
    '/api/admin/updates',
    { automatic: false, channel: 'releases' },
    f.owner,
  )
  await rm(join(directory, 'request.json'))
  assert.equal(await checkAutomaticUpdates(), undefined)
  await assert.rejects(readFile(join(directory, 'request.json')), {
    code: 'ENOENT',
  })
})
