import { loadWinUIIconFont } from 'winuionweb'

type PlatformNavigator = Pick<Navigator, 'platform' | 'userAgent'> & {
  userAgentData?: { platform: string }
}

export function isWindows(navigator: PlatformNavigator): boolean {
  const platform = navigator.userAgentData?.platform || navigator.platform
  return platform ? /^win/i.test(platform) : /Windows/i.test(navigator.userAgent)
}

export async function initializeIconFont(): Promise<void> {
  if (isWindows(navigator)) {
    document.documentElement.dataset.iconSystem = 'segoe-fluent'
    return
  }

  // The bridge keeps Segoe codepoints for persisted categories and WinUI's internal
  // glyphs, but every outline comes from Fluent UI System Icons, not Segoe.
  await loadWinUIIconFont(new URL('./assets/fluent-system-icons.woff', import.meta.url))
  document.documentElement.dataset.iconSystem = 'fluent-system'
}
