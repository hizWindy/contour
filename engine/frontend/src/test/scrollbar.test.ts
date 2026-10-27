import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(import.meta.dirname, '../styles/index.css'), 'utf8')

describe('scrollbars', () => {
  it('are thin: 10px to grab, with a see-through track and no arrow buttons', () => {
    expect(css).toMatch(/::-webkit-scrollbar\s*\{[^}]*width:\s*10px[^}]*height:\s*10px/)
    expect(css).toMatch(/::-webkit-scrollbar-track[^{]*\{[^}]*background:\s*transparent/)
    expect(css).not.toContain('::-webkit-scrollbar-button')
  })

  it('draw their thumb in a token colour, so they fit light and dark', () => {
    expect(css).toMatch(/--scrollbar-thumb:\s*color-mix\([^)]*var\(--muted-foreground\)/)
    expect(css).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*var\(--scrollbar-thumb\)/)
  })

  it('also ask for a thin bar in browsers that only know the standard properties', () => {
    expect(css).toMatch(
      /@supports not selector\(::-webkit-scrollbar\)\s*\{[^}]*scrollbar-width:\s*thin/,
    )
  })
})
