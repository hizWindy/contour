import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { startManualClock } from '@/test/render'
import { ShellSkeleton } from './shell-skeleton'

describe('the shape of the app while it loads (PLAN-V7 B3)', () => {
  it('tells a screen reader at once, in one line', () => {
    render(<ShellSkeleton />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading the page.')
  })

  it('shows its blocks only after 200 ms, so a fast start never flashes them', async () => {
    startManualClock()
    const { container } = render(<ShellSkeleton />)
    const blocks = () => container.querySelector('[aria-hidden="true"]')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(199)
    })
    expect(blocks()).toHaveClass('invisible')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(blocks()).not.toHaveClass('invisible')
  })

  it('has the menu, the top bar and a page header with a block, all still', () => {
    const { container } = render(<ShellSkeleton />)

    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(10)
    // Nothing moves (DESIGN.md): no pulse and no shimmer.
    expect(container.innerHTML).not.toMatch(/animate-pulse|shimmer/)
  })
})
