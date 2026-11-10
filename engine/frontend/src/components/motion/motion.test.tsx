import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { m } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { REDUCED_MOTION } from '@/lib/use-media-query'
import {
  ChipGroup,
  INSTANT,
  MotionRoot,
  PRESS_SCALE,
  Reveal,
  REVEAL_MAX,
  RollingNumber,
  Segmented,
  springs,
  TabIndicator,
  usePress,
  useStill,
  useTransition,
} from '.'
import { handleRovingKey, nextEnabled, rovingTarget } from './roving'

/*
  The motion kit (PLAN-V13 T2-4). jsdom has no layout and no animation frames, so these tests
  prove what a browser cannot be trusted to show: the roles and names a screen reader gets, the
  keyboard, what changes on a click, and that reduced motion takes every animation away.
*/

function wrap(ui: ReactNode) {
  return render(<MotionRoot>{ui}</MotionRoot>)
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

describe('springs', () => {
  it('have no bounce, except soft, and leaving is quicker than arriving', () => {
    expect(springs.snappy).toEqual({ type: 'spring', duration: 0.25, bounce: 0 })
    expect(springs.smooth).toEqual({ type: 'spring', duration: 0.4, bounce: 0 })
    expect(springs.soft).toEqual({ type: 'spring', duration: 0.35, bounce: 0.1 })
    expect(springs.exit.duration).toBe(0.15)
    expect(springs.exit.duration).toBeLessThan(springs.snappy.duration)
    expect(INSTANT).toEqual({ duration: 0 })
    expect(REVEAL_MAX).toBe(8)
  })
})

describe('MotionRoot', () => {
  it('renders its children, and m.* parts inside it', () => {
    wrap(<m.div data-testid="moving">Hello</m.div>)
    expect(screen.getByTestId('moving')).toHaveTextContent('Hello')
  })
})

describe('useStill and useTransition', () => {
  function Probe() {
    const still = useStill()
    const transition = useTransition(springs.smooth)
    return <output>{`${still} ${JSON.stringify(transition)}`}</output>
  }

  it('follows the computer', () => {
    wrap(<Probe />)
    expect(screen.getByRole('status')).toHaveTextContent('false {"type":"spring"')
  })

  it('is still, with an instant transition, when the computer asks for reduced motion', () => {
    askForReducedMotion()
    wrap(<Probe />)
    expect(screen.getByRole('status')).toHaveTextContent('true {"duration":0}')
  })
})

describe('usePress', () => {
  function Probe() {
    const press = usePress()
    return <output>{JSON.stringify(press)}</output>
  }

  it('shrinks to 0.98 on the soft spring', () => {
    wrap(<Probe />)
    expect(PRESS_SCALE).toBe(0.98)
    expect(JSON.parse(screen.getByRole('status').textContent ?? '')).toEqual({
      whileTap: { scale: 0.98 },
      transition: springs.soft,
    })
  })

  it('does nothing with reduced motion', () => {
    askForReducedMotion()
    wrap(<Probe />)
    expect(screen.getByRole('status')).toHaveTextContent('{}')
  })
})

describe('roving keyboard', () => {
  it('moves with the arrows, wraps, and jumps with Home and End', () => {
    expect(rovingTarget('ArrowRight', 0, 3)).toBe(1)
    expect(rovingTarget('ArrowDown', 2, 3)).toBe(0)
    expect(rovingTarget('ArrowLeft', 0, 3)).toBe(2)
    expect(rovingTarget('ArrowUp', 1, 3)).toBe(0)
    expect(rovingTarget('Home', 2, 3)).toBe(0)
    expect(rovingTarget('End', 0, 3)).toBe(2)
    expect(rovingTarget('Enter', 0, 3)).toBeNull()
  })

  it('skips disabled items', () => {
    expect(nextEnabled(0, 1, [false, true, false])).toBe(2)
    expect(nextEnabled(2, 1, [false, true, false])).toBe(0)
    expect(nextEnabled(0, -1, [false, true, false])).toBe(2)
    expect(nextEnabled(0, 1, [false, true, true])).toBe(0)
    const picks: number[] = []
    const event = { key: 'ArrowRight', preventDefault: vi.fn() }
    handleRovingKey(event as never, 0, [false, true, false], (i) => picks.push(i))
    expect(picks).toEqual([2])
    expect(event.preventDefault).toHaveBeenCalled()
  })
})

const OFTEN = [
  { value: '2w', label: 'Every 2 weeks' },
  { value: '30d', label: 'Every 30 days' },
  { value: 'custom', label: 'Custom' },
] as const

function SegmentedHarness({ disabled = [] as string[] }) {
  const [value, setValue] = useState<string>('2w')
  return (
    <Segmented
      aria-label="How often"
      options={OFTEN.map((o) => ({ ...o, disabled: disabled.includes(o.value) }))}
      value={value}
      onChange={setValue}
    />
  )
}

describe('Segmented', () => {
  it('is a radio group with one checked segment, and a click changes it', async () => {
    const user = userEvent.setup()
    wrap(<SegmentedHarness />)
    const group = screen.getByRole('radiogroup', { name: 'How often' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1])
    await user.click(radios[2])
    expect(radios[2]).toHaveAttribute('aria-checked', 'true')
    expect(radios[0]).toHaveAttribute('aria-checked', 'false')
    expect(radios[2].tabIndex).toBe(0)
  })

  it('moves the choice and the focus with the arrows, Home and End', async () => {
    const user = userEvent.setup()
    wrap(<SegmentedHarness />)
    const radios = screen.getAllByRole('radio')
    await user.tab()
    expect(radios[0]).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(radios[1]).toHaveAttribute('aria-checked', 'true')
    expect(radios[1]).toHaveFocus()
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(radios[2]).toHaveAttribute('aria-checked', 'true')
    expect(radios[2]).toHaveFocus()
    await user.keyboard('{Home}')
    expect(radios[0]).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{End}')
    expect(radios[2]).toHaveAttribute('aria-checked', 'true')
  })

  it('skips a disabled segment with the keyboard', async () => {
    const user = userEvent.setup()
    wrap(<SegmentedHarness disabled={['30d']} />)
    const radios = screen.getAllByRole('radio')
    expect(radios[1]).toBeDisabled()
    await user.tab()
    await user.keyboard('{ArrowRight}')
    expect(radios[2]).toHaveAttribute('aria-checked', 'true')
  })

  it('highlights the chosen segment with the accent, still, with reduced motion', () => {
    askForReducedMotion()
    wrap(<SegmentedHarness />)
    const checked = screen.getByRole('radio', { checked: true })
    expect(checked).toHaveClass('text-accent-ink')
    expect(checked.querySelector('.bg-accent-soft')).not.toBeNull()
    expect(
      screen.getByRole('radio', { name: 'Custom' }).querySelector('.bg-accent-soft'),
    ).toBeNull()
  })
})

const CITIES = [
  { value: 'melbourne', label: 'Melbourne' },
  { value: 'adelaide', label: 'Adelaide' },
  { value: 'perth', label: 'Perth' },
  { value: 'sydney', label: 'Sydney', disabled: true },
] as const

function ChipHarness({ mode = 'many' as 'many' | 'one', start = ['melbourne'] as string[] }) {
  const [value, setValue] = useState<string[]>(start)
  return (
    <>
      <span id="cities-label">Cities</span>
      <ChipGroup
        aria-labelledby="cities-label"
        mode={mode}
        options={CITIES}
        value={value}
        onChange={setValue}
      />
      <output>{value.join(',')}</output>
    </>
  )
}

describe('ChipGroup', () => {
  it('picks many: each chip is a pressed button, and a click toggles it', async () => {
    const user = userEvent.setup()
    wrap(<ChipHarness />)
    const group = screen.getByRole('group', { name: 'Cities' })
    const chips = within(group).getAllByRole('button')
    expect(chips.map((c) => c.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ])
    expect(chips[3]).toBeDisabled()
    await user.click(chips[2])
    expect(screen.getByRole('status')).toHaveTextContent('melbourne,perth')
    await user.click(chips[0])
    expect(screen.getByRole('status')).toHaveTextContent('perth')
    expect(chips[0]).toHaveAttribute('aria-pressed', 'false')
    expect(chips[2]).toHaveClass('bg-accent-soft')
    expect(chips[0]).not.toHaveClass('bg-accent-soft')
  })

  it('picks one: a radio group where the arrows move the choice', async () => {
    const user = userEvent.setup()
    wrap(<ChipHarness mode="one" />)
    const group = screen.getByRole('radiogroup', { name: 'Cities' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1, -1])
    await user.tab()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('status')).toHaveTextContent(/^adelaide$/)
    expect(radios[1]).toHaveFocus()
    // Sydney is disabled, so End lands on Perth.
    await user.keyboard('{End}')
    expect(screen.getByRole('status')).toHaveTextContent(/^perth$/)
    await user.click(radios[0])
    expect(screen.getByRole('status')).toHaveTextContent(/^melbourne$/)
  })

  it('picks one, with nothing picked yet: the first chip holds the Tab stop', () => {
    wrap(<ChipHarness mode="one" start={[]} />)
    expect(screen.getAllByRole('radio').map((r) => r.tabIndex)).toEqual([0, -1, -1, -1])
  })

  it('keeps the tick in the layout when a chip is not picked, so no chip changes width', () => {
    wrap(<ChipHarness />)
    for (const chip of screen.getAllByRole('button')) {
      expect(chip.querySelector('svg.lucide-check')).not.toBeNull()
    }
  })

  it('works with reduced motion', async () => {
    askForReducedMotion()
    const user = userEvent.setup()
    wrap(<ChipHarness />)
    await user.click(screen.getByRole('button', { name: 'Adelaide' }))
    expect(screen.getByRole('status')).toHaveTextContent('melbourne,adelaide')
  })
})

