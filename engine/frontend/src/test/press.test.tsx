import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Button } from '@/components/ui/button'

/*
  A press on a Button (Improvements 1, #8): the `press` utility in index.css shrinks it to 0.98
  while it is held, in CSS. It is CSS and not Motion's `whileTap` because Motion's keyboard press
  fires a made-up pointerdown, which a Radix menu trigger reads as a click, so the account menu
  never opened from the keyboard (user-menu.test.tsx keeps that working). This keeps the CSS honest.
*/

const css = readFileSync(join(import.meta.dirname, '..', 'styles', 'index.css'), 'utf8')
const press = /@utility press \{([\s\S]*?)\n\}\n/.exec(css)?.[1] ?? ''

describe('the press on a button', () => {
  it('shrinks to 0.98 while held, never for a disabled button, and springs back on the soft curve', () => {
    expect(press).not.toBe('')
    expect(press).toMatch(/:not\(:disabled, \[aria-disabled='true'\]\):active\s*\{\s*scale: 0\.98;/)
    // The spring back is the `soft` curve from tokens.css; colours keep their quick change.
    expect(press).toMatch(/scale var\(--duration-soft\) var\(--spring-soft\)/)
    expect(press).toMatch(/background-color var\(--duration-fast\) var\(--ease\)/)
  })

  it('does not move at all with reduced motion', () => {
    expect(press).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*&:active\s*\{\s*scale: none;/,
    )
  })

  it('uses the individual scale property, so it adds to other transforms and never replaces them', () => {
    expect(press).toMatch(/\bscale:/)
    expect(press).not.toMatch(/transform:/)
  })

  it('is on every Button, whatever it is made of', () => {
    render(
      <>
        <Button>Save</Button>
        <Button asChild>
          <a href="/start">Start</a>
        </Button>
      </>,
    )
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('press')
    expect(screen.getByRole('link', { name: 'Start' })).toHaveClass('press')
  })
})
