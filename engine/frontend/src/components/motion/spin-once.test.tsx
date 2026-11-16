/**
 * SpinOnce (PLAN-V18 T2-2), in a file of its own so the two website tracks never edit the same
 * test file. jsdom draws nothing, so these prove what can be read: the angle each press asks for,
 * that a second press carries on forward from where the icon is, that it never moves by itself,
 * and that reduced motion keeps it still.
 */
import { act, render, waitFor } from '@testing-library/react'
import { domMax, LazyMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { REDUCED_MOTION } from '@/lib/use-media-query'
import { MotionRoot, SpinOnce } from '.'
import { TURN } from './spin-once'

/** motion's features, there from the start, so the spring really runs. */
function WithFeatures({ children }: { children: ReactNode }) {
  return (
    <MotionRoot>
      <LazyMotion features={domMax} strict>
        {children}
      </LazyMotion>
    </MotionRoot>
  )
}

function Icon() {
  return <svg data-testid="icon" />
}

function spin(turns: number) {
  return (
    <SpinOnce turns={turns}>
      <Icon />
    </SpinOnce>
  )
}

function renderMoving(turns: number) {
  return render(spin(turns), { wrapper: WithFeatures })
}

/** The icon's angle now, in degrees: 0 when it has no turn. */
function angle(): number {
  const part = document.querySelector<HTMLElement>('[data-slot=spin-once]')
  const transform = part?.style.transform ?? ''
  if (transform === '' || transform === 'none') return 0
  const match = /rotate\((-?[\d.]+)deg\)/.exec(transform)
  return match ? Number(match[1]) : Number.NaN
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

/** The computer asks for reduced motion, for the rest of this test. */
function askForReducedMotion() {
  vi.stubGlobal('matchMedia', (query: string): MediaQueryList => ({
    matches: query === REDUCED_MOTION,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }))
}

describe('SpinOnce', () => {
  it('asks for whole turns only, and none for a count that is not one', () => {
    expect(TURN).toBe(360)
    const cases: [number, number][] = [
      [0, 0],
      [1, 360],
      [3, 1080],
      [1.7, 360],
      [-2, 0],
      [Number.NaN, 0],
    ]
    for (const [turns, expected] of cases) {
      const { unmount } = renderMoving(turns)
      expect(angle()).toBe(expected)
      unmount()
    }
  })

  it('holds the icon, hidden from screen readers, and never turns by itself when it first shows', () => {
    renderMoving(3)
    const part = document.querySelector('[data-slot=spin-once]')
    expect(part).toHaveAttribute('aria-hidden', 'true')
    expect(part?.querySelector('[data-testid=icon]')).not.toBeNull()
    // Already where three presses put it: nothing turns as the page opens.
    expect(angle()).toBe(1080)
  })

  it('turns one full turn for a press, and settles there', async () => {
    const { rerender } = renderMoving(0)
    expect(angle()).toBe(0)
    rerender(spin(1))
    await waitFor(() => {
      expect(angle()).toBe(360)
    })
  })

  it('carries on forward from where it is when pressed again mid-turn, and ends one turn on', async () => {
    const { rerender } = renderMoving(0)
    rerender(spin(1))
    // Part of the way round.
    await waitFor(() => {
      expect(angle()).toBeGreaterThan(0)
    })
    const before = angle()
    expect(before).toBeLessThan(360)
    rerender(spin(2))
    const seen: number[] = [before]
    for (let tries = 0; tries < 100 && seen.at(-1) !== 720; tries += 1) {
      await wait(20)
      seen.push(angle())
    }
    expect(seen.at(-1)).toBe(720)
    // Never back, never a jump to the start of a turn: each angle is at least the one before.
    seen.forEach((value, index) => {
      expect(value).toBeGreaterThanOrEqual(seen[index - 1] ?? 0)
    })
  })

  it('never moves by itself: with the same count it stays where it is', async () => {
    const { rerender } = renderMoving(1)
    rerender(spin(1))
    const before = angle()
    await wait(300)
    expect(angle()).toBe(before)
  })

  it('stays still with reduced motion, and keeps the icon', () => {
    askForReducedMotion()
    const { rerender } = render(<MotionRoot>{spin(0)}</MotionRoot>)
    rerender(<MotionRoot>{spin(2)}</MotionRoot>)
    const part = document.querySelector<HTMLElement>('[data-slot=spin-once]')
    expect(part?.style.transform ?? '').toBe('')
    expect(part).toHaveAttribute('aria-hidden', 'true')
    expect(part?.querySelector('[data-testid=icon]')).not.toBeNull()
  })
})
