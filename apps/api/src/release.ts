export const releaseRepository = 'tzhx12/WinUI-BBS'
export const releaseAssetName = 'winui-bbs.tar.gz'
export type UpdateChannel = 'releases' | 'pre-releases'
export type Release = {
  version: string
  url: string
  publishedAt: string
  notes: string
  prerelease: boolean
  assetUrl: string
}

export function parseVersion(value: string) {
  const match =
    /^v?(\d+)\.(\d+)\.(\d+)(?:-(rc(\d+)|Alpha-([0-9a-f]{7,40})))?$/.exec(value)
  // RCs in this project follow the stable base (0.2.2 -> 0.2.2-rc1).
  return match
    ? {
        base: match.slice(1, 4).map(Number),
        stage: match[6] ? 0 : match[5] ? 2 : 1,
        rc: Number(match[5] || 0),
      }
    : null
}

export function compareVersions(a: string, b: string) {
  const left = parseVersion(a),
    right = parseVersion(b)
  if (!left || !right) throw new Error('无法识别版本号')
  for (let i = 0; i < 3; i++) {
    const difference = left.base[i]! - right.base[i]!
    if (difference) return difference
  }
  return left.stage - right.stage || left.rc - right.rc
}

export function selectRelease(
  items: unknown[],
  channel: UpdateChannel,
): Release | null {
  const releases: Release[] = []
  for (const item of items) {
    const value = item as Record<string, any>
    const parsed =
      typeof value.tag_name === 'string' && parseVersion(value.tag_name)
    if (
      !parsed ||
      parsed.stage === 0 ||
      value.draft ||
      (channel === 'releases' && value.prerelease)
    )
      continue
    if (value.prerelease !== (parsed.stage === 2)) continue
    const version = value.tag_name.replace(/^v/, '')
    const asset =
      Array.isArray(value.assets) &&
      value.assets.find((a: any) => a.name === releaseAssetName)
    const assetUrl = `https://github.com/${releaseRepository}/releases/download/v${version}/${releaseAssetName}`
    if (!asset || asset.browser_download_url !== assetUrl) continue
    releases.push({
      version,
      url: `https://github.com/${releaseRepository}/releases/tag/v${version}`,
      publishedAt: value.published_at,
      notes: String(value.body || ''),
      prerelease: value.prerelease,
      assetUrl,
    })
  }
  return (
    releases.sort((a, b) => compareVersions(b.version, a.version))[0] || null
  )
}

export async function fetchRelease(
  channel: UpdateChannel,
): Promise<Release | null> {
  const items: unknown[] = []
  // Paginate: a busy RC channel must not hide the latest stable release.
  for (let page = 1; ; page++) {
    const response = await fetch(
      `https://api.github.com/repos/${releaseRepository}/releases?per_page=100&page=${page}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'WinUI-BBS updater',
        },
        signal: AbortSignal.timeout(20_000),
      },
    )
    if (!response.ok)
      throw new Error(
        `GitHub 检查更新失败（HTTP ${response.status}），请稍后重试`,
      )
    const batch = (await response.json()) as unknown[]
    items.push(...batch)
    if (batch.length < 100) break
  }
  return selectRelease(items, channel)
}
