import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  access,
  mkdir,
  readFile,
  writeFile,
  rename,
  symlink,
  readlink,
  rm,
  chmod,
  lstat,
  realpath,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const exec = promisify(execFile)
export async function command(file, args, options = {}) {
  return exec(file, args, {
    timeout: 10 * 60 * 1000,
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  })
}
export async function switchRelease(root, target) {
  const temporary = join(root, 'current.next')
  await rm(temporary, { force: true })
  await symlink(target, temporary)
  await rename(temporary, join(root, 'current'))
}
export async function activate(
  root,
  target,
  version,
  run = command,
  healthy = healthCheck,
) {
  const previous = await readlink(join(root, 'current'))
  try {
    await switchRelease(root, target)
    await run('systemctl', ['start', 'winui-bbs'])
    await healthy(version)
  } catch (error) {
    await run('systemctl', ['stop', 'winui-bbs'])
    await switchRelease(root, previous)
    await run('systemctl', ['start', 'winui-bbs'])
    throw new Error(
      '新版本启动失败，已切回旧程序。数据库备份保存在 shared/backups；迁移已执行时请检查数据库兼容性。',
      { cause: error },
    )
  }
}
export async function healthCheck(version) {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${process.env.PORT || 4000}/api/health`,
        { signal: AbortSignal.timeout(2000) },
      )
      if (response.ok && (await response.json()).version === version) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error('New version health check failed')
}
export function validateArchive(list) {
  for (const path of list.trim().split('\n')) {
    if (path.startsWith('/') || path.split('/').includes('..'))
      throw new Error('Invalid archive path')
  }
}
export async function isMainModule(moduleUrl, argument) {
  return (
    !!argument &&
    moduleUrl === pathToFileURL(await realpath(resolve(argument))).href
  )
}
export async function backupDatabase(file, connectionString, run = command) {
  const connection = new URL(connectionString)
  const env = { ...process.env }
  if (connection.password) {
    env.PGPASSWORD = decodeURIComponent(connection.password)
    connection.password = ''
  }
  await run(
    'pg_dump',
    ['--format=custom', '--file', file, '--dbname', connection.toString()],
    { env },
  )
  await chmod(file, 0o600)
}
async function update() {
  const { compareVersions, fetchRelease } =
    await import('../apps/api/dist/release.js')
  const root = '/opt/winui-bbs',
    control = join(root, 'shared/update')
  let id
  const state = async (state, message, version) => {
    const temporary = join(root, 'status.tmp')
    await writeFile(
      temporary,
      JSON.stringify({
        id,
        state,
        message,
        version,
        updatedAt: new Date().toISOString(),
      }),
      { mode: 0o644 },
    )
    await rename(temporary, join(control, 'status.json'))
  }
  // Consume the request before network access; systemd serializes this service.
  const requestPath = join(control, 'request.json')
  try {
    await access(requestPath)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  const processing = join(root, 'processing.json')
  await rename(requestPath, processing)
  let archive
  try {
    const requestStat = await lstat(processing)
    if (!requestStat.isFile() || requestStat.size > 1024)
      throw new Error('Invalid update request')
    const request = JSON.parse(await readFile(processing, 'utf8'))
    const { channel } = request
    id = request.id
    if (!['releases', 'pre-releases'].includes(channel))
      throw new Error('Invalid update channel')
    await state('checking', '正在检查更新')
    const latest = await fetchRelease(channel)
    const current = JSON.parse(
      await readFile(join(root, 'current/package.json'), 'utf8'),
    ).version
    if (!latest || compareVersions(latest.version, current) <= 0) {
      await state('current', '已是所选渠道的最新版本', current)
      return
    }
    const target = join(root, 'releases', latest.version)
    await mkdir(target, { recursive: true })
    archive = join(root, 'releases', `download-${latest.version}.tar.gz`)
    await state('installing', '正在下载并安装依赖', latest.version)
    await command('curl', [
      '--fail',
      '--location',
      '--retry',
      '3',
      '--proto',
      '=https',
      '--output',
      archive,
      latest.assetUrl,
    ])
    validateArchive((await command('tar', ['-tzf', archive])).stdout)
    // Releases are built by this repository; reject symlinks and hardlinks before extraction.
    const listing = (await command('tar', ['-tvzf', archive])).stdout
    if (listing.split('\n').some((line) => /^[lh]/.test(line)))
      throw new Error('Archive contains links')
    await command('tar', ['-xzf', archive, '--no-same-owner', '-C', target])
    await chmod(target, 0o755)
    const manifest = JSON.parse(
      await readFile(join(target, 'package.json'), 'utf8'),
    )
    if (manifest.version !== latest.version)
      throw new Error('Release version does not match its tag')
    await command(
      'npm',
      [
        'ci',
        '--omit=dev',
        '--workspace=apps/api',
        '--include-workspace-root=false',
        '--ignore-scripts',
      ],
      { cwd: target },
    )
    await symlink(
      join(root, 'shared/data'),
      join(target, 'apps/api/data'),
    ).catch((error) => {
      if (error.code !== 'EEXIST') throw error
    })
    await state('installing', '正在备份数据库并重启站点', latest.version)
    await command('systemctl', ['stop', 'winui-bbs'])
    try {
      const backups = join(root, 'shared/backups')
      await mkdir(backups, { recursive: true, mode: 0o700 })
      const backup = join(backups, `${Date.now()}-${current}.dump`)
      await backupDatabase(backup, process.env.DATABASE_URL)
    } catch (error) {
      await command('systemctl', ['start', 'winui-bbs'])
      throw error
    }
    await activate(root, target, latest.version)
    await state('complete', '更新已完成', latest.version)
  } catch (error) {
    await state('failed', error.message)
    process.exitCode = 1
  } finally {
    await rm(processing, { force: true })
    if (archive) await rm(archive, { force: true })
  }
}
if (await isMainModule(import.meta.url, process.argv[1])) await update()