describe('TabIndicator', () => {
  it('renders only under the active tab, hidden from screen readers', () => {
    wrap(
      <div role="tablist">
        <button type="button" role="tab" aria-selected="true" className="relative">
          Health
          <TabIndicator active group="admin" />
        </button>
        <button type="button" role="tab" aria-selected="false" className="relative">
          Runs
          <TabIndicator active={false} group="admin" />
        </button>
      </div>,
    )
    const [health, runs] = screen.getAllByRole('tab')
    const indicator = health.querySelector('[data-slot=tab-indicator]')
    expect(indicator).not.toBeNull()
    expect(indicator).toHaveAttribute('aria-hidden', 'true')
    expect(indicator).toHaveClass('bg-accent-strong')
    expect(runs.querySelector('[data-slot=tab-indicator]')).toBeNull()
  })

  it('is a plain, still underline with reduced motion, and can sit at the side', () => {
    askForReducedMotion()
    wrap(
      <div className="relative">
        <TabIndicator active group="g" side />
      </div>,
    )
    const indicator = document.querySelector('[data-slot=tab-indicator]')
    expect(indicator?.tagName).toBe('SPAN')
    expect(indicator).toHaveClass('w-0.5')
  })
})

describe('Reveal', () => {
  it('shows its content, and staggers at most 8 items', () => {
    wrap(
      <>
        <Reveal index={0}>First</Reveal>
        <Reveal index={20}>Last</Reveal>
      </>,
    )
    expect(screen.getByText('First')).toHaveAttribute('data-slot', 'reveal')
    // jsdom runs no animation, so the content keeps its starting state: not yet shown.
    expect(screen.getByText('Last')).toBeInTheDocument()
    expect(screen.getByText('First')).toHaveStyle({ opacity: '0' })
  })

  it('is simply there with reduced motion', () => {
    askForReducedMotion()
    wrap(<Reveal>Still</Reveal>)
    expect(screen.getByText('Still')).toBeVisible()
    expect(screen.getByText('Still')).not.toHaveStyle({ opacity: '0' })
  })
})

