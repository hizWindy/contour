import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
  A favicon is drawn by the browser on its own, so it cannot read the CSS variables and has to
  carry its colours as hex. This test keeps them equal to the tokens: Navy and the light text on
  Navy (--primary and --primary-foreground), in light and dark. The one place colours are written
  stays tokens.css, and this file cannot drift from it.
*/
const root = join(import.meta.dirname, '..', '..')
const tokens = readFileSync(join(root, 'src', 'styles', 'tokens.css'), 'utf8')
const favicon = readFileSync(join(root, 'public', 'favicon.svg'), 'utf8')

const HEX = '#[0-9a-fA-F]{6}'

function token(name: string): [string, string] {
  const match = new RegExp(`--${name}:\\s*light-dark\\((${HEX}),\\s*(${HEX})\\)`).exec(tokens)
  if (!match?.[1] || !match[2]) {
    throw new Error(`tokens.css has no light-dark pair for --${name}`)
  }
  return [match[1].toUpperCase(), match[2].toUpperCase()]
}

/** The values of `property` in the rules for `.selector`: the light one first, then the dark. */
function paint(selector: string, property: string): string[] {
  const rule = new RegExp(`\\.${selector}\\s*\\{[^}]*?${property}:\\s*(${HEX})`, 'g')
  return [...favicon.matchAll(rule)].map((match) => (match[1] ?? '').toUpperCase())
}

describe('public/favicon.svg', () => {
  it('uses the Navy tokens in light and dark', () => {
    expect(paint('ground', 'fill')).toEqual(token('primary'))
  })

  it('draws its lines in the light text colour that sits on Navy', () => {
    expect(paint('line', 'stroke')).toEqual(token('primary-foreground'))
  })

  it('has a title and no em dash', () => {
    expect(favicon).toContain('<title>Lead Finder</title>')
    expect(favicon).not.toContain('\u2014')
  })
})
