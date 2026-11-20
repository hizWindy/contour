import { screen, waitFor, within } from '@testing-library/react'
import { useRef, useState, type ReactNode } from 'react'
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
  aside,
  onKeyDown,
}: {
  withOpener?: boolean
  onChange?: (open: boolean) => void
  /** Something beside the card, in its dialog layer (PLAN-V24 T5-1). */
  aside?: ReactNode
  onKeyDown?: (key: string) => void
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
        onKeyDown={(event) => {
          onKeyDown?.(event.key)
        }}
        {...(aside === undefined ? {} : { aside })}
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

  it('holds something beside the card in its own layer: the keys reach both, and the dimmed page still closes it (PLAN-V24 T5-1)', async () => {
    const changes = vi.fn()
    const keys: string[] = []
    const { user } = renderWithProviders(
      <Host
        onChange={changes}
        onKeyDown={(key) => keys.push(key)}
        aside={
          <div data-testid="beside">
            <button type="button">Stop</button>
          </div>
        }
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Speak' }))
    const dialog = await screen.findByRole('dialog', { name: 'Checking your mic' })
    // The card stays the card; what is beside it is in the dialog, not in the card.
    const card = dialog.querySelector<HTMLElement>('[data-slot=mic-sheet]')
    const beside = screen.getByTestId('beside')
    expect(dialog).toHaveAttribute('data-slot', 'mic-sheet-layer')
    expect(dialog.contains(beside)).toBe(true)
    expect(card?.contains(beside)).toBe(false)
    expect(card?.style.transformOrigin).toBe('center')
    // The layer takes no clicks itself; the card and what is beside it do.
    expect(dialog.style.pointerEvents).toBe('none')
    expect(card?.style.pointerEvents).toBe('auto')
    // The focus reaches it by Tab, and its keys reach the card's own.
    await user.tab()
    expect(within(dialog).getByRole('button', { name: 'Stop' })).toHaveFocus()
    await user.keyboard('v')
    expect(keys).toContain('v')
    // A click on the dimmed page around them still closes it.
    const overlay = document.querySelector<HTMLElement>('[data-slot=mic-sheet-overlay]')
    expect(overlay).not.toBeNull()
    await user.pointer({ keys: '[MouseLeft]', target: overlay as HTMLElement })
    expect(changes).toHaveBeenCalledWith(false)
  })

  it('without anything beside it, the card is the dialog, as the mic card has it', async () => {
    const { user } = renderWithProviders(<Host />)
    await user.click(screen.getByRole('button', { name: 'Speak' }))
    const dialog = await screen.findByRole('dialog', { name: 'Checking your mic' })
    expect(dialog).toHaveAttribute('data-slot', 'mic-sheet')
    expect(document.querySelector('[data-slot=mic-sheet-layer]')).toBeNull()
  })
})
