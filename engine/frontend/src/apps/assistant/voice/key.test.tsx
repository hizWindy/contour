/**
 * The V key (PLAN-V22 T3-1, "Decided in chat" 2): V starts the voice bar on any page, but not in a
 * box (it types a "v"), not with Ctrl, Cmd, Alt or Shift (Ctrl+V still pastes), not as a held
 * key's repeat, not through an input method, not while a dialog, menu or list box is open, and
 * never for a Viewer. The bar's code loads once the page is idle, or on the first V. The bar itself
 * is a stand-in here; `bar.test.tsx` has the real one.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SignIn } from '@/api/hooks/auth'
import { queryKeys } from '@/api/query'
import { fakeIdle } from '@/test/fake-idle'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { VoiceKey } from './key'
import { closeVoiceBar, isVoiceBarOpen, wantVoiceCode } from './store'
import { setVKeyOn } from './v-switch'

vi.mock('./bar', async () => {
  const { useVoiceBarOpen } = await import('./store')
  function StandInBar() {
    const open = useVoiceBarOpen()
    return (
      <>
        <span data-testid="bar-code" />
        {open ? <p>The bar is open</p> : null}
      </>
    )
  }
  return { default: StandInBar }
})

const VIEWER: SignIn = {
  state: 'signed_in',
  user: {
    id: '11111111-2222-3333-4444-555555555555',
    email: 'jo@example.test',
    username: 'jo',
    name: 'Jo Sample',
    position: null,
    role: 'viewer',
    apps: ['companies'],
    features: ['companies.call_logs', 'companies.meetings'],
  },
}

function renderKey({
  signIn = { state: 'off' },
  page,
}: { signIn?: SignIn; page?: ReactNode } = {}) {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), signIn)
  return renderWithProviders(
    <>
      {page}
      <VoiceKey />
    </>,
    { queryClient },
  )
}

/** Presses a key on the page, as the browser would. False when the key was taken. */
function press(init: KeyboardEventInit, target: Element = document.body): boolean {
  return fireEvent.keyDown(target, init)
}

afterEach(() => {
  act(() => {
    closeVoiceBar()
    setVKeyOn(true)
  })
})

describe('the V key', () => {
  it('V starts the bar, and the bar’s code loads on that first V', async () => {
    const { user } = renderKey()
    expect(screen.queryByTestId('bar-code')).toBeNull()
    await user.keyboard('v')
    expect(await screen.findByText('The bar is open')).toBeInTheDocument()
    expect(isVoiceBarOpen()).toBe(true)
  })

  it('a capital V with Caps Lock on starts it too', () => {
    renderKey()
    expect(press({ key: 'V' })).toBe(false)
    expect(isVoiceBarOpen()).toBe(true)
  })

  it('V in a box types a "v"', async () => {
    const { user } = renderKey({ page: <input aria-label="Company" /> })
    const box = screen.getByRole('textbox', { name: 'Company' })
    await user.click(box)
    await user.keyboard('v')
    expect(box).toHaveValue('v')
    expect(isVoiceBarOpen()).toBe(false)
  })

  it('V in a text area, a select or editable text is typing too', () => {
    renderKey({
      page: (
        <>
          <textarea aria-label="Note" />
          <select aria-label="Outcome">
            <option>Voicemail</option>
          </select>
          <div contentEditable suppressContentEditableWarning aria-label="Script">
            Hello
          </div>
        </>
      ),
    })
    for (const target of [
      screen.getByRole('textbox', { name: 'Note' }),
      screen.getByRole('combobox', { name: 'Outcome' }),
      screen.getByLabelText('Script'),
    ]) {
      expect(press({ key: 'v' }, target)).toBe(true)
    }
    expect(isVoiceBarOpen()).toBe(false)
  })

  it('Ctrl+V and Cmd+V paste: the key is left to the browser', () => {
    renderKey()
    expect(press({ key: 'v', ctrlKey: true })).toBe(true)
    expect(press({ key: 'v', metaKey: true })).toBe(true)
    expect(press({ key: 'v', altKey: true })).toBe(true)
    expect(isVoiceBarOpen()).toBe(false)
  })

  it('Shift+V does nothing', () => {
    renderKey()
    expect(press({ key: 'V', shiftKey: true })).toBe(true)
    expect(isVoiceBarOpen()).toBe(false)
  })

  it('a held V does nothing more: its repeats never start the bar', () => {
    renderKey()
    expect(press({ key: 'v', repeat: true })).toBe(true)
    expect(isVoiceBarOpen()).toBe(false)
    // The first press starts it, and the repeats that follow leave it to the bar.
    expect(press({ key: 'v' })).toBe(false)
    expect(press({ key: 'v', repeat: true })).toBe(true)
    expect(isVoiceBarOpen()).toBe(true)
  })

  it('an input method building a word keeps the key', () => {
    renderKey()
    expect(press({ key: 'v', isComposing: true })).toBe(true)
    expect(press({ key: 'Process' })).toBe(true)
    expect(isVoiceBarOpen()).toBe(false)
  })

  it.each(['dialog', 'alertdialog', 'menu', 'listbox'])('V with a %s open does nothing', (role) => {
    renderKey({ page: <div role={role} aria-label="Open thing" /> })
    expect(press({ key: 'v' })).toBe(true)
    expect(isVoiceBarOpen()).toBe(false)
  })

  it('a key another part already took is left alone', () => {
    renderKey({
      page: (
        <button
          type="button"
          onKeyDown={(event) => {
            event.preventDefault()
          }}
        >
          Takes its keys
        </button>
      ),
    })
    expect(press({ key: 'v' }, screen.getByRole('button', { name: 'Takes its keys' }))).toBe(false)
    expect(isVoiceBarOpen()).toBe(false)
  })

  it('a Viewer has no V (choice 18)', () => {
    renderKey({ signIn: VIEWER })
    expect(press({ key: 'v' })).toBe(true)
    expect(isVoiceBarOpen()).toBe(false)
  })
})

