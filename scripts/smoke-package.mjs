import 'dotenv/config'
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Pool } from 'pg'

const exec = promisify(execFile)
const version = JSON.parse(await readFile('package.json', 'utf8')).version
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl || !process.env.npm_execpath)
  throw new Error('Run npm run package:verify with DATABASE_URL configured')
const root = await mkdtemp(join(tmpdir(), 'forum-package-'))
const schema = `forum_release_${randomUUID().replaceAll('-', '')}`
const pool = new Pool({ connectionString: databaseUrl })
const installEnv = { ...process.env }
for (const key of Object.keys(installEnv))
  if (
    /^npm_config_(allow_scripts|local_prefix|workspace|workspaces|include_workspace_root|prefix)$/i.test(
      key,
    )
  )
    delete installEnv[key]
let server
try {
  await pool.query(`CREATE SCHEMA ${schema}`)
  await exec('tar', ['-xzf', resolve('release/winui-bbs.tar.gz'), '-C', root])
  await exec(
    process.execPath,
    [
      process.env.npm_execpath,
      'ci',
      '--omit=dev',
      '--workspace=apps/api',
      '--include-workspace-root=false',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ],
    { cwd: root, env: installEnv, timeout: 180000, maxBuffer: 4 * 1024 * 1024 },
  )
  const connection = new URL(databaseUrl)
  connection.searchParams.set('options', `-c search_path=${schema},public`)
  const logs = []
  server = spawn(process.execPath, ['dist/server.js'], {
    cwd: join(root, 'apps/api'),
    env: {
      ...process.env,
      DATABASE_URL: connection.toString(),
      PORT: '0',
      HOST: '127.0.0.1',
      FORUM_WEB_ROOT: join(root, 'apps/web/dist'),
      FORUM_UPDATE_DIR: '',
    },
    windowsHide: true,
  })
  let origin
  server.stdout.on('data', (chunk) => {
    const text = chunk.toString()
    logs.push(text)
    origin ||= /Server listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(text)?.[1]
  })
  server.stderr.on('data', (chunk) => logs.push(chunk.toString()))
  for (let attempt = 0; !origin && attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error(logs.join(''))
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  assert.ok(origin, logs.join(''))
  const health = await fetch(`${origin}/api/health`)
  assert.equal(health.status, 200)
  assert.equal((await health.json()).version, version)
  const response = await fetch(origin),
    html = await response.text()
  assert.equal(response.status, 200)
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(
    (match) => match[1],
  )
  assert.ok(assets.length >= 2)
  for (const asset of assets)
    assert.equal((await fetch(origin + asset)).status, 200, asset)
  assert.equal((await fetch(`${origin}/api/admin/updates`)).status, 401)
  assert.equal(
    JSON.parse(await readFile(join(root, 'apps/api/package.json'), 'utf8'))
      .version,
    version,
  )
  console.log(
    `Production package ${version}: API-only dependencies, compiled startup, migrations, health, frontend assets and update authorization passed`,
  )
} finally {
  if (server && server.exitCode === null) {
    server.kill()
    await new Promise((resolve) => server.once('exit', resolve))
  }
  await pool.query(`DROP SCHEMA ${schema} CASCADE`)
  await pool.end()
  await rm(root, { recursive: true, force: true })
}
