/**
 * The voice bar on screen (PLAN-V22 T3-1), with a fake mic and voice tool and a fake server: it
 * rises and listens, V keeps the words, a held V does nothing more, Esc throws them away and gives
 * the focus back, a typed command works, V in the text line types a "v", the text line works with
 * no mic, and the answer goes to the seam (a page opens, the review card opens, or the read-back
 * shows). PLAN-V23: the hint list on every page and "Try saying" (T1-5, T4-3), hold V (choice 6),
 * and the stop for unclear words (T1-6). PLAN-V24 T1-4: a mic another app holds. Made-up names
 * only: Sample Logistics Pty Ltd, Vitera Pty Ltd, Jo Sample.
 */
import type { QueryClient } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLocation } from 'react-router'
import type {
  AssistantCommand,
  AssistantCommandIn,
  AssistantNames,
  CallNoteOptions,
  CompanyDetail,
} from '@/api/types'
import { FakeMic, type FakeMicOptions } from '@/apps/companies/call-notes/mic/fake-mic'
import { busyWords, PROBLEMS } from '@/apps/companies/call-notes/mic/words'
import type { SignIn } from '@/api/hooks/auth'
import { queryKeys } from '@/api/query'
import { mockApi, type Answer } from '@/test/mock-api'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { asPhone } from '@/test/screen'
import VoiceBar from './bar'
import type { Times } from './bar-session'
import { closeCard } from '../card/store'
import { setKeepListening } from './keep-listening'
import { closeVoiceBar, isVoiceBarOpen, openVoiceBar, openVoiceBarByKey } from './store'
import { setVKeyOn } from './v-switch'

