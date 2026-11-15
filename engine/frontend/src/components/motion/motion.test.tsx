import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { domMax, LazyMotion, m } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { REDUCED_MOTION } from '@/lib/use-media-query'
import {
  ChipGroup,
  INSTANT,
  LevelMeter,
  LIST_EXIT_MAX,
  ListExit,
  ListExitItem,
  MotionRoot,
  PRESS_SCALE,
  PushView,
  Reveal,
  REVEAL_MAX,
  RollingNumber,
  Segmented,
  springs,
  TabIndicator,
  TickIn,
  usePress,
  useStill,
  useTransition,
  useViewShown,
} from '.'
import { handleRovingKey, nextEnabled, rovingTarget } from './roving'

/*
  The motion kit (PLAN-V13 T2-4). jsdom has no layout, and a plain render here has no animation
  (motion's features arrive late, see MotionRoot), so these tests prove what a browser cannot be
  trusted to show: the roles and names a screen reader gets, the keyboard, what changes on a
  click, and that reduced motion takes every animation away.
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

function ChipHarness({
  mode = 'many' as 'many' | 'one' | 'one-or-none',
  start = ['melbourne'] as string[],
}) {
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

  it('picks one or none: pressed buttons, a pick lets go of the other, a second press of none', async () => {
    const user = userEvent.setup()
    wrap(<ChipHarness mode="one-or-none" start={[]} />)
    const group = screen.getByRole('group', { name: 'Cities' })
    // Not radio buttons, which can't be unpicked: every chip is a button in the Tab order.
    expect(within(group).queryAllByRole('radio')).toHaveLength(0)
    const chips = within(group).getAllByRole('button')
    expect(chips.map((c) => c.getAttribute('aria-pressed'))).toEqual([
      'false',
      'false',
      'false',
      'false',
    ])
    // No roving Tab stop as in `one`: each chip is a stop of its own.
    expect(chips.map((c) => c.tabIndex)).toEqual([0, 0, 0, 0])

    await user.click(chips[1])
    expect(screen.getByRole('status')).toHaveTextContent(/^adelaide$/)
    await user.click(chips[2])
    expect(screen.getByRole('status')).toHaveTextContent(/^perth$/)
    expect(chips[1]).toHaveAttribute('aria-pressed', 'false')
    expect(chips[2]).toHaveAttribute('aria-pressed', 'true')
    expect(chips[2]).toHaveClass('bg-accent-soft')

    // The keyboard does the same: Space on the picked chip lets go of it.
    chips[2]?.focus()
    await user.keyboard(' ')
    expect(screen.getByRole('status')).toHaveTextContent(/^$/)
    expect(chips[2]).toHaveAttribute('aria-pressed', 'false')
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

/*
  The four parts for call notes (PLAN-V17 T3-3). A leaving view or row stays for its exit only
  once motion's features are there, and MotionRoot loads them a moment after the app starts. So
  `wrapMoving` renders with the features already loaded, as the app is by the time anyone presses
  anything. Then a move really runs, frame by frame, but jsdom has no layout: these tests prove
  where a move starts, where it ends, and what a view or a row is while it leaves (inert, or
  hidden at once with reduced motion), not the path it takes on screen.
*/

/** motion's features, there from the start. */
function WithFeatures({ children }: { children: ReactNode }) {
  return (
    <MotionRoot>
      <LazyMotion features={domMax} strict>
        {children}
      </LazyMotion>
    </MotionRoot>
  )
}

function wrapMoving(ui: ReactNode) {
  return render(ui, { wrapper: WithFeatures })
}

/** The script: a tick, and a button, so a test can see it kept and skipped. */
function PushScript() {
  const shown = useViewShown()
  const [asked, setAsked] = useState(false)
  return (
    <div>
      <p>{shown ? 'The script' : 'The script, covered'}</p>
      <label>
        <input
          type="checkbox"
          checked={asked}
          onChange={(event) => {
            setAsked(event.target.checked)
          }}
        />
        Asked
      </label>
      <button type="button">Copy script</button>
    </div>
  )
}

/** The note view. */
function PushNote() {
  const shown = useViewShown()
  return <textarea aria-label={shown ? 'Note' : 'Note, leaving'} />
}

function PushHarness({ start = false }: { start?: boolean }) {
  const [noting, setNoting] = useState(start)
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setNoting(true)
        }}
      >
        Log call
      </button>
      <button
        type="button"
        onClick={() => {
          setNoting(false)
        }}
      >
        Back
      </button>
      <PushView pushed={noting ? <PushNote /> : null} className="min-h-0 flex-1">
        <PushScript />
      </PushView>
    </>
  )
}

