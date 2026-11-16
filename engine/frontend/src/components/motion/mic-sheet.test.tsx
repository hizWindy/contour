import { screen, waitFor } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { MIC_SHEET_WIDTH, placeCard } from './card-place'
import { MicSheet, MicSheetTitle } from './mic-sheet'

/*
  The mic card's sheet (PLAN-V18 T3-4): it grows from the button that opened it, above it when
  there is room, a real dialog that Esc closes, and in the middle of the window with no button.
*/

const VIEW = { width: 1440, height: 900 }

describe('where the card sits', () => {
  it('sits above its button when there is room, its right edge on the button’s, growing from it', () => {
    const button = { left: 1300, top: 700, width: 44, height: 44 }
    const place = placeCard(button, VIEW)
    expect(place.top).toBeUndefined()
    // Held by its bottom edge, 8px above the button, so it grows upward.
    expect(place.bottom).toBe(900 - 700 + 8)
    expect(place.left).toBe(1344 - MIC_SHEET_WIDTH)
    // The button's middle is the transform origin: 22px in from its left, 30px under the card.
    expect(place.origin).toBe(`${String(1322 - place.left)}px calc(100% + 30px)`)
    expect(place.maxHeight).toBe(700 - 8 - 16)
  })

  it('sits below its button near the top of the window, and stays inside the window', () => {
    const button = { left: 8, top: 120, width: 44, height: 44 }
    const place = placeCard(button, VIEW)
    expect(place.bottom).toBeUndefined()
    expect(place.top).toBe(120 + 44 + 8)
    // Pushed right to stay 16px inside the window.
    expect(place.left).toBe(16)
    expect(place.origin).toBe(`${String(30 - 16)}px -30px`)
  })

  it('fits a narrow window', () => {
    const place = placeCard(
      { left: 300, top: 600, width: 44, height: 44 },
      { width: 360, height: 800 },
    )
    expect(place.left).toBe(16)
  })
})

function Host({
  withButton = true,
  onChange,
}: {
  withButton?: boolean
  onChange?: (open: boolean) => void
}) {
  const button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => {
          setOpen(true)
        }}
      >
        Speak
      </button>
      <MicSheet
        open={open}
        anchor={withButton ? button : null}
        onOpenChange={(next) => {
          onChange?.(next)
          setOpen(next)
        }}
      >
        <MicSheetTitle>Checking your mic</MicSheetTitle>
        <p>The check</p>
      </MicSheet>
    </>
  )
}

describe('MicSheet', () => {
  it('opens as a dialog named by its title, beside the button, and Esc closes it', async () => {
    const changes = vi.fn()
    const { user } = renderWithProviders(<Host onChange={changes} />)
    await user.click(screen.getByRole('button', { name: 'Speak' }))
    const dialog = await screen.findByRole('dialog', { name: 'Checking your mic' })
    expect(dialog).toHaveAttribute('data-slot', 'mic-sheet')
    // jsdom has no layout: the button is at the window's top left, so the card sits below it.
    expect(dialog).toHaveAttribute('data-place', 'below')
    expect(dialog.style.transformOrigin).not.toBe('')
    // The page behind dims.
    expect(document.querySelector('[data-slot=mic-sheet-overlay]')).not.toBeNull()

    await user.keyboard('{Escape}')
    expect(changes).toHaveBeenCalledWith(false)
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    // The focus goes back to the button it grew from.
    expect(screen.getByRole('button', { name: 'Speak' })).toHaveFocus()
  })

  it('sits in the middle of the window when no button opened it', async () => {
    const { user } = renderWithProviders(<Host withButton={false} />)
    await user.click(screen.getByRole('button', { name: 'Speak' }))
    const dialog = await screen.findByRole('dialog', { name: 'Checking your mic' })
    expect(dialog).toHaveAttribute('data-place', 'middle')
    expect(dialog.style.transformOrigin).toBe('center')
  })
})
