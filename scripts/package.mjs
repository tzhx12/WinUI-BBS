import { cp, mkdir, mkdtemp, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const staging = await mkdtemp(join(tmpdir(), 'winui-bbs-package-'))
try {
  await chmod(staging, 0o755)
  // An allowlist keeps deployment data, credentials and local fixtures out of releases.
  for (const entry of [
    'package.json',
    'package-lock.json',
    'README.md',
    'README.en.md',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'licenses',
    'docs',
    'scripts',
    'apps/api/package.json',
    'apps/api/tsconfig.json',
    'apps/api/.env.example',
    'apps/api/src',
    'apps/api/dist',
    'apps/api/migrations',
    'apps/api/tests',
    'apps/web/package.json',
    'apps/web/src',
    'apps/web/public',
    'apps/web/dist',
    'apps/web/vite.config.ts',
    'apps/web/tsconfig.json',
    'apps/web/tsconfig.app.json',
    'apps/web/tsconfig.node.json',
    'apps/web/index.html',
    'apps/web/icons',
    'apps/web/scripts',
    'apps/web/tests',
  ]) {
    const destination = join(staging, entry)
    await mkdir(dirname(destination), { recursive: true })
    await cp(entry, destination, {
      recursive: true,
      filter: (source) => !source.split(/[\\/]/).includes('uploads'),
    })
  }
  await mkdir('release', { recursive: true })
  execFileSync(
    'tar',
    ['-czf', resolve('release/winui-bbs.tar.gz'), '-C', staging, '.'],
    { stdio: 'inherit' },
  )
  await cp('scripts/install.sh', 'release/install.sh')
} finally {
  await rm(staging, { recursive: true, force: true })
}
