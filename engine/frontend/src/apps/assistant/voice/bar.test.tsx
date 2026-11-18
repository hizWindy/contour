/**
 * The voice bar on screen (PLAN-V22 T3-1), with a fake mic and voice tool and a fake server: it
 * rises and listens, V keeps the words, a held V does nothing more, Esc throws them away and gives
 * the focus back, a typed command works, V in the text line types a "v", the text line works with
 * no mic, and the answer goes to the seam (a page opens, the review card opens, or the read-back
 * shows). Made-up names only: Sample Logistics Pty Ltd, Jo Sample.
 */
import type { QueryClient } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useLocation } from 'react-router'
import type {
  AssistantCommand,
  AssistantCommandIn,
  CallNoteOptions,
  CompanyDetail,
} from '@/api/types'
import { FakeMic, type FakeMicOptions } from '@/apps/companies/call-notes/mic/fake-mic'
import { PROBLEMS } from '@/apps/companies/call-notes/mic/words'
import type { SignIn } from '@/api/hooks/auth'
import { queryKeys } from '@/api/query'
import { mockApi, type Answer } from '@/test/mock-api'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import VoiceBar from './bar'
import type { Times } from './bar-session'
import { closeCard } from '../card/store'
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
  /** The voice tool setting. Left out: the browser's speech service. */
  voiceTool?: CallNoteOptions['voice_tool']
  /** The page the bar opens on, and what the page has loaded. */
  route?: string
  loaded?: (client: QueryClient) => void
  /** The command step's answer, as JSON or a function of the call. */
  answer?: AssistantCommand | Answer
  read?: (body: AssistantCommandIn, signal: AbortSignal) => Promise<AssistantCommand>
  /** Call notes switched on. Off: no one can log a call. */
  notesOn?: boolean
}