const OPTIONS = '/api/v1/companies/call-notes/options'
const COMMAND = '/api/v1/companies/assistant/command'
const NAMES = '/api/v1/companies/assistant/names'
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
  /** More of the page around the bar, like call prep's panel. */
  page?: ReactNode
  /** The hint list the server gives (PLAN-V23 T1-5). Left out: none (a 404). */
  names?: AssistantNames | Answer
  /** V opened the bar, and is still down (PLAN-V23 choice 6). */
  byKey?: boolean
  times?: Partial<Times>
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
  page,
  names,
  byKey = false,
  times = QUIET,
}: Open = {}) {
  const mic = new FakeMic(micOptions)
  const calls = mockApi({
    [OPTIONS]: { ...options(voiceTool), enabled: notesOn },
    [COMMAND]: answer,
    ...(names ? { [NAMES]: names } : {}),
  })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), signIn)
  loaded?.(queryClient)
  const view = renderWithProviders(
    <>
      <button type="button">Where I was</button>
      {page}
      <VoiceBar env={mic.env()} makeTool={mic.tool} times={times} {...(read ? { read } : {})} />
      <Where />
    </>,
    { queryClient, route },
  )
  screen.getByRole('button', { name: 'Where I was' }).focus()
  act(() => {
    if (byKey) openVoiceBarByKey()
    else openVoiceBar()
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

// One command per V, as these tests were written (PLAN-V24 T2-1: "Keep listening" off). The
// conversation's own tests switch it back on.
beforeEach(() => {
  setKeepListening(false)
})

afterEach(() => {
  act(() => {
    closeVoiceBar()
    // A task's answer opens the review card (T3-3): it closes with the test.
    closeCard()
    setVKeyOn(true)
    setKeepListening(true)
  })
})

describe('the voice bar', () => {
  it('rises and listens, with the words as they come, and takes the focus', async () => {
    const { mic } = openBar()
    const found = await listening()
    expect(found).toHaveAttribute('data-slot', 'voice-bar')
    expect(found).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('Listening')
    // Before the first word: what to say, one example for each card action.
    expect(within(found).getByText('Try saying')).toBeInTheDocument()
    expect(
      within(found).getByText('“Make the pre-read for my next meeting with Acme”'),
    ).toBeInTheDocument()
    expect(within(found).getAllByRole('listitem')).toHaveLength(4)
    act(() => {
      mic.say('Add a task')
      mic.hear('to send the quote')
    })
    expect(within(found).getByText(/Add a task/)).toBeInTheDocument()
    // The examples give way to the words.
    expect(within(found).queryByText('Try saying')).not.toBeInTheDocument()
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

  it('another app holds the mic: the words, Try again first, and Type instead (PLAN-V24 T1-4)', async () => {
    const { mic, user } = openBar({
      mic: { refuse: { name: 'NotReadableError', message: 'Could not start audio source' } },
    })
    const found = await bar()
    expect(await within(found).findByRole('alert')).toHaveTextContent(PROBLEMS.busy.words)
    expect(within(found).queryByText(/exclusive control/)).toBeNull()
    expect(within(found).queryByRole('textbox')).toBeNull()
    expect(within(found).getByRole('button', { name: 'Type instead' })).toBeInTheDocument()
    // Muted in the other app: Try again listens.
    mic.refuse = null
    await user.click(within(found).getByRole('button', { name: 'Try again' }))
    await listening()
  })

  it('another app holds the mic: Type instead opens the text line, ready to type', async () => {
    const { commands, user } = openBar({ mic: { refuse: { name: 'NotReadableError' } } })
    const found = await bar()
    await within(found).findByRole('alert')
    await user.click(within(found).getByRole('button', { name: 'Type instead' }))
    const line = within(found).getByRole('textbox', { name: 'Type what to do' })
    await waitFor(() => {
      expect(line).toHaveFocus()
    })
    await user.keyboard('open today{Enter}')
    await waitFor(() => {
      expect(commands().map((call) => call.body)).toEqual([{ text: 'open today', source: 'typed' }])
    })
  })

  it('another app holds the mic, on Windows: the line about exclusive control too', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
    openBar({ mic: { refuse: { name: 'NotReadableError' } } })
    const found = await bar()
    expect(await within(found).findByRole('alert')).toHaveTextContent(busyWords(true))
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
    expect(within(found).getByText("Speaking isn't available here yet.")).toBeInTheDocument()
    // The hint is an example, so "Type what to do" isn't said three times.
    expect(within(found).getByRole('textbox', { name: 'Type what to do' })).toHaveAttribute(
      'placeholder',
      'Like: add a task to send the quote on Friday',
    )
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

describe('over call prep, and with V off (PLAN-V23 T4-1)', () => {
  it('over call prep, a command that names no company uses the prepped one, and V keeps the words', async () => {
    const { mic, commands, user } = openBar({
      page: <div role="dialog" aria-label="Call prep" data-voice-company="201" />,
      loaded: (client) => {
        client.setQueryData(queryKeys.companies.detail('201'), VITERA)
      },
    })
    const found = await listening()
    act(() => {
      mic.say('Log a call with Jo at Vitara')
    })
    // The prepped company's names drive the name fix, as on its own page.
    expect(within(found).getByText('Log a call with Jo at Vitera')).toBeInTheDocument()
    // V over the panel is still the bar's: it keeps the words.
    await user.keyboard('v')
    await waitFor(() => {
      expect(commands().map((call) => call.body)).toEqual([
        { text: 'Log a call with Jo at Vitera', source: 'mic', on_page: { company_key: '201' } },
      ])
    })
  })

  it('with V off, V is a letter no more: Done has no key, and Done still works', async () => {
    act(() => {
      setVKeyOn(false)
    })
    const { mic, commands, user } = openBar()
    const found = await listening()
    act(() => {
      mic.say('Add a task')
    })
    await user.keyboard('v')
    expect(title(found)).toHaveTextContent('Listening')
    expect(commands()).toEqual([])
    const done = within(found).getByRole('button', { name: 'Done' })
    expect(done).not.toHaveAttribute('aria-keyshortcuts')
    expect(done).toHaveTextContent(/^Done$/)
    await user.click(done)
    await waitFor(() => {
      expect(commands().map((call) => call.body)).toEqual([{ text: 'Add a task', source: 'mic' }])
    })
  })
})

const HINTS: AssistantNames = {
  names: [
    { text: 'Vitera', kind: 'company', company_key: '301' },
    { text: 'Jo Sample', kind: 'person', company_key: '301' },
    { text: 'fitout', kind: 'word', company_key: null },
  ],
}

describe('the hint list (PLAN-V23 T1-5, T4-3)', () => {
  it('on Today, a name heard nearly right is put right from the hint list, not only on the company’s page', async () => {
    const { mic, calls, commands, user } = openBar({ route: '/assistant', names: HINTS })
    const found = await listening()
    // The list is in: "Try saying" names its first company, not Acme.
    expect(
      await within(found).findByText('“Make the pre-read for my next meeting with Vitera”'),
    ).toBeInTheDocument()
    expect(within(found).queryByText(/Acme/)).toBeNull()
    // Asked once, for no company: Today shows none.
    expect(calls.filter((call) => call.path === NAMES).map((call) => call.search)).toEqual([''])
    await act(async () => {
      await Promise.resolve()
    })
    act(() => {
      mic.say('Log a call with Jo at Vitara')
    })
    expect(within(found).getByText('Log a call with Jo at Vitera')).toBeInTheDocument()
    expect(within(found).getByText('Changed Vitara to Vitera.')).toBeInTheDocument()
    await user.keyboard('v')
    await waitFor(() => {
      expect(commands().map((call) => call.body)).toEqual([
        { text: 'Log a call with Jo at Vitera', source: 'mic' },
      ])
    })
  })

  it('on a company’s page, it asks for that company’s list', async () => {
    const { calls } = openBar({ route: '/companies/201', names: HINTS })
    await listening()
    await waitFor(() => {
      expect(calls.filter((call) => call.path === NAMES).map((call) => call.search)).toEqual([
        '?company_key=201',
      ])
    })
  })

  it('never asks for a Viewer', async () => {
    const { calls } = openBar({
      names: HINTS,
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
    expect(calls.some((call) => call.path === NAMES)).toBe(false)
  })
})

/** Waits on the real clock, for the short hold the tests give. */
async function pause(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

describe('hold V (PLAN-V23 choice 6)', () => {
  it('V held past the hold: letting go ends the talk, and the words go', async () => {
    const { mic, commands } = openBar({ byKey: true, times: { ...QUIET, hold: 20 } })
    await listening()
    act(() => {
      mic.say(SAID)
    })
    await pause(60)
    expect(commands()).toEqual([])
    fireEvent.keyUp(document.body, { key: 'v' })
    await waitFor(() => {
      expect(commands().map((call) => call.body)).toEqual([{ text: SAID, source: 'mic' }])
    })
  })

  it('a tap works as before: let go at once, and it listens on', async () => {
    const { mic, commands } = openBar({ byKey: true, times: { ...QUIET, hold: 20 } })
    fireEvent.keyUp(document.body, { key: 'v' })
    const found = await listening()
    act(() => {
      mic.say(SAID)
    })
    await pause(60)
    expect(title(found)).toHaveTextContent('Listening')
    expect(commands()).toEqual([])
  })

  it('a held V’s repeats type nothing, even in the text line the focus moved to', async () => {
    openBar({ byKey: true, mic: { devices: [] } })
    const found = await bar()
    const line = await within(found).findByRole('textbox', { name: 'Type what to do' })
    await waitFor(() => {
      expect(line).toHaveFocus()
    })
    expect(fireEvent.keyDown(line, { key: 'v', repeat: true })).toBe(false)
    expect(line).toHaveValue('')
    // Let go: a V pressed in the line now is a letter again, held or not.
    fireEvent.keyUp(line, { key: 'v' })
    expect(fireEvent.keyDown(line, { key: 'v', repeat: true })).toBe(true)
  })
})

describe('unclear words (PLAN-V23 T1-6)', () => {
  const LINE =
    "We didn't catch that clearly. You said: 'um the north'. Say it again, or fix the words."

  /** The first answer is unclear; the next is no action, so the bar shows it. */
  function unclearThenUnknown(): Answer {
    let tries = 0
    return () => {
      tries += 1
      return Response.json(
        tries === 1
          ? command({ action: 'unclear', read_back: 'um the north', unsure: LINE })
          : command({ action: 'unknown', read_back: 'The Assistant can open a page.' }),
      )
    }
  }

  it('stop before the card: the plan’s words, then the words in the text line, and Enter sends them', async () => {
    const { mic, commands, user } = openBar({ answer: unclearThenUnknown() })
    const found = await listening()
    await say(found, mic, 'um the north', user)
    expect(await within(found).findByRole('alert')).toHaveTextContent(LINE)
    const line = within(found).getByRole('textbox', { name: 'Type what to do' })
    expect(line).toHaveValue('um the north')
    expect(line).toHaveAccessibleDescription(LINE)
    await waitFor(() => {
      expect(line).toHaveFocus()
    })
    // The stop line comes before the text line.
    const alert = within(found).getByRole('alert')
    expect(alert.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(buttons(found)).toEqual(['Send', 'Say it again', 'Cancel'])
    expect(screen.queryByRole('dialog', { name: /Add a task/ })).toBeNull()
    await user.clear(line)
    await user.keyboard('open Northwind{Enter}')
    await waitFor(() => {
      expect(commands().map((call) => call.body)).toEqual([
        { text: 'um the north', source: 'mic' },
        { text: 'open Northwind', source: 'typed' },
      ])
    })
  })

  it('Say it again listens again', async () => {
    const { mic, user } = openBar({ answer: unclearThenUnknown() })
    const found = await listening()
    await say(found, mic, 'um the north', user)
    await user.click(await within(found).findByRole('button', { name: 'Say it again' }))
    await listening()
    expect(mic.tools).toHaveLength(2)
  })

  it('where the voice can’t work, the words wait in the text line with no Say it again', async () => {
    const { user } = openBar({ voiceTool: 'typing', answer: unclearThenUnknown() })
    const found = await bar()
    const line = await within(found).findByRole('textbox', { name: 'Type what to do' })
    await user.click(line)
    await user.keyboard('um the north{Enter}')
    expect(await within(found).findByRole('alert')).toHaveTextContent(LINE)
    expect(within(found).queryByRole('button', { name: 'Say it again' })).toBeNull()
  })
})

describe('a long conversation on screen (PLAN-V24 T2-1)', () => {
  beforeEach(() => {
    setKeepListening(true)
  })

  /** A short pause, so a turn ends in the test's own time. */
  const TALK: Partial<Times> = { ...QUIET, pause: 30, quiet: 600_000 }

  it('listens on after a command: Working it out with its words, then its line, and Stop (V) is the main button', async () => {
    let answer: (made: AssistantCommand) => void = () => undefined
    const { mic } = openBar({
      times: TALK,
      read: () =>
        new Promise((resolve) => {
          answer = resolve
        }),
    })
    const found = await listening()
    expect(buttons(found)).toEqual(['Type instead', 'Cancel', 'Stop'])
    expect(within(found).getByRole('button', { name: /^Stop/ })).toHaveAttribute(
      'aria-keyshortcuts',
      'V',
    )
    act(() => {
      mic.say(SAID)
    })
    await waitFor(() => {
      expect(title(found)).toHaveTextContent('Working it out')
    })
    // The command being read stays, quieter, and the bars still show: the mic is on.
    expect(found.querySelector('[data-slot=voice-working]')).toHaveTextContent(SAID)
    expect(found.querySelector('[data-slot=frequency-bars]')).not.toBeNull()
    expect(mic.live()).toBe(1)
    act(() => {
      answer(command({ action: 'unknown', read_back: 'The Assistant can open a page.' }))
    })
    await waitFor(() => {
      expect(found.querySelector('[data-slot=voice-line]')).toHaveTextContent(
        'The Assistant can open a page.',
      )
    })
    expect(title(found)).toHaveTextContent('Listening')
    // A screen reader hears the line once, in place of "Listening".
    expect(screen.getByRole('status')).toHaveTextContent('The Assistant can open a page.')
    expect(mic.live()).toBe(1)
  })

  it('Stop sends the command in progress, then stops listening', async () => {
    // No pause ends the turn here: Stop does.
    const { mic, commands, user } = openBar({
      times: { ...TALK, pause: 600_000 },
      answer: command({ action: 'unknown' }),
    })
    const found = await listening()
    act(() => {
      mic.say(SAID)
    })
    await user.click(within(found).getByRole('button', { name: /^Stop/ }))
    await waitFor(() => {
      expect(commands().map((call) => call.body)).toEqual([{ text: SAID, source: 'mic' }])
    })
    await waitFor(() => {
      expect(found.querySelector('[data-slot=voice-answer]')).not.toBeNull()
    })
    expect(mic.live()).toBe(0)
  })

  it('the quiet stop: the plan’s line, said once, with Start again (V), and V listens again', async () => {
    const { mic, user } = openBar({ times: { ...TALK, quiet: 40 } })
    const found = await bar()
    await waitFor(() => {
      expect(found.querySelector('[data-slot=voice-problem]')).toHaveTextContent(
        'Stopped listening after 2 minutes of quiet.',
      )
    })
    expect(screen.getByRole('status')).toHaveTextContent(
      'Stopped listening after 2 minutes of quiet.',
    )
    expect(mic.live()).toBe(0)
    const again = within(found).getByRole('button', { name: /^Start again/ })
    expect(again).toHaveAttribute('aria-keyshortcuts', 'V')
    expect(buttons(found)).toEqual(['Close', 'Start again'])
    await user.keyboard('v')
    await listening()
    expect(mic.live()).toBe(1)
  })

  it('words over 2,000 characters wait in the text line with the plan’s line, and Send waits for them to be shortened', async () => {
    const { mic, commands, user } = openBar({ times: TALK })
    const found = await listening()
    const long = `Log a call with Jo Sample. ${'They want three floors. '.repeat(90)}`.trim()
    act(() => {
      mic.say(long)
    })
    expect(await within(found).findByRole('alert')).toHaveTextContent(
      "That's too long for one command. Your words are in the text line: shorten them, then press Enter.",
    )
    const line = within(found).getByRole('textbox', { name: 'Type what to do' })
    expect(line).toHaveValue(long)
    expect(line).toHaveAccessibleDescription(
      "That's too long for one command. Your words are in the text line: shorten them, then press Enter.",
    )
    expect(within(found).getByRole('button', { name: /^Send/ })).toBeDisabled()
    await user.clear(line)
    await user.type(line, 'Log a call with Jo Sample{Enter}')
    await waitFor(() => {
      expect(commands().map((call) => call.body)).toEqual([
        { text: 'Log a call with Jo Sample', source: 'typed' },
      ])
    })
    expect(mic.live()).toBe(0)
  })
})

describe('a phone that leaves the page (PLAN-V24 T2-5)', () => {
  beforeEach(() => {
    setKeepListening(true)
  })

  it('stops listening with the plan’s line, keeps the words, and Carry on puts them in the text line', async () => {
    asPhone()
    const { mic, user } = openBar({ times: { ...QUIET, pause: 600_000, quiet: 600_000 } })
    const found = await listening()
    act(() => {
      mic.say('Log a call with Jo Sample')
    })
    // The phone locks: the page is hidden.
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(await within(found).findByRole('alert')).toHaveTextContent(
      'The mic stopped when you left the page. What you said so far is kept.',
    )
    expect(mic.live()).toBe(0)
    await user.click(within(found).getByRole('button', { name: 'Carry on' }))
    expect(within(found).getByRole('textbox', { name: 'Type what to do' })).toHaveValue(
      'Log a call with Jo Sample',
    )
  })
})
