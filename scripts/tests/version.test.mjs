import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { releasePlan, stampVersion, countIntegrations } from '../version.mjs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const input = {
  branch: 'main',
  version: '0.2.2',
  mainVersion: '0.2.2',
  previousVersion: '0.2.2',
  sha: 'abcdef123456789',
  tags: ['v0.2.2'],
  mergeCount: 1,
}
test('dev CI uses main base even when dev stages a future stable version', () => {
  assert.deepEqual(releasePlan({ ...input, branch: 'dev', version: '0.3.0' }), {
    version: '0.2.2-Alpha-abcdef1',
    kind: 'ci',
  })
})
test('unchanged main version starts and increments RC count numerically', () => {
  assert.equal(releasePlan(input).version, '0.2.2-rc1')
  assert.equal(
    releasePlan({
      ...input,
      mergeCount: 11,
      tags: [...input.tags, 'v0.2.2-rc2', 'v0.2.2-rc10', 'v0.2.1-rc100'],
    }).version,
    '0.2.2-rc11',
  )
})
test('explicit version change produces a stable release and resets the RC sequence', () => {
  assert.deepEqual(releasePlan({ ...input, version: '0.3.0' }), {
    version: '0.3.0',
    kind: 'stable',
  })
  assert.equal(
    releasePlan({
      ...input,
      version: '0.3.0',
      previousVersion: '0.3.0',
      tags: ['v0.2.2-rc12', 'v0.3.0'],
    }).version,
    '0.3.0-rc1',
  )
})
test('bootstrap is main only, and stable versions cannot be overwritten or decreased', () => {
  assert.equal(releasePlan({ ...input, tags: [] }).kind, 'stable')
  assert.throws(
    () => releasePlan({ ...input, version: '0.2.1' }),
    /must increase/,
  )
  assert.equal(
    releasePlan({ ...input, mode: 'stable', tags: [] }).kind,
    'stable',
  )
  assert.throws(
    () => releasePlan({ ...input, mode: 'stable' }),
    /already exists/,
  )
  assert.throws(
    () => releasePlan({ ...input, branch: 'dev', mode: 'stable' }),
    /main only/,
  )
})
test('integration count includes failed runs, deduplicates reruns and excludes future commits', () => {
  const history = ['base', 'a', 'b', 'c']
  const runs = [
    { head_sha: 'base' },
    { head_sha: 'a', conclusion: 'failure' },
    { head_sha: 'a', conclusion: 'success' },
    { head_sha: 'b' },
    { head_sha: 'c' },
  ]
  assert.equal(
    countIntegrations(
      runs,
      'base',
      'b',
      (a, b) => history.indexOf(a) <= history.indexOf(b),
    ),
    2,
  )
})
test('stamping updates only project versions and keeps dependency versions intact', async () => {
  const original = process.cwd(),
    directory = await mkdtemp(join(tmpdir(), 'forum-version-'))
  try {
    for (const path of ['apps/api', 'apps/web'])
      await mkdir(join(directory, path), { recursive: true })
    for (const file of [
      'package.json',
      'apps/api/package.json',
      'apps/web/package.json',
    ])
      await writeFile(
        join(directory, file),
        JSON.stringify({
          version: '0.2.2',
          dependencies: { example: '1.2.3' },
        }),
      )
    await writeFile(
      join(directory, 'package-lock.json'),
      JSON.stringify({
        version: '0.2.2',
        packages: {
          '': { version: '0.2.2' },
          'apps/api': { version: '0.2.2' },
          'apps/web': { version: '0.2.2' },
          'node_modules/example': { version: '1.2.3' },
        },
      }),
    )
    process.chdir(directory)
    await stampVersion('0.2.2-Alpha-abcdef1')
    const lock = JSON.parse(await readFile('package-lock.json', 'utf8'))
    assert.equal(lock.packages['apps/api'].version, '0.2.2-Alpha-abcdef1')
    assert.equal(lock.packages['node_modules/example'].version, '1.2.3')
    assert.equal(
      JSON.parse(await readFile('apps/web/package.json')).version,
      '0.2.2-Alpha-abcdef1',
    )
  } finally {
    process.chdir(original)
    await rm(directory, { recursive: true, force: true })
  }
})

test('CLI derives RC counts from Git integration tags and stamps deployable manifests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'forum-version-git-'))
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  const script = fileURLToPath(new URL('../version.mjs', import.meta.url))
  try {
    for (const path of ['apps/api', 'apps/web'])
      await mkdir(join(directory, path), { recursive: true })
    for (const file of [
      'package.json',
      'apps/api/package.json',
      'apps/web/package.json',
    ])
      await writeFile(
        join(directory, file),
        JSON.stringify({ version: '0.2.2' }),
      )
    await writeFile(
      join(directory, 'package-lock.json'),
      JSON.stringify({
        version: '0.2.2',
        packages: {
          '': { version: '0.2.2' },
          'apps/api': { version: '0.2.2' },
          'apps/web': { version: '0.2.2' },
        },
      }),
    )
    git('init')
    git('config', 'user.name', 'Release test')
    git('config', 'user.email', 'release@example.test')
    git('add', '.')
    git('commit', '-m', 'stable')
    git('tag', 'v0.2.2')
    const base = git('rev-parse', 'HEAD')
    git('update-ref', 'refs/remotes/origin/main', base)
    for (let i = 1; i <= 2; i++) {
      await writeFile(join(directory, 'change.txt'), String(i))
      git('add', '.')
      git('commit', '-m', `integration ${i}`)
      git('tag', `integrations/main/${git('rev-parse', 'HEAD')}`)
    }
    const output = execFileSync(process.execPath, [script], {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_REF_NAME: 'main',
        BEFORE_SHA: base,
        RELEASE_MODE: 'auto',
        GITHUB_OUTPUT: '',
      },
    })
    assert.deepEqual(JSON.parse(output), { version: '0.2.2-rc2', kind: 'rc' })
    assert.equal(
      JSON.parse(
        await readFile(join(directory, 'apps/api/package.json'), 'utf8'),
      ).version,
      '0.2.2-rc2',
    )
    execFileSync(process.execPath, [script, 'set', '0.3.0'], { cwd: directory })
    const alpha = execFileSync(process.execPath, [script], {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_REF_NAME: 'dev',
        BEFORE_SHA: base,
        RELEASE_MODE: 'auto',
        GITHUB_OUTPUT: '',
      },
    })
    assert.equal(
      JSON.parse(alpha).version,
      `0.2.2-Alpha-${git('rev-parse', '--short=7', 'HEAD')}`,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
