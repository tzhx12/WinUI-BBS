import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const stable = (value) => /^\d+\.\d+\.\d+$/.test(value)
export function releasePlan({
  branch,
  version,
  mainVersion,
  previousVersion,
  sha,
  tags,
  mergeCount,
  mode = 'auto',
}) {
  if (!stable(version) || !stable(mainVersion))
    throw new Error('Use a stable x.y.z version in package.json')
  if (!/^[0-9a-f]{7,40}$/.test(sha)) throw new Error('Invalid commit ID')
  if (branch === 'dev') {
    if (mode !== 'auto') throw new Error('Publish releases from main only')
    return { version: `${mainVersion}-Alpha-${sha.slice(0, 7)}`, kind: 'ci' }
  }
  if (branch !== 'main') throw new Error('Release branch must be main or dev')
  if (previousVersion && version !== previousVersion) {
    const before = previousVersion.split('.').map(Number),
      after = version.split('.').map(Number)
    const direction =
      after[0] - before[0] || after[1] - before[1] || after[2] - before[2]
    if (direction <= 0) throw new Error('The stable version must increase')
  }
  const official =
    mode === 'stable' ||
    (previousVersion && version !== previousVersion) ||
    !tags.some((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
  if (official) {
    if (tags.includes(`v${version}`))
      throw new Error(`v${version} already exists`)
    return { version, kind: 'stable' }
  }
  if (!Number.isSafeInteger(mergeCount) || mergeCount < 1)
    throw new Error(
      'No main integration since the stable release; publish the initial stable version first',
    )
  return { version: `${version}-rc${mergeCount}`, kind: 'rc' }
}

export function countIntegrations(runs, baseSha, currentSha, isAncestor) {
  return new Set(
    runs
      .map((run) => run.head_sha)
      .filter(
        (sha) =>
          sha !== baseSha &&
          isAncestor(baseSha, sha) &&
          isAncestor(sha, currentSha),
      ),
  ).size
}
function mainIntegrations(currentSha) {
  const stableTags = git('tag', '--merged', currentSha, '--list', 'v*')
    .split('\n')
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
    .sort((a, b) => {
      const left = a.slice(1).split('.').map(Number),
        right = b.slice(1).split('.').map(Number)
      return right[0] - left[0] || right[1] - left[1] || right[2] - left[2]
    })
  const baseSha = git('rev-parse', `${stableTags[0]}^{commit}`)
  const runs = git(
    'for-each-ref',
    '--format=%(objectname)',
    'refs/tags/integrations/main/',
  )
    .split('\n')
    .filter(Boolean)
    .map((head_sha) => ({ head_sha }))
  return countIntegrations(runs, baseSha, currentSha, (a, b) => {
    try {
      git('merge-base', '--is-ancestor', a, b)
      return true
    } catch {
      return false
    }
  })
}

export async function stampVersion(version) {
  for (const file of [
    'package.json',
    'apps/api/package.json',
    'apps/web/package.json',
    'package-lock.json',
  ]) {
    const value = JSON.parse(await readFile(file, 'utf8'))
    value.version = version
    if (value.packages)
      for (const key of ['', 'apps/api', 'apps/web'])
        value.packages[key].version = version
    await writeFile(file, JSON.stringify(value, null, 2) + '\n')
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv[2] === 'set') {
    const version = process.argv[3]
    if (!stable(version)) throw new Error('Expected x.y.z')
    await stampVersion(version)
  } else {
    const version = JSON.parse(await readFile('package.json', 'utf8')).version
    const branch =
      process.env.GITHUB_REF_NAME || git('branch', '--show-current')
    const mainVersion = JSON.parse(
      git('show', 'origin/main:package.json'),
    ).version
    let previousVersion
    if (process.env.BEFORE_SHA && !/^0+$/.test(process.env.BEFORE_SHA))
      previousVersion = JSON.parse(
        git('show', `${process.env.BEFORE_SHA}:package.json`),
      ).version
    const sha = git('rev-parse', 'HEAD'),
      mode = process.env.RELEASE_MODE || 'auto'
    const tags = git('tag', '--list').split('\n')
    const mergeCount =
      branch === 'main' &&
      mode === 'auto' &&
      (!previousVersion || version === previousVersion) &&
      tags.some((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
        ? mainIntegrations(sha)
        : undefined
    const plan = releasePlan({
      branch,
      version,
      mainVersion,
      previousVersion,
      sha,
      tags,
      mergeCount,
      mode,
    })
    await stampVersion(plan.version)
    if (process.env.GITHUB_OUTPUT)
      await writeFile(
        process.env.GITHUB_OUTPUT,
        `version=${plan.version}\nkind=${plan.kind}\n`,
        { flag: 'a' },
      )
    console.log(JSON.stringify(plan))
  }
}