describe('V over call prep, and the V switch (PLAN-V23 T4-1)', () => {
  /** Call prep's panel as it marks itself on a laptop, with a box of its own. */
  const prep = (
    <div role="dialog" aria-label="Call prep" data-voice-company="201">
      <input aria-label="Line edit" />
    </div>
  )

  it('V over call prep starts the bar', () => {
    renderKey({ page: prep })
    expect(press({ key: 'v' })).toBe(false)
    expect(isVoiceBarOpen()).toBe(true)
  })

  it('V in a box of call prep still types a "v"', async () => {
    const { user } = renderKey({ page: prep })
    const box = screen.getByRole('textbox', { name: 'Line edit' })
    await user.click(box)
    await user.keyboard('v')
    expect(box).toHaveValue('v')
    expect(isVoiceBarOpen()).toBe(false)
  })

  it('another dialog over call prep still holds V', () => {
    renderKey({
      page: (
        <>
          {prep}
          <div role="menu" aria-label="Calling" />
        </>
      ),
    })
    expect(press({ key: 'v' })).toBe(true)
    expect(isVoiceBarOpen()).toBe(false)
  })

  it('with V off, V does nothing, and the choice stays after a reload', () => {
    act(() => {
      setVKeyOn(false)
    })
    const first = renderKey()
    expect(press({ key: 'v' })).toBe(true)
    expect(isVoiceBarOpen()).toBe(false)
    // A reload: the page is drawn again, and reads the choice this browser keeps.
    first.unmount()
    renderKey()
    expect(press({ key: 'v' })).toBe(true)
    expect(isVoiceBarOpen()).toBe(false)
    act(() => {
      setVKeyOn(true)
    })
    expect(press({ key: 'v' })).toBe(false)
    expect(isVoiceBarOpen()).toBe(true)
  })
})

describe('the bar’s code', () => {
  it('loads once the page is idle, before any V', async () => {
    const idle = fakeIdle()
    renderKey()
    expect(screen.queryByTestId('bar-code')).toBeNull()
    expect(idle.waiting()).toBe(1)
    act(() => {
      idle.idle()
    })
    await waitFor(() => {
      expect(screen.getByTestId('bar-code')).toBeInTheDocument()
    })
    // Loaded, not opened.
    expect(screen.queryByText('The bar is open')).toBeNull()
  })

  it('never loads for a Viewer', () => {
    const idle = fakeIdle()
    renderKey({ signIn: VIEWER })
    expect(idle.waiting()).toBe(0)
    expect(screen.queryByTestId('bar-code')).toBeNull()
  })
})

// Last in the file: once wanted, the bar's code stays wanted for the page's life.
describe('the bar’s code, wanted by a review card (PLAN-V23 T4-3)', () => {
  it('loads when a card opens from a button or Ctrl+K, before any V, and the bar stays shut', async () => {
    fakeIdle()
    renderKey()
    expect(screen.queryByTestId('bar-code')).toBeNull()
    act(() => {
      wantVoiceCode()
    })
    await waitFor(() => {
      expect(screen.getByTestId('bar-code')).toBeInTheDocument()
    })
    expect(screen.queryByText('The bar is open')).toBeNull()
  })
})
