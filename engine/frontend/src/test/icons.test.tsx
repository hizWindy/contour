import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@testing-library/react'
import { SearchIcon, X } from 'lucide-react'
import { describe, expect, it } from 'vitest'

/*
  DESIGN.md ("Icons"): Lucide, outline, a 1.5px line. Lucide draws a 2px line by default, so
  src/styles/index.css has one base rule that sets 1.5 on every icon. vite.config.ts sets
  `css: false`, so a test cannot see the real cascade. These tests check that the rule is in the
  file, that it sits in the base layer, and that the selector matches what lucide-react renders.
*/
const css = readFileSync(join(import.meta.dirname, '..', 'styles', 'index.css'), 'utf8')
const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')

/** The text between the braces that open at `start`, up to the matching close. */
function block(text: string, start: number): string {
  const open = text.indexOf('{', start)
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    if (text[i] === '}') depth -= 1
    if (depth === 0) return text.slice(open + 1, i)
  }
  throw new Error('Unbalanced braces in index.css')
}

describe('icon line weight (src/styles/index.css)', () => {
  it('sets stroke-width 1.5 on svg.lucide', () => {
    const rule = /svg\.lucide\s*\{([^}]*)\}/.exec(withoutComments)

    expect(rule, 'index.css has no svg.lucide rule').not.toBeNull()
    expect(rule?.[1]?.replace(/\s+/g, ' ').trim()).toBe('stroke-width: 1.5;')
  })

  it('has the rule inside @layer base, so a utility class can still override it', () => {
    const start = withoutComments.indexOf('@layer base')

    expect(start).toBeGreaterThanOrEqual(0)
    expect(block(withoutComments, start)).toMatch(/svg\.lucide\s*\{/)
  })

  it('has the rule once', () => {
    expect(withoutComments.match(/svg\.lucide/g)).toHaveLength(1)
  })

  it('matches the markup lucide-react renders, which carries a 2px attribute by default', () => {
    const { container } = render(
      <div>
        <X />
        <SearchIcon />
      </div>,
    )
    const icons = container.querySelectorAll('svg')

    expect(icons).toHaveLength(2)
    for (const icon of icons) {
      expect(icon.matches('svg.lucide')).toBe(true)
      expect(icon.getAttribute('stroke-width')).toBe('2')
    }
  })

  it('wins over the stroke-width attribute once the rule is applied', () => {
    const rule = /svg\.lucide\s*\{[^}]*\}/.exec(withoutComments)?.[0] ?? ''
    const style = document.createElement('style')
    style.textContent = rule
    document.head.append(style)
    try {
      const { container } = render(<X strokeWidth={3} />)
      const icon = container.querySelector('svg')

      expect(icon).not.toBeNull()
      expect(icon && getComputedStyle(icon).getPropertyValue('stroke-width')).toBe('1.5')
    } finally {
      style.remove()
    }
  })
})
