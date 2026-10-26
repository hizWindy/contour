import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
  Reads src/styles/tokens.css and checks the colour pairs from engine/DESIGN.md ("Colour",
  "Accessibility" and "Tokens for shadcn") in light and dark mode.
  WCAG 2.2: 4.5:1 for text, 3:1 for the form border and other parts of a control.
*/

type Mode = 'light' | 'dark'

const css = readFileSync(join(import.meta.dirname, '..', 'styles', 'tokens.css'), 'utf8')
const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')

/** Every `--name: value;` declaration in the file. */
const declarations = new Map<string, string>()
for (const match of withoutComments.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
  const name = match[1]
  const value = match[2]
  if (name && value) {
    declarations.set(name, value.trim().replace(/\s+/g, ' '))
  }
}

/** Splits "a, b" at the first comma that is not inside brackets. */
function splitArguments(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of text) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  parts.push(current.trim())
  return parts
}

/** Resolves a value to one hex colour for a mode, following var() and light-dark(). */
function resolveValue(value: string, mode: Mode): string {
  const trimmed = value.trim()
  const variable = /^var\(--([\w-]+)\)$/.exec(trimmed)
  if (variable?.[1]) {
    return resolveToken(variable[1], mode)
  }
  const pair = /^light-dark\((.*)\)$/.exec(trimmed)
  if (pair?.[1]) {
    const [light, dark] = splitArguments(pair[1])
    return resolveValue((mode === 'light' ? light : dark) ?? '', mode)
  }
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toUpperCase()
  }
  throw new Error(`Cannot read "${value}" as a colour`)
}

function resolveToken(name: string, mode: Mode): string {
  const value = declarations.get(name)
  if (value === undefined) {
    throw new Error(`tokens.css has no --${name}`)
  }
  return resolveValue(value, mode)
}

function channel(hex: string, start: number): number {
  const value = parseInt(hex.slice(start, start + 2), 16) / 255
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const clean = hex.replace('#', '')
  return 0.2126 * channel(clean, 0) + 0.7152 * channel(clean, 2) + 0.0722 * channel(clean, 4)
}

/** WCAG contrast ratio between two hex colours. */
function ratio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05)
}

const MODES: Mode[] = ['light', 'dark']