/** The views in the box now: the base view, then the pushed one while it is there. */
function views(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-slot=push-view] > [data-view]')]
}

function baseView(): HTMLElement {
  const base = document.querySelector<HTMLElement>('[data-slot=push-view] > [data-view=base]')
  if (!base) throw new Error('no base view')
  return base
}

function pressLogCall(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Log call' }))
}

function pressBack(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
}

describe('PushView', () => {
  it('shows the base view at once, in a box that clips the slide sideways', () => {
    wrapMoving(<PushHarness />)
    expect(document.querySelector('[data-slot=push-view]')).toHaveClass(
      'relative',
      'overflow-x-clip',
      'min-h-0',
      'flex-1',
    )
    const base = baseView()
    expect(views()).toEqual([base])
    expect(base).not.toHaveAttribute('inert')
    // The first view doesn't move in: the panel around it does.
    expect(base).toHaveStyle({ opacity: '1' })
    expect(screen.getByText('The script')).toBeInTheDocument()
  })

  it('push: the base view stays, inert at once, and stops painting when its leave has ended', async () => {
    wrapMoving(<PushHarness />)
    const base = baseView()
    pressLogCall()
    const [stays, note] = views()
    expect(stays).toBe(base)
    expect(base).toHaveAttribute('inert')
    // It keeps its place in the layout, and paints while it leaves.
    expect(base).not.toHaveAttribute('hidden')
    expect(base.style.visibility).toBe('')
    expect(note).toHaveAttribute('data-view', 'pushed')
    expect(note).not.toHaveAttribute('inert')
    // Where the note view starts, before the first frame.
    expect(note).toHaveStyle({ opacity: '0', transform: 'translateX(24px)' })
    // Its leave ends 24px to the left, faded, and then it doesn't paint.
    await waitFor(() => {
      expect(base).toHaveStyle({ visibility: 'hidden' })
    })
    expect(base).toHaveStyle({ opacity: '0', transform: 'translateX(-24px)' })
    expect(views()).toEqual([base, note])
    // Out of sight is out of reach of a screen reader too.
    expect(screen.queryByRole('button', { name: 'Copy script' })).toBeNull()
  })

  it('keeps what the base view holds: a tick made before Log call is there after Back', async () => {
    const user = userEvent.setup()
    wrapMoving(<PushHarness />)
    const base = baseView()
    await user.click(screen.getByRole('checkbox', { name: 'Asked' }))
    pressLogCall()
    await waitFor(() => {
      expect(base).toHaveStyle({ visibility: 'hidden' })
    })
    pressBack()
    expect(baseView()).toBe(base)
    expect(screen.getByRole('checkbox', { name: 'Asked' })).toBeChecked()
  })

  it('takes the covered base view out of the tab order, and puts it back on Back', async () => {
    const user = userEvent.setup()
    wrapMoving(<PushHarness />)
    const base = baseView()
    pressLogCall()
    await waitFor(() => {
      expect(base).toHaveStyle({ visibility: 'hidden' })
    })
    screen.getByRole('textbox', { name: 'Note' }).focus()
    for (let step = 0; step < 6; step += 1) {
      await user.tab()
      expect(base.contains(document.activeElement)).toBe(false)
    }
    pressBack()
    screen.getByRole('button', { name: 'Back' }).focus()
    await user.tab()
    expect(screen.getByRole('checkbox', { name: 'Asked' })).toHaveFocus()
  })

  it('back: the base view is shown at once, so it can take the focus, and the note view leaves', async () => {
    // Opened on the note view: the script is out of sight from the start, and nothing slides.
    wrapMoving(<PushHarness start />)
    const base = baseView()
    const [, note] = views()
    expect(base).toHaveAttribute('inert')
    expect(base).toHaveStyle({ visibility: 'hidden' })
    expect(note).toHaveStyle({ opacity: '1' })

    pressBack()
    expect(baseView()).toBe(base)
    expect(base).not.toHaveAttribute('inert')
    expect(base.style.visibility).toBe('')
    screen.getByRole('button', { name: 'Copy script' }).focus()
    expect(screen.getByRole('button', { name: 'Copy script' })).toHaveFocus()
    expect(note).toHaveAttribute('inert')
    await waitFor(() => {
      expect(views()).toEqual([base])
    })
  })

  it('a second press half way never jumps: each view is the same element all along', async () => {
    wrapMoving(<PushHarness />)
    const base = baseView()
    pressLogCall()
    const [, note] = views()
    // Back half way: the script comes back, and the note view leaves, inert.
    pressBack()
    expect(views()).toEqual([base, note])
    expect(base).not.toHaveAttribute('inert')
    expect(note).toHaveAttribute('inert')
    // Log call half way back: the note view comes back as the same element.
    pressLogCall()
    expect(views()).toEqual([base, note])
    expect(note).not.toHaveAttribute('inert')
    expect(base).toHaveAttribute('inert')
    await waitFor(() => {
      expect(base).toHaveStyle({ visibility: 'hidden' })
    })
    expect(views()).toEqual([base, note])
  })

  it('tells each view whether it is the one on show', () => {
    wrapMoving(<PushHarness />)
    pressLogCall()
    expect(screen.getByText('The script, covered')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Note' })).toBeInTheDocument()
    pressBack()
    expect(screen.getByText('The script')).toBeInTheDocument()
    expect(screen.getByLabelText('Note, leaving')).toBeInTheDocument()
  })

  it('simply swaps with reduced motion: the base view is hidden at once, and the note view is there', async () => {
    askForReducedMotion()
    wrapMoving(<PushHarness />)
    const base = baseView()
    pressLogCall()
    const [, note] = views()
    expect(base).toHaveAttribute('inert')
    expect(base).toHaveStyle({ visibility: 'hidden' })
    expect(note).toHaveStyle({ opacity: '1' })
    expect(note?.style.transform).not.toContain('translate')

    pressBack()
    expect(base.style.visibility).toBe('')
    expect(base).toHaveStyle({ opacity: '1' })
    expect(base.style.transform).not.toContain('translate')
    expect(note).toHaveAttribute('hidden')
    await waitFor(() => {
      expect(views()).toEqual([base])
    })
  })
})

function ListHarness({ count = 3 }: { count?: number }) {
  const [rows, setRows] = useState(() =>
    Array.from({ length: count }, (_, index) => `Call ${index + 1}`),
  )
  return (
    <ListExit aria-label="Calls to confirm" className="flex flex-col gap-3">
      {rows.map((row) => (
        <ListExitItem key={row}>
          <span>{row}</span>
          <button type="button" onClick={() => setRows((now) => now.filter((r) => r !== row))}>
            Leave out {row}
          </button>
        </ListExitItem>
      ))}
    </ListExit>
  )
}

/** The rows a person can see now, by name. A row hidden at once is not one of them. */
function rowNames(): (string | null | undefined)[] {
  return screen.getAllByRole('listitem').map((row) => row.firstElementChild?.textContent)
}

/** Every row in the list, hidden or not. */
function allRows(): NodeListOf<HTMLLIElement> {
  return document.querySelectorAll<HTMLLIElement>('[data-slot=list-exit] > li')
}

describe('ListExit', () => {
  it('is a list of rows, set up so a leaving row can be pinned where it was', () => {
    wrapMoving(<ListHarness />)
    expect(screen.getByRole('list', { name: 'Calls to confirm' })).toHaveClass(
      'relative',
      'flex',
      'flex-col',
      'gap-3',
    )
    expect(rowNames()).toEqual(['Call 1', 'Call 2', 'Call 3'])
  })

  it('keeps a leaving row while it fades, inert, and then it is gone', async () => {
    wrapMoving(<ListHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Leave out Call 2' }))
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[1]).toHaveTextContent('Call 2')
    expect(rows[1]).toHaveAttribute('inert')
    expect(rows[0]).not.toHaveAttribute('inert')
    expect(rows[2]).not.toHaveAttribute('inert')
    await waitFor(() => {
      expect(rowNames()).toEqual(['Call 1', 'Call 3'])
    })
    expect(allRows()).toHaveLength(2)
  })

  it('moves nothing in a list of more than 50 rows: a leaving row is gone at once', async () => {
    // 52 rows, so 51 are left after one goes: still more than 50.
    wrapMoving(<ListHarness count={LIST_EXIT_MAX + 2} />)
    fireEvent.click(screen.getByRole('button', { name: 'Leave out Call 2' }))
    expect(rowNames()).toHaveLength(LIST_EXIT_MAX + 1)
    expect(rowNames()).not.toContain('Call 2')
    await waitFor(() => {
      expect(allRows()).toHaveLength(LIST_EXIT_MAX + 1)
    })
  })

  it('moves nothing with reduced motion: a leaving row is gone at once', async () => {
    askForReducedMotion()
    wrapMoving(<ListHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Leave out Call 2' }))
    expect(rowNames()).toEqual(['Call 1', 'Call 3'])
    await waitFor(() => {
      expect(allRows()).toHaveLength(2)
    })
  })
})

/** Each bar's scaleY now, read from the transform motion writes ("none" is 1). */
function meterScales(): number[] {
  return [...document.querySelectorAll<HTMLElement>('[data-slot=level-bar]')].map((bar) => {
    if (bar.style.transform === 'none') {
      return 1
    }
    const match = /^scaleY\(([\d.]+)\)$/.exec(bar.style.transform)
    return match ? Number(match[1]) : Number.NaN
  })
}

/** The bars for one level, drawn fresh, so no spring is on its way. */
function scalesAt(level: number): number[] {
  const { unmount } = wrap(<LevelMeter level={level} />)
  const scales = meterScales()
  unmount()
  return scales
}

function expectScales(actual: number[], expected: number[]) {
  expect(actual).toHaveLength(expected.length)
  expected.forEach((scale, bar) => {
    expect(actual[bar]).toBeCloseTo(scale)
  })
}

describe('LevelMeter', () => {
  it('shows five bars hidden from screen readers, and the word, and announces nothing', () => {
    wrap(<LevelMeter level={0.4} />)
    const meter = document.querySelector('[data-slot=level-meter]')
    const bars = meter?.querySelectorAll('[data-slot=level-bar]') ?? []
    expect(bars).toHaveLength(5)
    expect(bars[0]?.parentElement).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('Listening')).toBeVisible()
    expect(meter).not.toHaveAttribute('aria-live')
    expect(meter).not.toHaveAttribute('role')
    expect(meter?.querySelector('[aria-live], [role=status], [role=alert], [role=log]')).toBeNull()
  })

  it("turns the level into each bar's height from the bottom: its own share, never under 15%", () => {
    const silent = scalesAt(0)
    expect(silent).toEqual([0.15, 0.15, 0.15, 0.15, 0.15])
    const loud = scalesAt(1)
    expectScales(loud, [0.575, 0.83, 1, 0.83, 0.575])
    expectScales(scalesAt(0.5), [0.3625, 0.49, 0.575, 0.49, 0.3625])
    // Held to 0 to 1, and a level that isn't a number is silence.
    expect(scalesAt(3)).toEqual(loud)
    expect(scalesAt(-1)).toEqual(silent)
    expect(scalesAt(Number.NaN)).toEqual(silent)
    wrap(<LevelMeter level={0} />)
    for (const bar of document.querySelectorAll('[data-slot=level-bar]')) {
      expect(bar).toHaveClass('origin-bottom')
    }
  })

  it('follows a new level on its spring, and settles there', async () => {
    const { rerender } = wrapMoving(<LevelMeter level={0} />)
    rerender(<LevelMeter level={1} />)
    await waitFor(() => {
      expectScales(meterScales(), [0.575, 0.83, 1, 0.83, 0.575])
    })
  })

  it('never moves by itself: with the same level, every bar stays where it is', async () => {
    wrapMoving(<LevelMeter level={0.5} />)
    const before = meterScales()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150))
    })
    expect(meterScales()).toEqual(before)
  })

  it('is a still dot and the same word with reduced motion', () => {
    askForReducedMotion()
    wrap(<LevelMeter level={0.8} />)
    const meter = document.querySelector('[data-slot=level-meter]')
    expect(meter?.querySelector('[data-slot=level-bar]')).toBeNull()
    expect(meter?.querySelector('svg.lucide-circle-dot')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('Listening')).toBeVisible()
  })
})

describe('TickIn', () => {
  it('starts with no line, and is hidden from screen readers', () => {
    wrap(<TickIn />)
    const tick = document.querySelector('[data-slot=tick-in]')
    expect(tick).toHaveAttribute('aria-hidden', 'true')
    const path = tick?.querySelector('path')
    expect(path).toHaveAttribute('stroke-dasharray', '0 1')
    expect(path).toHaveStyle({ opacity: '0' })
  })

  it('draws once, and a new render never draws it again', async () => {
    const { rerender } = wrapMoving(<TickIn />)
    const path = document.querySelector('[data-slot=tick-in] path')
    await waitFor(() => {
      expect(path).toHaveAttribute('stroke-dasharray', '1 1')
    })
    rerender(<TickIn className="text-pass-ink" />)
    expect(document.querySelector('[data-slot=tick-in] path')).toBe(path)
    expect(path).toHaveAttribute('stroke-dasharray', '1 1')
  })

  it('is simply there with reduced motion', () => {
    askForReducedMotion()
    wrap(<TickIn />)
    const path = document.querySelector('[data-slot=tick-in] path')
    expect(path).toHaveAttribute('stroke-dasharray', '1 1')
    expect(path).not.toHaveStyle({ opacity: '0' })
  })
})
