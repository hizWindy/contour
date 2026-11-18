/**
 * The voice bar on screen (PLAN-V22 T3-1), with a fake mic and voice tool and a fake server: it
 * rises and listens, V keeps the words, a held V does nothing more, Esc throws them away and gives
 * the focus back, a typed command works, V in the text line types a "v", the text line works with
 * no mic, and the answer goes to the seam (a page opens, or the read-back shows until the review
 * card). Made-up names only: Sample Logistics Pty Ltd, Jo Sample.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useLocation } from 'react-router'
import type { AssistantCommand, AssistantCommandIn, CallNoteOptions } from '@/api/types'
import { FakeMic, type FakeMicOptions } from '@/apps/companies/call-notes/mic/fake-mic'
import { PROBLEMS } from '@/apps/companies/call-notes/mic/words'
import type { SignIn } from '@/api/hooks/auth'
import { queryKeys } from '@/api/query'
import { mockApi, type Answer } from '@/test/mock-api'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import VoiceBar from './bar'
import type { Times } from './bar-session'
import { closeVoiceBar, isVoiceBarOpen, openVoiceBar } from './store'

const OPTIONS = '/api/v1/companies/call-notes/options'
const COMMAND = '/api/v1/companies/assistant/command'
const BAR = 'Speak to the Assistant'
const SAID = 'Add a task to send Sample Logistics the quote on Monday'

/** No wait ends the talk by itself here: the keys and buttons do. */
const QUIET: Partial<Times> = { silence: 600_000, firstWords: 600_000, limit: 600_000 }

function options(voiceTool: CallNoteOptions['voice_tool'] = 'browser_service'): CallNoteOptions {
  return {
    enabled: true,
    ai_enabled: true,
    sending_ready: true,
    waiting_for: null,
    outcomes: ['Connected', 'No answer'],
    fields: [],
    soft_seconds: 180,
    max_chars: 6000,
    voice_tool: voiceTool,
  }
}

function command(change: Partial<AssistantCommand>): AssistantCommand {
  return {
    action: 'task',
    read_back: 'Add a task for you: send Sample Logistics the quote, due Mon 24 Nov.',
    company: null,
    person: null,
    meeting: null,
    note_text: null,
    task: null,
    email: null,
    open: null,
    change: null,
    unsure: null,
    ...change,
  }
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

interface Open {
  /** Who is signed in. Left out: sign-in is off. */
  signIn?: SignIn
  mic?: FakeMicOptions
  /** The command step's answer, as JSON or a function of the call. */
  answer?: AssistantCommand | Answer
  read?: (body: AssistantCommandIn, signal: AbortSignal) => Promise<AssistantCommand>
}

function openBar({
  signIn = { state: 'off' },
  mic: micOptions,
  answer = command({}),
  read,
}: Open = {}) {
  const mic = new FakeMic(micOptions)
  const calls = mockApi({ [OPTIONS]: options(), [COMMAND]: answer })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), signIn)
  const view = renderWithProviders(
    <>
      <button type="button">Where I was</button>
      <VoiceBar env={mic.env()} makeTool={mic.tool} times={QUIET} {...(read ? { read } : {})} />
      <Where />
    </>,
    { queryClient },
  )
  screen.getByRole('button', { name: 'Where I was' }).focus()
  act(() => {
    openVoiceBar()
  })
  const commands = () => calls.filter((call) => call.path === COMMAND)
  return { mic, calls, commands, ...view }
}

async function bar() {
  return screen.findByRole('dialog', { name: BAR })
}

/** The bar's own line at the top: where it stands. */
function title(found: HTMLElement): HTMLElement | null {
  return found.querySelector<HTMLElement>('[data-slot=voice-title]')
}

async function listening() {
  const found = await bar()
  await waitFor(() => {
    expect(title(found)).toHaveTextContent('Listening')
  })
  return found
}

afterEach(() => {
  act(() => {
    closeVoiceBar()
  })
})