describe('contrast helper', () => {
  it('matches known WCAG values', () => {
    expect(ratio('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
    expect(ratio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5)
    // DESIGN.md: Ink on the page is about 14:1, quieter text about 6.5:1, light text on Navy about 11:1.
    expect(ratio('#26231B', '#F4F5EF')).toBeCloseTo(14.3, 1)
    expect(ratio('#5C584E', '#F4F5EF')).toBeCloseTo(6.5, 1)
    expect(ratio('#FBFBF8', '#233A56')).toBeCloseTo(11.2, 1)
  })
})

/** Translucent tokens (a dim layer, a shadow). They are not text or surface colours. */
const TRANSLUCENT = new Set(['overlay', 'elevation-color'])

describe('tokens.css structure', () => {
  it('follows the computer setting and allows a data-theme override', () => {
    expect(css).toMatch(/color-scheme:\s*light dark/)
    expect(css).toMatch(/:root\[data-theme=["']light["']\]\s*\{[^}]*color-scheme:\s*light/)
    expect(css).toMatch(/:root\[data-theme=["']dark["']\]\s*\{[^}]*color-scheme:\s*dark/)
  })

  it('defines every colour for both modes', () => {
    const colourNames = [...declarations.entries()]
      .filter(
        ([, value]) =>
          value.startsWith('light-dark(') ||
          value.startsWith('var(--') ||
          /^#[0-9a-fA-F]{6}$/.test(value),
      )
      .map(([name]) => name)
      .filter((name) => !TRANSLUCENT.has(name))

    expect(colourNames.length).toBeGreaterThanOrEqual(40)
    for (const name of colourNames) {
      expect(resolveToken(name, 'light'), `${name} light`).toMatch(/^#[0-9A-F]{6}$/)
      expect(resolveToken(name, 'dark'), `${name} dark`).toMatch(/^#[0-9A-F]{6}$/)
    }
  })
})

describe('tokens match "Tokens for shadcn" in DESIGN.md', () => {
  // [token, light, dark]
  const table: Array<[string, string, string]> = [
    ['background', '#F4F5EF', '#26231B'],
    ['foreground', '#26231B', '#E5E8DB'],
    ['card', '#FBFBF8', '#322E25'],
    ['card-foreground', '#26231B', '#E5E8DB'],
    ['popover', '#FBFBF8', '#322E25'],
    ['popover-foreground', '#26231B', '#E5E8DB'],
    ['primary', '#233A56', '#8EA5C3'],
    ['primary-foreground', '#FBFBF8', '#26231B'],
    ['secondary', '#E5E8DB', '#3A362C'],
    ['muted', '#E5E8DB', '#3A362C'],
    ['accent', '#E5E8DB', '#3A362C'],
    ['muted-foreground', '#5C584E', '#B9BCAE'],
    ['border', '#D3D7C6', '#4A463B'],
    ['input', '#8F937F', '#7F7A6D'],
    ['ring', '#233A56', '#8EA5C3'],
    ['destructive', '#B4412D', '#D98471'],
    ['sidebar', '#E5E8DB', '#1E1B15'],
    // Palette: Navy, Olive, Sand, Ochre, Terracotta (light). Lighter steps in dark.
    ['chart-1', '#233A56', '#8EA5C3'],
    ['chart-2', '#5F693A', '#A3AE74'],
    ['chart-3', '#BBA087', '#CDB59B'],
    ['chart-4', '#A8742A', '#D9A25A'],
    ['chart-5', '#B4412D', '#D98471'],
    ['pass', '#5F693A', '#A3AE74'],
    ['review', '#A8742A', '#D9A25A'],
    ['watch', '#BBA087', '#CDB59B'],
  ]

  for (const [token, light, dark] of table) {
    it(`--${token} is ${light} in light and ${dark} in dark`, () => {
      expect(resolveToken(token, 'light')).toBe(light)
      expect(resolveToken(token, 'dark')).toBe(dark)
    })
  }

  it('uses one 10px radius, the 8-point scale, the type scale and the motion curve', () => {
    expect(declarations.get('radius')).toBe('0.625rem')
    expect([1, 2, 3, 4, 5, 6].map((step) => declarations.get(`space-${step}`))).toEqual([
      '0.5rem',
      '1rem',
      '1.5rem',
      '2rem',
      '3rem',
      '4rem',
    ])
    expect(declarations.get('size-title')).toBe('1.5rem')
    expect(declarations.get('size-section')).toBe('1.125rem')
    expect(declarations.get('size-body')).toBe('1rem')
    expect(declarations.get('size-ui')).toBe('0.875rem')
    expect(declarations.get('size-caption')).toBe('0.8125rem')
    expect(declarations.get('weight-regular')).toBe('400')
    expect(declarations.get('weight-semibold')).toBe('600')
    expect(declarations.get('ease')).toBe('cubic-bezier(0.4, 0, 0.2, 1)')
    expect(declarations.get('duration-fast')).toBe('150ms')
    expect(declarations.get('duration-slow')).toBe('250ms')
    expect(declarations.get('control-height')).toBe('2.25rem')
    expect(declarations.get('target-min')).toBe('1.5rem')
    expect(declarations.get('row-height')).toBe('3rem')
    expect(declarations.get('row-height-compact')).toBe('2.5rem')
    expect(declarations.get('content-max')).toBe('90rem')
  })

  it('has Titillium Web and IBM Plex Serif and no third typeface', () => {
    expect(declarations.get('font-family-text')).toMatch(/^["']Titillium Web["']/)
    expect(declarations.get('font-family-serif')).toMatch(/^["']IBM Plex Serif["']/)
    expect([...declarations.keys()].filter((name) => name.startsWith('font-family-'))).toEqual([
      'font-family-text',
      'font-family-serif',
    ])
  })
})

describe('text contrast is at least 4.5:1 in light and dark mode', () => {
  // [text token, background token]. Every text and surface combination the design uses.
  const textPairs: Array<[string, string]> = [
    // Ink on Stone, or Stone on Ink
    ['foreground', 'background'],
    ['foreground', 'card'],
    ['foreground', 'popover'],
    ['foreground', 'secondary'],
    ['foreground', 'sidebar'],
    ['foreground', 'sidebar-accent'],
    ['foreground', 'selected'],
    ['card-foreground', 'card'],
    ['popover-foreground', 'popover'],
    ['secondary-foreground', 'secondary'],
    ['accent-foreground', 'accent'],
    ['sidebar-foreground', 'sidebar'],
    ['sidebar-accent-foreground', 'sidebar-accent'],
    ['selected-foreground', 'selected'],
    // The tooltip: background on foreground
    ['background', 'foreground'],
    // Quieter text
    ['muted-foreground', 'background'],
    ['muted-foreground', 'card'],
    ['muted-foreground', 'popover'],
    ['muted-foreground', 'muted'],
    ['muted-foreground', 'sidebar'],
    ['muted-foreground', 'sidebar-accent'],
    ['muted-foreground', 'selected'],
    // Light text on Navy (primary button), and on Terracotta (destructive button)
    ['primary-foreground', 'primary'],
    ['destructive-foreground', 'destructive'],
    // Error text on the page and on cards
    ['destructive', 'background'],
    ['destructive', 'card'],
    ['destructive', 'popover'],
    // Badges: a dark step of the colour on a light tint of the same colour
    ['pass-ink', 'pass-soft'],
    ['review-ink', 'review-soft'],
    ['watch-ink', 'watch-soft'],
    ['destructive-ink', 'destructive-soft'],
    // Soft badges and outlined badges sit on cards and on the page
    ['foreground', 'pass-soft'],
    ['foreground', 'review-soft'],
    ['foreground', 'watch-soft'],
    ['foreground', 'destructive-soft'],
  ]

  for (const mode of MODES) {
    for (const [text, background] of textPairs) {
      it(`${mode}: --${text} on --${background}`, () => {
        const value = ratio(resolveToken(text, mode), resolveToken(background, mode))

        expect(value, `${text} on ${background} is ${value.toFixed(2)}:1`).toBeGreaterThanOrEqual(
          4.5,
        )
      })
    }
  }
})

describe('form borders and other control parts are at least 3:1', () => {
  for (const mode of MODES) {
    it(`${mode}: the form border (--input) on the card, where fields sit`, () => {
      const value = ratio(resolveToken('input', mode), resolveToken('card', mode))

      expect(value, `${value.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
    })

    it(`${mode}: the focus ring (--ring) on the page, cards and sidebar`, () => {
      for (const surface of ['background', 'card', 'popover', 'sidebar']) {
        const value = ratio(resolveToken('ring', mode), resolveToken(surface, mode))

        expect(value, `ring on ${surface} is ${value.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
      }
    })

    it(`${mode}: Navy progress and the selected marker (--primary) on the card`, () => {
      const value = ratio(resolveToken('primary', mode), resolveToken('card', mode))

      expect(value).toBeGreaterThanOrEqual(3)
    })

    it(`${mode}: result fills for icons and map pins on the card`, () => {
      // Sand (Watch) is for fills next to text and is checked separately below.
      for (const token of ['pass', 'review', 'destructive']) {
        const value = ratio(resolveToken(token, mode), resolveToken('card', mode))

        expect(value, `${token} on card is ${value.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
      }
    })

    it(`${mode}: chart colours on the card`, () => {
      // chart-3 is Sand, a neutral in charts (DESIGN.md "Colour"), so it only has to be seen.
      for (const token of ['chart-1', 'chart-2', 'chart-4', 'chart-5']) {
        const value = ratio(resolveToken(token, mode), resolveToken('card', mode))

        expect(value, `${token} on card is ${value.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
      }
      const sand = ratio(resolveToken('chart-3', mode), resolveToken('card', mode))
      expect(sand, `chart-3 on card is ${sand.toFixed(2)}:1`).toBeGreaterThanOrEqual(2)
    })
  }

  it('records a known gap: the light form border is 2.88:1 on the page, not 3:1', () => {
    // DESIGN.md says #8F937F passes 3:1. It does on the card and input fill (#FBFBF8, 3.05:1)
    // but not on the page (#F4F5EF). Fields have the card fill, so the text-field outline passes
    // against its own fill. This test fails if the gap gets worse. Fix the colour in DESIGN.md.
    const onPage = ratio(resolveToken('input', 'light'), resolveToken('background', 'light'))

    expect(onPage).toBeGreaterThanOrEqual(2.8)
    expect(onPage).toBeLessThan(3)
  })
})
