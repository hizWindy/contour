import { screen, waitFor } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { MicSheet, MicSheetTitle } from './mic-sheet'

/*
  The mic card's sheet (PLAN-V18 T3-4, and "centred" on 17 Nov 2026): a real dialog in the middle
  of the window, whichever button opened it. Esc closes it and the focus goes back to the button.
*/

function Host({
  withOpener = true,
  onChange,
}: {
  withOpener?: boolean
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
        opener={withOpener ? button : null}
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
  it('opens as a dialog named by its title, and Esc closes it', async () => {
    const changes = vi.fn()
    const { user } = renderWithProviders(<Host onChange={changes} />)
    await user.click(screen.getByRole('button', { name: 'Speak' }))
    const dialog = await screen.findByRole('dialog', { name: 'Checking your mic' })
    expect(dialog).toHaveAttribute('data-slot', 'mic-sheet')
    // The page behind dims.
    expect(document.querySelector('[data-slot=mic-sheet-overlay]')).not.toBeNull()

    await user.keyboard('{Escape}')
    expect(changes).toHaveBeenCalledWith(false)
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    // The focus goes back to the button that opened it.
    expect(screen.getByRole('button', { name: 'Speak' })).toHaveFocus()
  })

  it('sits in the middle of the window, grows from the middle, and keeps off the edges', async () => {
    const { user } = renderWithProviders(<Host />)
    await user.click(screen.getByRole('button', { name: 'Speak' }))
    const dialog = await screen.findByRole('dialog', { name: 'Checking your mic' })
    expect(dialog.style.transformOrigin).toBe('center')
    // Its holder centres it with room round it, not at the button: no position of its own.
    const holder = dialog.parentElement
    expect(holder).not.toBeNull()
    expect(holder?.className).toContain('items-center')
    expect(holder?.className).toContain('justify-center')
    expect(holder?.className).toContain('p-4')
    expect(dialog.style.left).toBe('')
    expect(dialog.style.top).toBe('')
    expect(dialog.style.bottom).toBe('')
    // And it scrolls inside itself when the window is short.
    expect(dialog.className).toContain('max-h-[calc(100dvh-2rem)]')
    expect(dialog.className).toContain('overflow-y-auto')
  })

  it('opens in the same place with no button, and the focus goes back to where it was', async () => {
    const { user } = renderWithProviders(<Host withOpener={false} />)
    const button = screen.getByRole('button', { name: 'Speak' })
    await user.click(button)
    const dialog = await screen.findByRole('dialog', { name: 'Checking your mic' })
    expect(dialog.style.transformOrigin).toBe('center')
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(button).toHaveFocus()
  })
})