describe('the voice bar', () => {
  it('rises and listens, with the words as they come, and takes the focus', async () => {
    const { mic } = openBar()
    const found = await listening()
    expect(found).toHaveAttribute('data-slot', 'voice-bar')
    expect(found).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('Listening')
    expect(within(found).getByText('Your words show here as you speak.')).toBeInTheDocument()
    act(() => {
      mic.say('Add a task')
      mic.hear('to send the quote')
    })
    expect(within(found).getByText(/Add a task/)).toBeInTheDocument()
    expect(within(found).getByText('to send the quote')).toHaveClass('text-muted-foreground')
  })

  it('V keeps the words: they go to the command step, and it says Working it out with nothing spinning', async () => {
    const sent: AssistantCommandIn[] = []
    const { mic, user } = openBar({
      read: (body) => {
        sent.push(body)
        return new Promise(() => undefined)
      },
    })
    const found = await listening()
    act(() => {
      mic.say(SAID)
    })
    await user.keyboard('v')
    await waitFor(() => {
      expect(title(found)).toHaveTextContent('Working it out')
    })
    expect(screen.getByRole('status')).toHaveTextContent('Working it out')
    expect(sent).toEqual([{ text: SAID, source: 'mic' }])
    // The words stay while the command step works.
    expect(within(found).getByText(SAID)).toBeInTheDocument()
    expect(found.querySelector('[role=progressbar], .animate-spin')).toBeNull()
    // The mic is let go as soon as the last words are in.
    expect(mic.live()).toBe(0)
  })

  it('a held V, Shift+V and Ctrl+V do nothing more while it listens', async () => {
    const { mic, commands } = openBar()
    const found = await listening()
    act(() => {
      mic.say(SAID)
    })
    fireEvent.keyDown(found, { key: 'v', repeat: true })
    fireEvent.keyDown(found, { key: 'V', shiftKey: true })
    fireEvent.keyDown(found, { key: 'v', ctrlKey: true })
    expect(title(found)).toHaveTextContent('Listening')
    expect(commands()).toEqual([])
  })

  it('Esc throws the words away, lets the mic go, and gives the focus back', async () => {
    const { mic, commands, user } = openBar()
    await listening()
    act(() => {
      mic.say(SAID)
    })
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: BAR })).toBeNull()
    })
    expect(isVoiceBarOpen()).toBe(false)
    expect(mic.live()).toBe(0)
    expect(commands()).toEqual([])
    expect(screen.getByRole('button', { name: 'Where I was' })).toHaveFocus()
  })

  it('a typed command works: Type instead, then Enter, and a page answer opens the page', async () => {
    const { commands, user } = openBar({
      answer: command({
        action: 'open',
        read_back: 'Open Today.',
        open: { page: 'today', company_key: null },
      }),
    })
    const found = await listening()
    await user.click(within(found).getByRole('button', { name: 'Type instead' }))
    const line = within(found).getByRole('textbox', { name: 'Type what to do' })
    expect(line).toHaveFocus()
    // V in the text line is a letter.
    await user.keyboard('open today v')
    expect(line).toHaveValue('open today v')
    await user.keyboard('{Backspace}{Backspace}{Enter}')
    await waitFor(() => {
      expect(screen.getByTestId('where')).toHaveTextContent('/assistant')
    })
    expect(commands().map((call) => call.body)).toEqual([{ text: 'open today', source: 'typed' }])
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: BAR })).toBeNull()
    })
  })

  it('with no mic, the text line still works, and says why', async () => {
    const { commands, user } = openBar({ mic: { devices: [] } })
    const found = await bar()
    const line = await within(found).findByRole('textbox', { name: 'Type what to do' })
    expect(line).toHaveFocus()
    expect(within(found).getByText(PROBLEMS.no_mic.words)).toBeInTheDocument()
    await user.keyboard('add a task to call Jo Sample on Friday{Enter}')
    await waitFor(() => {
      expect(commands().map((call) => call.body)).toEqual([
        { text: 'add a task to call Jo Sample on Friday', source: 'typed' },
      ])
    })
  })

  it('an answer that is not a page shows its read-back (until the review card), and Close closes', async () => {
    const { mic, user } = openBar()
    const found = await listening()
    act(() => {
      mic.say(SAID)
    })
    await user.keyboard('v')
    const line = 'Add a task for you: send Sample Logistics the quote, due Mon 24 Nov.'
    await waitFor(() => {
      expect(found.querySelector('[data-slot=voice-answer]')).toHaveTextContent(line)
    })
    // A screen reader hears the read-back.
    expect(screen.getByRole('status')).toHaveTextContent(line)
    await user.click(within(found).getByRole('button', { name: 'Close' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: BAR })).toBeNull()
    })
  })

  it('Done on the bar does what V does, for a mouse or a finger', async () => {
    const { mic, commands, user } = openBar()
    const found = await listening()
    act(() => {
      mic.say(SAID)
    })
    await user.click(within(found).getByRole('button', { name: /^Done/ }))
    await waitFor(() => {
      expect(commands().map((call) => call.body)).toEqual([{ text: SAID, source: 'mic' }])
    })
  })

  it('never opens for a Viewer, whatever asks for it (choice 18)', async () => {
    const { mic, calls } = openBar({
      signIn: {
        state: 'signed_in',
        user: {
          id: '11111111-2222-3333-4444-555555555555',
          email: 'jo@example.test',
          username: 'jo',
          name: 'Jo Sample',
          position: null,
          role: 'viewer',
          apps: ['companies'],
          features: ['companies.call_logs'],
        },
      },
    })
    await waitFor(() => {
      expect(calls.some((call) => call.path === OPTIONS)).toBe(true)
    })
    expect(screen.queryByRole('dialog', { name: BAR })).toBeNull()
    expect(mic.asked).toEqual([])
  })
})
