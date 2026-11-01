import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const revision = '692d0a76dad3fa92515bc50db44ed626d83b695e'
const version = '0.2.0-forum.1'
const root = fileURLToPath(new URL('../', import.meta.url))
const destination = join(root, 'vendor', 'winuionweb')
const staging = await mkdtemp(join(tmpdir(), 'forum-winuionweb-'))
const run = (command, args, cwd = staging) =>
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32' && command === 'npm',
  })

try {
  const repository = process.argv[2] ?? join(staging, 'upstream')
  if (!process.argv[2]) {
    run('git', [
      'clone',
      '--quiet',
      '--no-checkout',
      'https://github.com/Furry-Xiyi/WinUIonWeb.git',
      repository,
    ])
  }
  run('git', [
    '-C',
    repository,
    'archive',
    '--format=tar',
    `--output=${join(staging, 'source.tar')}`,
    revision,
    'WinUIonWeb',
  ])
  run('tar', ['-xf', 'source.tar'])
  const source = join(staging, 'WinUIonWeb')
  const patches = ['native-contextmenu.patch', 'treeview-touch-scroll.patch']
  for (const patch of patches)
    run('git', ['apply', join(destination, patch)], source)
  // Keep the upstream lock intact while installing its exact build toolchain.
  run('npm', ['ci', '--no-audit', '--no-fund'], source)
  const path = join(source, 'package.json')
  const metadata = JSON.parse(await readFile(path, 'utf8'))
  metadata.version = version
  metadata.forumUpstream = {
    repository: 'https://github.com/Furry-Xiyi/WinUIonWeb',
    revision,
    patches,
  }
  // Ship corresponding library source and build inputs, but no Gallery assets/fonts.
  metadata.files.push(
    'src/components',
    'src/styles',
    'src/utils',
    'src/index.ts',
    'src/systemAccentColor.ts',
    'src/shims-vue.d.ts',
    'scripts/finalize-library-types.mjs',
    'scripts/check-library-package.mjs',
    'vite.lib.config.ts',
    'tsconfig*.json',
    'env.d.ts',
    'postcss.config.cjs',
    'build-package-lock.json',
  )
  await writeFile(path, JSON.stringify(metadata, null, 2) + '\n')
  // npm pack excludes package-lock.json; include the build lock under an explicit name.
  const lock = JSON.parse(
    await readFile(join(source, 'package-lock.json'), 'utf8'),
  )
  lock.version = lock.packages[''].version = version
  await writeFile(
    join(source, 'build-package-lock.json'),
    JSON.stringify(lock, null, 2) + '\n',
  )
  await mkdir(destination, { recursive: true })
  run('npm', ['pack', '--pack-destination', destination], source)
} finally {
  await rm(staging, { recursive: true, force: true })
}