function openBar({
  signIn = { state: 'off' },
  mic: micOptions,
  voiceTool,
  route = '/',
  loaded,
  answer = command({}),
  read,
  notesOn = true,
}: Open = {}) {
  const mic = new FakeMic(micOptions)
  const calls = mockApi({
    [OPTIONS]: { ...options(voiceTool), enabled: notesOn },
    [COMMAND]: answer,
  })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), signIn)
  loaded?.(queryClient)
  const view = renderWithProviders(
    <>
      <button type="button">Where I was</button>
      <VoiceBar env={mic.env()} makeTool={mic.tool} times={QUIET} {...(read ? { read } : {})} />
      <Where />
    </>,
    { queryClient, route },
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
    // A task's answer opens the review card (T3-3): it closes with the test.
    closeCard()
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

  it('an answer that is no action shows its read-back, and Close closes', async () => {
    const line =
      'The Assistant can make a pre-read, log a call, add a task, email teammates or open a page.'
    const { mic, user } = openBar({ answer: command({ action: 'unknown', read_back: line }) })
    const found = await listening()
    act(() => {
      mic.say(SAID)
    })
    await user.keyboard('v')
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

/** The command step's answer for a refusal, as the server writes one. */
function refusal(status: number, code: string): Answer {
  return () =>
    Response.json(
      { title: "That didn't work", status, detail: 'Try again.', code },
      { status, headers: status === 429 || status === 503 ? { 'Retry-After': '30' } : {} },
    )
}

/** The bar's buttons, in the order they show. */
function buttons(found: HTMLElement): string[] {
  return within(found)
    .getAllByRole('button')
    .map((button) => button.textContent.replace(/(Esc|V|Enter)$/, '').trim())
}

/** Says something and presses V, as a rep would. */
async function say(
  found: HTMLElement,
  mic: FakeMic,
  words: string,
  user: { keyboard: (keys: string) => Promise<void> },
) {
  act(() => {
    mic.say(words)
  })
  expect(within(found).getByText(words)).toBeInTheDocument()
  await user.keyboard('v')
}

const VITERA: CompanyDetail = {
  key: '201',
  name: 'Vitera Pty Ltd',
  source: 'hubspot',
  deal: 'open',
  city: 'Melbourne',
  state: 'VIC',
  domain: null,
  website: null,
  industry: null,
  description: null,
  hubspot_url: null,
  owner: null,
  staff: null,
  linkedin_staff: null,
  lifecycle_stage: null,
  last_talk: null,
  last_talk_note: null,
  next_lease_end: null,
  lead: null,
  calls: [],
  deals: [],
  notes: [],
  offices: [],
  people: [
    { id: '9', name: 'Jo Sample', title: 'Office manager', phone: null, last_activity: null },
  ],
  people_status: 'ready',
}

describe('what each state shows (T3-2)', () => {
  it('listening: each chunk of words is its own part, so a new one fades in alone, and words still being heard are quieter', async () => {
    const { mic } = openBar()
    const found = await listening()
    act(() => {
      mic.say('Add a task')
    })
    act(() => {
      mic.say('to send the quote')
      mic.hear('on Monday')
    })
    const chunks = Array.from(found.querySelectorAll('[data-slot=live-chunk]'))
    expect(chunks.map((chunk) => chunk.textContent.trim())).toEqual([
      'Add a task',
      'to send the quote',
    ])
    expect(found.querySelector('[data-slot=live-hearing]')).toHaveTextContent('on Monday')
    expect(found.querySelector('[data-slot=live-hearing]')).toHaveClass('text-muted-foreground')
  })

  it('the name fix: on a company’s page, a name heard nearly right is put right, and the bar says so', async () => {
    const { mic, commands, user } = openBar({
      route: '/companies/201',
      loaded: (client) => {
        client.setQueryData(queryKeys.companies.detail('201'), VITERA)
      },
    })
    const found = await listening()
    act(() => {
      mic.say('Log a call with Jo at Vitara')
    })
    expect(within(found).getByText('Log a call with Jo at Vitera')).toBeInTheDocument()
    expect(within(found).getByText('Changed Vitara to Vitera.')).toBeInTheDocument()
    await user.keyboard('v')
    await waitFor(() => {
      expect(commands().map((call) => call.body)).toEqual([
        { text: 'Log a call with Jo at Vitera', source: 'mic', on_page: { company_key: '201' } },
      ])
    })
  })

  it('nothing heard: the plan’s words, with Try again and Type instead, and Try again listens again', async () => {
    const { mic, user } = openBar()
    const found = await listening()
    await user.keyboard('v')
    expect(await within(found).findByRole('alert')).toHaveTextContent(
      "We didn't hear anything. Press V and speak, or type what to do.",
    )
    expect(buttons(found)).toEqual(['Type instead', 'Close', 'Try again'])
    await user.click(within(found).getByRole('button', { name: 'Try again' }))
    await listening()
    expect(mic.tools).toHaveLength(2)
  })

  it('working it out: the words stay, the title says so, and nothing spins', async () => {
    const { mic, user } = openBar({ read: () => new Promise(() => undefined) })
    const found = await listening()
    await say(found, mic, SAID, user)
    await waitFor(() => {
      expect(title(found)).toHaveTextContent('Working it out')
    })
    expect(within(found).getByText(SAID)).toBeInTheDocument()
    expect(found.querySelector('svg.animate-spin, [role=progressbar]')).toBeNull()
    expect(buttons(found)).toEqual(['Cancel'])
  })

  it('too many commands: the plan’s words, and no button but Close', async () => {
    const { mic, user } = openBar({ answer: refusal(429, 'too_many_commands') })
    const found = await listening()
    await say(found, mic, SAID, user)
    expect(await within(found).findByRole('alert')).toHaveTextContent(
      "That's a lot of commands in one minute. Wait a moment, then try again.",
    )
    expect(buttons(found)).toEqual(['Close'])
    expect(within(found).getByText(SAID)).toBeInTheDocument()
  })

  it('Claude slow or down: the plan’s words, the words kept, and Try again sends them again', async () => {
    let tries = 0
    const { mic, commands, user } = openBar({
      answer: (call) => {
        tries += 1
        // The second answer is no action, so the bar shows it (a task would open the card).
        return tries === 1
          ? refusal(503, 'claude_unavailable')(call)
          : Response.json(command({ action: 'unknown' }))
      },
    })
    const found = await listening()
    await say(found, mic, SAID, user)
    expect(await within(found).findByRole('alert')).toHaveTextContent(
      'That took too long. Your words are kept. Try again.',
    )
    expect(buttons(found)).toEqual(['Type instead', 'Close', 'Try again'])
    await user.click(within(found).getByRole('button', { name: 'Try again' }))
    await waitFor(() => {
      expect(found.querySelector('[data-slot=voice-answer]')).not.toBeNull()
    })
    expect(commands().map((call) => call.body)).toEqual([
      { text: SAID, source: 'mic' },
      { text: SAID, source: 'mic' },
    ])
  })

  it('Claude slow or down: Type instead puts the words in the text line', async () => {
    const { mic, user } = openBar({ answer: refusal(503, 'claude_unavailable') })
    const found = await listening()
    await say(found, mic, SAID, user)
    await within(found).findByRole('alert')
    await user.click(within(found).getByRole('button', { name: 'Type instead' }))
    const line = within(found).getByRole('textbox', { name: 'Type what to do' })
    expect(line).toHaveValue(SAID)
    expect(line).toHaveFocus()
  })

  it('the mic stops mid-talk: the mic’s own words, and Carry on keeps what was said', async () => {
    const { mic, user } = openBar()
    const found = await listening()
    act(() => {
      mic.say('Spoke to Jo Sample about the lease')
      mic.unplug()
    })
    expect(await within(found).findByRole('alert')).toHaveTextContent(PROBLEMS.cut_off.words)
    await user.click(within(found).getByRole('button', { name: 'Carry on' }))
    expect(within(found).getByRole('textbox', { name: 'Type what to do' })).toHaveValue(
      'Spoke to Jo Sample about the lease',
    )
  })

  it('a browser with no speech service: the text line, and a quiet line that says why', async () => {
    const { mic } = openBar({ mic: { speech: false } })
    const found = await bar()
    const line = await within(found).findByRole('textbox', { name: 'Type what to do' })
    await waitFor(() => {
      expect(line).toHaveFocus()
    })
    expect(within(found).getByText(PROBLEMS.no_speech_tool.words)).not.toHaveAttribute('role')
    expect(mic.asked).toEqual([])
  })

  it('while Whisper isn’t built: the text line, and says so', async () => {
    openBar({ voiceTool: 'browser_model' })
    const found = await bar()
    await within(found).findByRole('textbox', { name: 'Type what to do' })
    expect(
      within(found).getByText("Turning speech into words isn't set up here yet. Type what to do."),
    ).toBeInTheDocument()
  })

  it('with the AI off and call notes off: says the Assistant can’t read commands yet', async () => {
    // A rep who logs calls gets Log call with the words instead (T3-5, `card/actions.test.tsx`).
    const { mic, user } = openBar({ answer: refusal(409, 'assistant_off'), notesOn: false })
    const found = await listening()
    await say(found, mic, SAID, user)
    await waitFor(() => {
      expect(found.querySelector('[data-slot=voice-answer]')).toHaveTextContent(
        "The Assistant can't read commands yet.",
      )
    })
  })
})
