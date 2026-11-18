import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
  The files that make the website installable (Improvements 1, #9): the manifest and the icons it
  names, and what the page's head says. The worker and the plugin that writes it have their own
  tests (sw.test.ts, vite-pwa.test.ts).
*/

const root = join(import.meta.dirname, '..', '..')
const publicDir = join(root, 'public')
const manifest = JSON.parse(readFileSync(join(publicDir, 'manifest.webmanifest'), 'utf8')) as {
  [key: string]: unknown
  icons: { src: string; sizes: string; type: string; purpose: string }[]
  shortcuts: { name: string; url: string }[]
}
const html = readFileSync(join(root, 'index.html'), 'utf8')

/** The width and height of a PNG, read from its header. */
function pngSize(path: string): [number, number] {
  const bytes = readFileSync(path)
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}

describe('the manifest', () => {
  it('names the app, opens it as an app of its own from the home page, in Contour’s colours', () => {
    expect(manifest.name).toBe('Contour')
    expect(manifest.short_name).toBe('Contour')
    expect(manifest.start_url).toBe('/')
    expect(manifest.scope).toBe('/')
    expect(manifest.id).toBe('/')
    expect(manifest.display).toBe('standalone')
    // The page's own colour (--background in light mode), for the splash and the title bar.
    expect(manifest.background_color).toBe('#F4F5EF')
    expect(manifest.theme_color).toBe('#F4F5EF')
  })

  it('has icons that are the size they say, a maskable one for a phone to cut, and one to use as it is', () => {
    const purposes = manifest.icons.map((icon) => icon.purpose)
    expect(purposes).toEqual(['any', 'any', 'maskable'])
    for (const icon of manifest.icons) {
      const [width, height] = pngSize(join(publicDir, icon.src))
      expect(`${String(width)}x${String(height)}`).toBe(icon.sizes)
      expect(icon.type).toBe('image/png')
    }
    // The 192 and the 512 an installable app needs.
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(
      expect.arrayContaining(['192x192', '512x512']),
    )
    expect(pngSize(join(publicDir, 'icons', 'apple-touch-icon.png'))).toEqual([180, 180])
  })

  it('has shortcuts to the pages used all day, each a real page of the website', () => {
    // Today first: the Assistant's daily list (PLAN-V22 T2-1). A phone may show only the first 4.
    expect(manifest.shortcuts.map((shortcut) => shortcut.name)).toEqual([
      'Today',
      'Call logs',
      'Meetings',
      'Companies',
      'Start a run',
    ])
    for (const shortcut of manifest.shortcuts) expect(shortcut.url).toMatch(/^\/[a-z/-]*$/)
  })

  it('writes no em dash, like every other file a person reads', () => {
    expect(JSON.stringify(manifest)).not.toContain('—')
  })
})

describe('the page head', () => {
  it('links the manifest and the home screen icon, and sets the browser bar and the iOS app', () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />')
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />')
    expect(html).toContain('<meta name="theme-color" content="#F4F5EF" />')
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />')
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Contour" />')
  })

  it('still allows only our own files, and the worker and manifest need nothing more', () => {
    // A worker needs `worker-src`, which falls back to `script-src 'self'`; the manifest falls back
    // to `default-src 'self'`. So the policy of index.html did not have to open anything.
    expect(html).toContain("default-src 'self'; script-src 'self';")
  })
})
