/**
 * Which computer the page runs on, only for a keyboard hint: "press Win+H to dictate" on Windows,
 * and Cmd instead of Ctrl on a Mac. Nothing else may depend on it: a page works the same on all.
 *
 * Chrome and Edge give `userAgentData.platform` ("Windows", "macOS"); other browsers the older
 * `navigator.platform` ("Win32", "MacIntel"); the last resort is the user agent ("Windows NT",
 * "Macintosh").
 */

interface WithUserAgentData {
  userAgentData?: { platform?: string }
}

function platformName(): string {
  if (typeof navigator === 'undefined') return ''
  const data = (navigator as Navigator & WithUserAgentData).userAgentData
  return data?.platform || navigator.platform || ''
}

function userAgent(): string {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent
}

/** True on a Windows computer. */
export function isWindows(): boolean {
  return /^win/i.test(platformName()) || /\bWindows NT\b/.test(userAgent())
}

/** True on a Mac. */
export function isMac(): boolean {
  return /^mac/i.test(platformName()) || /\bMacintosh\b/.test(userAgent())
}
