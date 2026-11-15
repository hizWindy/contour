import { describe, expect, it, vi } from 'vitest'
import { isMac, isWindows } from './platform'

function onPlatform(platform: string, userAgent = 'Mozilla/5.0 (X11; Linux x86_64)'): void {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform)
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent)
}

describe('platform', () => {
  it('knows Windows from the platform or the user agent', () => {
    onPlatform('Win32')
    expect(isWindows()).toBe(true)
    expect(isMac()).toBe(false)
    onPlatform('', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
    expect(isWindows()).toBe(true)
  })

  it('knows a Mac', () => {
    onPlatform('MacIntel')
    expect(isMac()).toBe(true)
    expect(isWindows()).toBe(false)
  })

  it('is neither on Linux, or in a test window that names no platform', () => {
    onPlatform('Linux x86_64')
    expect(isWindows()).toBe(false)
    expect(isMac()).toBe(false)
    // jsdom names Node's platform in lower case ("win32"), which is not a browser's form.
    onPlatform('', 'Mozilla/5.0 (win32) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/30.1.3')
    expect(isWindows()).toBe(false)
  })
})
