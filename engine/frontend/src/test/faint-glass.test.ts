// @vitest-environment node
/**
 * The faint glass on header bands and Home's cards, and the tighter sidebar (PLAN-V26 Part 5).
 * The contrast is worked out on the colour the see-through token makes over the page.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(join(process.cwd(), 'src', path), 'utf8')
const tokens = read('styles/tokens.css')
const css = read('styles/index.css').replace(/\/\*[\s\S]*?\*\//g, '')

type Mode = 'light' | 'dark'
type Colour = readonly [number, number, number]

function declared(name: string): string {
  const found = new RegExp(`^\\s*--${name}:\\s*([^;]+);`, 'm').exec(tokens)
  if (!found?.[1]) throw new Error(`tokens.css has no --${name}`)
  return found[1].trim()
}

/** A token's colour and its alpha, in one mode. */
function token(name: string, mode: Mode): { colour: Colour; alpha: number } {
  const pair = /^light-dark\((.+)\)$/.exec(declared(name))?.[1]
  if (!pair) throw new Error(`--${name} isn't a light-dark() colour`)
  const value = pair.split(/,(?![^(]*\))/)[mode === 'light' ? 0 : 1]?.trim() ?? ''
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value)
  if (hex) {
    const at = (index: number) => parseInt(hex[index] ?? '0', 16)
    return { colour: [at(1), at(2), at(3)], alpha: 1 }
  }
  const rgb = /^rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)$/.exec(value)
  if (!rgb) throw new Error(`--${name} is "${value}", which this test can't read`)
  const at = (index: number) => Number(rgb[index])
  return { colour: [at(1), at(2), at(3)], alpha: at(4) / 100 }
}

function overPage(glass: string, mode: Mode): Colour {
  const { colour, alpha } = token(glass, mode)
  const page = token('background', mode).colour
  const mixed = (index: 0 | 1 | 2) => colour[index] * alpha + page[index] * (1 - alpha)
  return [mixed(0), mixed(1), mixed(2)]
}

function luminance(colour: Colour): number {
  const linear = (channel: number) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(colour[0]) + 0.7152 * linear(colour[1]) + 0.0722 * linear(colour[2])
}

function ratio(one: Colour, other: Colour): number {
  const [a, b] = [luminance(one), luminance(other)]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

describe('text on the faint glass is at least 4.5:1', () => {
  for (const mode of ['light', 'dark'] as const) {
    for (const glass of ['glass-band', 'glass-card']) {
      for (const text of ['foreground', 'muted-foreground', 'accent-ink', 'accent-strong']) {
        it(`${mode}: --${text} on --${glass} over the page`, () => {
          const value = ratio(token(text, mode).colour, overPage(glass, mode))
          expect(value, `${value.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
        })
      }
    }
  }
})

describe('the faint glass', () => {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  const faint = rules.filter(([, selector]) => /\.glass-(band|cards)/.test(selector ?? ''))

  it('never blurs', () => {
    expect(faint.length).toBeGreaterThan(0)
    for (const [, selector, body] of faint) {
      expect(body, selector).not.toMatch(/filter|blur/)
    }
  })

  it('reaches no list or table', () => {
    for (const [, selector] of faint) {
      expect(selector).not.toMatch(/\b(table|tr|td|ul|ol|li|form)\b/)
    }
  })

  it('is solid with reduced transparency', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-transparency: reduce)'))
    expect(reduced).toMatch(/\.glass-band\s*\{[^}]*background-color: var\(--background\)/)
    expect(reduced).toMatch(
      /\.glass-cards \[data-slot='card'\]\s*\{[^}]*background-color: var\(--card\)/,
    )
  })

  it('is on the header band and Home', () => {
    expect(read('components/page-header.tsx')).toContain('glass-band')
    expect(read('shell/home.tsx')).toContain('glass-band')
    expect(read('shell/home.tsx')).toContain('glass-cards')
  })
})

describe('the tighter sidebar', () => {
  const sidebar = read('components/ui/sidebar.tsx')

  it('has 32px rows with a mouse and 44px for a finger and under 640px', () => {
    expect(sidebar).toMatch(/default:\s*"h-8 text-ui touch:h-11 /)
    expect(read('shell/app-sidebar.tsx')).toContain('className="h-8 touch:h-11')
    // `touch:` is a finger's screen or a window under 640px, so 390px gets 44px.
    expect(css).toMatch(
      /@custom-variant touch\s*\{\s*@media \(pointer: coarse\), \(max-width: 639px\)/,
    )
  })

  it('keeps 44px tall when it is folded to icons on a touch screen, inside the 52px rail', () => {
    expect(sidebar).toContain('touch:group-data-[collapsible=icon]:h-11!')
    expect(sidebar).toContain('touch:group-data-[collapsible=icon]:w-9!')
  })

  it('has 2px between rows, and 4px for a finger', () => {
    expect(sidebar).toMatch(/flex-col gap-0\.5 touch:gap-1/)
    expect(sidebar).toMatch(/flex-col gap-0\.5 border-l[^"]*touch:gap-1/)
  })
})
