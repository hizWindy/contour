import { act, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { Pending, PendingDetail, PendingText } from './skeletons'

async function pass(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('loading shapes (PLAN-V7 B1)', () => {
  it('tell a screen reader at once, and show the shape only after 200 ms', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderWithProviders(
      <Pending label="Loading the leads.">
        <p>the shape</p>
      </Pending>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Loading the leads.')
    const shape = screen.getByText('the shape').parentElement as HTMLElement
    // The room is kept from the first moment, so nothing jumps; the blocks are not seen yet.
    expect(shape).toHaveAttribute('aria-hidden', 'true')
    expect(shape).toHaveClass('invisible')

    await pass(100)
    expect(shape).toHaveClass('invisible')

    await pass(300)
    expect(shape).not.toHaveClass('invisible')
    expect(shape).toHaveClass('fade-in-0')
  })

  it('give a detail page its words for a screen reader, and no pulsing blocks', () => {
    renderWithProviders(<PendingDetail label="Loading the lead." />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading the lead.')
    const blocks = document.querySelectorAll('[data-slot=skeleton]')
    expect(blocks.length).toBeGreaterThan(5)
    for (const block of blocks) {
      expect(block.className).not.toMatch(/animate-(pulse|spin|bounce)/)
    }
  })

  it('fit inside a sentence: a short line with words for a screen reader', () => {
    renderWithProviders(
      <p>
        Cost: <PendingText />
      </p>,
    )

    expect(screen.getByText('Loading.')).toHaveClass('sr-only')
    expect(screen.getByRole('status').tagName).toBe('SPAN')
  })
})
