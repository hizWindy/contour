/**
 * StepTrail (PLAN-V18 T2-2), in a file of its own so the two website tracks never edit the same
 * test file. jsdom draws nothing, so these prove what can be read: each step's state for a count of
 * steps reached, what a screen reader hears, that a dot fills only when its step arrives (and is
 * simply filled when it had arrived before), the stop at a failure, and reduced motion.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { domMax, LazyMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { REDUCED_MOTION } from '@/lib/use-media-query'
import { MotionRoot, StepTrail } from '.'

const STEPS = ['Reading HubSpot', 'Writing the summaries', 'Ready for you to check'] as const
const LABEL = 'How the draft is going'

/** What a screen reader hears after each step's words. */
const WORDS = { done: 'done', now: 'in progress', waiting: 'not yet', stopped: 'stopped here' }

/** motion's features, there from the start, so the springs really run. */
function WithFeatures({ children }: { children: ReactNode }) {
  return (
    <MotionRoot>
      <LazyMotion features={domMax} strict>
        {children}
      </LazyMotion>
    </MotionRoot>
  )
}

function trail(reached: number, failed = false) {
  return <StepTrail steps={STEPS} reached={reached} failed={failed} aria-label={LABEL} />
}

function renderMoving(reached: number, failed = false) {
  return render(trail(reached, failed), { wrapper: WithFeatures })
}

function steps(): HTMLElement[] {
  return within(screen.getByRole('list', { name: LABEL })).getAllByRole('listitem')
}

/** Each step's fill, as a scale: 1 filled, 0 empty. */
function fills(): number[] {
  return [...document.querySelectorAll<SVGElement>('[data-slot=step-fill]')].map((fill) => {
    const transform = fill.style.transform
    if (transform === '' || transform === 'none') return 1
    const match = /scale\(([\d.]+)\)/.exec(transform)
    return match ? Number(match[1]) : Number.NaN
  })
}

/** Each line's fill, as a scale along it: 1 full, 0 empty. */
function lines(): number[] {
  return [...document.querySelectorAll<HTMLElement>('[data-slot=step-line] > span')].map((fill) => {
    const transform = fill.style.transform
    if (transform === '' || transform === 'none') return 1
    const match = /scaleX\(([\d.]+)\)/.exec(transform)
    return match ? Number(match[1]) : Number.NaN
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

/** Each step's state, drawn fresh for a count of steps reached. */
function statesOf(reached: number, failed = false): (string | undefined)[] {
  const { unmount } = renderMoving(reached, failed)
  const states = steps().map((item) => item.dataset.state)
  unmount()
  return states
}

describe('the states of the steps', () => {
  it('gives each step its state for a count of steps reached', () => {
    expect(statesOf(0)).toEqual(['waiting', 'waiting', 'waiting'])
    expect(statesOf(1)).toEqual(['now', 'waiting', 'waiting'])
    expect(statesOf(2)).toEqual(['done', 'now', 'waiting'])
    // The last step reached: the trail is done.
    expect(statesOf(3)).toEqual(['done', 'done', 'done'])
  })

  it('stops at the step that failed, and holds a count that is out of range', () => {
    expect(statesOf(1, true)).toEqual(['stopped', 'waiting', 'waiting'])
    expect(statesOf(2, true)).toEqual(['done', 'stopped', 'waiting'])
    expect(statesOf(9)).toEqual(['done', 'done', 'done'])
    expect(statesOf(-1)).toEqual(['waiting', 'waiting', 'waiting'])
    expect(statesOf(Number.NaN)).toEqual(['waiting', 'waiting', 'waiting'])
  })
})

describe('StepTrail', () => {
  it('is a named list of the steps, each with its state in words, and the dots hidden', () => {
    renderMoving(2)
    const items = steps()
    expect(items.map((item) => item.textContent)).toEqual([
      `Reading HubSpot, ${WORDS.done}`,
      `Writing the summaries, ${WORDS.now}`,
      `Ready for you to check, ${WORDS.waiting}`,
    ])
    for (const dot of document.querySelectorAll('[data-slot=step-dot]')) {
      expect(dot).toHaveAttribute('aria-hidden', 'true')
    }
    // Where it stands now reads in the text's full colour; what is still to come is quiet.
    expect(within(items[1]).getByText('Writing the summaries')).toHaveClass(
      'font-semibold',
      'text-foreground',
    )
    expect(within(items[2]).getByText('Ready for you to check')).toHaveClass(
      'text-muted-foreground',
    )
  })

  it('shows the steps that had arrived before it first showed simply filled', () => {
    renderMoving(2)
    expect(fills()).toEqual([1, 1, 0])
    expect(lines()).toEqual([1, 0])
  })

  it('fills a dot, and the line to it, only when its step arrives', async () => {
    const { rerender } = renderMoving(1)
    expect(fills()).toEqual([1, 0, 0])
    expect(lines()).toEqual([0, 0])
    rerender(trail(2))
    await waitFor(() => {
      expect(fills()).toEqual([1, 1, 0])
      expect(lines()).toEqual([1, 0])
    })
    rerender(trail(3))
    await waitFor(() => {
      expect(fills()).toEqual([1, 1, 1])
      expect(lines()).toEqual([1, 1])
    })
    expect(steps().map((item) => item.dataset.state)).toEqual(['done', 'done', 'done'])
  })

  it('never fills anything by itself: with the same count, it stays as it is', async () => {
    renderMoving(1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400))
    })
    expect(fills()).toEqual([1, 0, 0])
    expect(lines()).toEqual([0, 0])
  })

  it('says a step that arrives once, politely', () => {
    const { rerender } = renderMoving(1)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Reading HubSpot')
    rerender(trail(2))
    expect(status).toHaveTextContent('Writing the summaries')
    expect(status).not.toHaveTextContent('Reading HubSpot')
  })

  it('stops at a failure: a Terracotta cross, "stopped here", and nothing after it', () => {
    renderMoving(2, true)
    const items = steps()
    const stopped = items[1]
    expect(stopped.dataset.state).toBe('stopped')
    expect(stopped).toHaveTextContent(`Writing the summaries, ${WORDS.stopped}`)
    const cross = stopped.querySelector('[data-slot=step-dot]')
    expect(cross).toHaveClass('lucide-circle-x', 'text-destructive')
    expect(items[2]?.dataset.state).toBe('waiting')
    // The page says why, beside it: the trail itself says nothing new.
    expect(screen.getByRole('status')).toHaveTextContent('')
  })

  it('is simply filled with reduced motion', () => {
    askForReducedMotion()
    const { rerender } = render(<MotionRoot>{trail(1)}</MotionRoot>)
    rerender(<MotionRoot>{trail(2)}</MotionRoot>)
    // Only the dots that arrived have their fill, with no scale on its way.
    const filled = [...document.querySelectorAll<SVGElement>('[data-slot=step-fill]')]
    expect(filled).toHaveLength(2)
    for (const fill of filled) expect(fill.style.transform).toBe('')
    const fillsOfLines = [...document.querySelectorAll('[data-slot=step-line] > span')]
    expect(fillsOfLines[0]).toHaveClass('scale-x-100')
    expect(fillsOfLines[1]).toHaveClass('scale-x-0')
  })
})
