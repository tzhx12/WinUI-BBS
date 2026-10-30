import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  mkdtemp,
  mkdir,
  readlink,
  rm,
  writeFile,
  symlink,
} from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  activate,
  switchRelease,
  validateArchive,
  backupDatabase,
  isMainModule,
} from '../update.mjs'

test(
  'systemd symlink entrypoint runs as the main module',
  { skip: process.platform === 'win32' },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'forum-entrypoint-'))
    try {
      const script = join(root, 'real.mjs'),
        link = join(root, 'current.mjs')
      await writeFile(script, '')
      await symlink(script, link)
      assert.equal(await isMainModule(pathToFileURL(script).href, link), true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)

test('backup supplies libpq connection explicitly and keeps password out of command arguments', async () => {
  const root = await mkdtemp(join(tmpdir(), 'forum-backup-'))
  const file = join(root, 'database.dump')
  try {
    await backupDatabase(
      file,
      'postgresql://forum:encoded%40password@127.0.0.1:5432/forum?sslmode=require',
      async (name, args, options) => {
        assert.equal(name, 'pg_dump')
        assert.ok(args.includes('--dbname'))
        assert.equal(
          args.at(-1),
          'postgresql://forum@127.0.0.1:5432/forum?sslmode=require',
        )
        assert.equal(options.env.PGPASSWORD, 'encoded@password')
        await writeFile(file, 'fixture')
      },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects escaping archive paths', () => {
  validateArchive('./\n./apps/api/dist/server.js\n')
  assert.throws(() => validateArchive('../outside'), /Invalid archive/)
  assert.throws(() => validateArchive('/etc/passwd'), /Invalid archive/)
})
test(
  'failed health check restores the old program and restarts it',
  {
    skip:
      process.platform === 'win32'
        ? 'Linux symlink activation is tested by Actions'
        : false,
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'forum-activate-'))
    const old = join(root, 'old'),
      next = join(root, 'next'),
      calls = []
    try {
      await mkdir(old)
      await mkdir(next)
      await switchRelease(root, old)
      await assert.rejects(
        activate(
          root,
          next,
          '0.2.3',
          async (name, args) => calls.push([name, ...args]),
          async () => {
            throw new Error('unhealthy')
          },
        ),
        /已切回旧程序/,
      )
      assert.equal(await readlink(join(root, 'current')), old)
      assert.deepEqual(calls, [
        ['systemctl', 'start', 'winui-bbs'],
        ['systemctl', 'stop', 'winui-bbs'],
        ['systemctl', 'start', 'winui-bbs'],
      ])
      await activate(
        root,
        next,
        '0.2.3',
        async () => {},
        async () => {},
      )
      assert.equal(await readlink(join(root, 'current')), next)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)