describe('RollingNumber', () => {
  function Harness({ value, format }: { value: number; format?: (n: number) => string }) {
    return <RollingNumber value={value} format={format} />
  }

  it('reads as the plain number to a screen reader, and shows one column per digit', () => {
    wrap(<Harness value={1234} />)
    expect(screen.getByText('1,234')).toHaveClass('sr-only')
    const visible = document.querySelector('[data-slot=rolling-number] [aria-hidden=true]')
    expect(visible?.querySelectorAll('.overflow-hidden')).toHaveLength(4)
    expect(visible?.textContent).toBe('0123456789,012345678901234567890123456789')
  })

  it('takes a money format and rolls to a new value', () => {
    const money = (n: number) => `US$${n.toFixed(2)}`
    const { rerender } = wrap(<Harness value={96.4} format={money} />)
    expect(screen.getByText('US$96.40')).toHaveClass('sr-only')
    act(() => {
      rerender(
        <MotionRoot>
          <Harness value={103.75} format={money} />
        </MotionRoot>,
      )
    })
    expect(screen.getByText('US$103.75')).toHaveClass('sr-only')
    expect(document.querySelectorAll('[data-slot=rolling-number] .overflow-hidden')).toHaveLength(5)
  })

  it('renders with reduced motion', () => {
    askForReducedMotion()
    wrap(<Harness value={7} />)
    expect(document.querySelector('[data-slot=rolling-number] .sr-only')).toHaveTextContent('7')
  })
})
