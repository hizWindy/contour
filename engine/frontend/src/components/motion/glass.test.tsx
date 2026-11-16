import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { REDUCED_MOTION } from '@/lib/use-media-query'
import { renderWithProviders } from '@/test/render'
import { GlassMenu } from './glass'
import { useGlassRow } from './glass-row'

/*
  The glass on the menu (Improvements 1, #7): one pane that follows the pointer from row to row, a
  pane under the selected row, nothing for a finger, the keyboard's focus followed, the row's own
  handlers kept, and plain still panes with reduced motion.
*/

function Row({
  label,
  selected = false,
  onEnter,
}: {
  label: string
  selected?: boolean
  onEnter?: () => void
}) {
  const glass = useGlassRow<HTMLButtonElement>(selected, { onPointerEnter: onEnter })
  return (
    <button type="button" className="relative isolate" {...glass.handlers}>
      {glass.layers}
      {label}
    </button>
  )
}

function Menu({ selected = 'Home', onEnter }: { selected?: string; onEnter?: () => void }) {
  return (
    <GlassMenu aria-label="Menu">
      {['Home', 'Runs', 'Results'].map((label) => (
        <Row key={label} label={label} selected={selected === label} onEnter={onEnter} />
      ))}
    </GlassMenu>
  )
}

/** The panes of one kind inside a row. */
function panes(row: string, kind: 'hover' | 'selected'): Element[] {
  const button = screen.getByRole('button', { name: row })
  return Array.from(button.querySelectorAll(`[data-slot=glass][data-kind=${kind}]`))
}

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

describe('the glass on the menu', () => {
  it('follows the pointer from row to row, one pane at a time, and goes when it leaves the menu', async () => {
    const { user } = renderWithProviders(<Menu />)
    // Nothing is hovered: no hover pane anywhere.
    expect(document.querySelector('[data-kind=hover]')).toBeNull()

    await user.hover(screen.getByRole('button', { name: 'Runs' }))
    expect(panes('Runs', 'hover')).toHaveLength(1)

    // On to the next row: the pane is in that row, and no longer in the one before.
    await user.hover(screen.getByRole('button', { name: 'Results' }))
    await waitFor(() => {
      expect(panes('Runs', 'hover')).toHaveLength(0)
    })
    expect(panes('Results', 'hover')).toHaveLength(1)
    expect(document.querySelectorAll('[data-kind=hover]')).toHaveLength(1)

    // Out of the menu: the pane fades away.
    fireEvent.pointerOut(screen.getByRole('button', { name: 'Results' }), {
      pointerType: 'mouse',
      relatedTarget: document.body,
    })
    await waitFor(() => {
      expect(document.querySelector('[data-kind=hover]')).toBeNull()
    })
  })

  it('keeps the pane while the pointer crosses between two rows of the menu', () => {
    renderWithProviders(<Menu />)
    const runs = screen.getByRole('button', { name: 'Runs' })
    const nav = screen.getByRole('navigation', { name: 'Menu' })
    fireEvent.pointerOver(runs, { pointerType: 'mouse' })
    expect(panes('Runs', 'hover')).toHaveLength(1)
    // The pointer moves out of the row but stays inside the menu (the gap between two rows):
    // the pane stays where it was.
    fireEvent.pointerOut(runs, { pointerType: 'mouse', relatedTarget: nav })
    expect(panes('Runs', 'hover')).toHaveLength(1)
  })

  it('puts the selected pane under the page you are on, and moves it with the page', () => {
    const { rerender } = renderWithProviders(<Menu selected="Home" />)
    expect(panes('Home', 'selected')).toHaveLength(1)
    expect(panes('Runs', 'selected')).toHaveLength(0)
    rerender(<Menu selected="Runs" />)
    expect(panes('Home', 'selected')).toHaveLength(0)
    expect(panes('Runs', 'selected')).toHaveLength(1)
    // It is decoration: a screen reader never hears it.
    expect(panes('Runs', 'selected')[0]).toHaveAttribute('aria-hidden', 'true')
  })

  it('is see-through white for a hover and the accent tint for the selected row', async () => {
    const { user } = renderWithProviders(<Menu selected="Home" />)
    await user.hover(screen.getByRole('button', { name: 'Runs' }))
    expect(panes('Runs', 'hover')[0]).toHaveClass(
      'bg-(--glass-fill)',
      'shadow-(--glass-hover-shadow)',
    )
    expect(panes('Home', 'selected')[0]).toHaveClass(
      'bg-(--glass-selected-fill)',
      'shadow-(--glass-selected-shadow)',
    )
    // Behind the row's own text, and with the row's own corners.
    expect(panes('Runs', 'hover')[0]).toHaveClass('-z-10', 'rounded-[inherit]')
  })

  it('never shows for a finger: a touch screen has no hover', () => {
    renderWithProviders(<Menu />)
    fireEvent.pointerOver(screen.getByRole('button', { name: 'Runs' }), { pointerType: 'touch' })
    expect(document.querySelector('[data-kind=hover]')).toBeNull()
  })

  it('follows the keyboard: focus calls it up, and leaving a row takes it away', async () => {
    const { user } = renderWithProviders(<Menu />)
    await user.tab()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Runs' })).toHaveFocus()
    expect(panes('Runs', 'hover')).toHaveLength(1)
    await user.tab()
    expect(screen.getByRole('button', { name: 'Results' })).toHaveFocus()
    await waitFor(() => {
      expect(panes('Runs', 'hover')).toHaveLength(0)
    })
    expect(panes('Results', 'hover')).toHaveLength(1)
  })

  it("keeps the row's own handlers", async () => {
    const onEnter = vi.fn()
    const { user } = renderWithProviders(<Menu onEnter={onEnter} />)
    await user.hover(screen.getByRole('button', { name: 'Runs' }))
    expect(onEnter).toHaveBeenCalled()
  })

  it('shows no hover pane for a row outside a menu, and still shows the selected one', () => {
    renderWithProviders(<Row label="Alone" selected />)
    fireEvent.pointerOver(screen.getByRole('button', { name: 'Alone' }), { pointerType: 'mouse' })
    expect(panes('Alone', 'hover')).toHaveLength(0)
    expect(panes('Alone', 'selected')).toHaveLength(1)
  })

  it('is plain and still with reduced motion: the panes are simply there', async () => {
    askForReducedMotion()
    const { user } = renderWithProviders(<Menu selected="Home" />)
    await user.hover(screen.getByRole('button', { name: 'Runs' }))
    const hover = panes('Runs', 'hover')[0]
    const selected = panes('Home', 'selected')[0]
    expect(hover?.tagName).toBe('SPAN')
    // No Motion element: no inline transform or opacity is ever set on it.
    expect(hover).not.toHaveAttribute('style')
    expect(selected).not.toHaveAttribute('style')
  })
})
