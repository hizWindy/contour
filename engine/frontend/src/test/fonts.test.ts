import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..', '..')
const html = readFileSync(join(root, 'index.html'), 'utf8')
const main = readFileSync(join(root, 'src', 'main.tsx'), 'utf8')

/** Every `<link rel="preload">` in index.html, with the attributes it has. */
const preloads = [...html.matchAll(/<link\b[^>]*\brel="preload"[^>]*>/gs)].map((match) => ({
  tag: match[0],
  href: /\bhref="([^"]+)"/.exec(match[0])?.[1] ?? '',
}))

/** The CSS files of the fonts that main.tsx imports, like `@fontsource/titillium-web/400.css`. */
const fontCss = [...main.matchAll(/import '(@fontsource\/[^']+\.css)'/g)].map(
  (match) => match[1] ?? '',
)

describe('the preloaded fonts (PLAN-V7 D3)', () => {
  it('preloads the two weights of the body font that the first screen uses', () => {
    const files = preloads.map((preload) => preload.href.split('/').at(-1))

    expect(files).toEqual([
      'titillium-web-latin-400-normal.woff2',
      'titillium-web-latin-600-normal.woff2',
    ])
  })

  it('names files that exist, and asks for them as fonts, with crossorigin', () => {
    for (const { tag, href } of preloads) {
      expect(existsSync(join(root, href)), href).toBe(true)
      expect(tag).toContain('as="font"')
      expect(tag).toContain('type="font/woff2"')
      // A font is fetched with CORS. Without this, the preload is not reused and the font loads twice.
      expect(tag).toMatch(/\bcrossorigin\b/)
    }
  })

  it('preloads only files the imported font styles use, so none is downloaded for nothing', () => {
    const styles = fontCss.map((css) => readFileSync(join(root, 'node_modules', css), 'utf8'))
    for (const { href } of preloads) {
      const file = href.split('/').at(-1) ?? ''
      expect(
        styles.some((style) => style.includes(`url(./files/${file})`)),
        file,
      ).toBe(true)
    }
  })
})
