/**
 * The review card in a long conversation (PLAN-V24 T2-3, choice 13): the card hears the
 * conversation's turns for as long as it is open, through the conversation's one mic. "Send it"
 * sends, even 30 seconds on; "later" keeps a call in Call logs; a spoken change still works; a new
 * command waits for the card; and after a send the next turn is a new command. Outside a
 * conversation the card's own 5 second listen works as before. T2-4: the card's question is
 * answered by voice, with no AI. A fake mic, a fake clock and a fake server; nothing real is sent.
 * Made-up names only: Sample Logistics Pty Ltd, Sample Freight Pty Ltd, Jo Sample, James Sample.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { useLocation } from 'react-router'
import { queryKeys } from '@/api/query'
import type { AssistantCommand, AssistantCommandIn } from '@/api/types'
import { FakeMic } from '@/apps/companies/call-notes/mic/fake-mic'
import { mockApi, type Answer } from '@/test/mock-api'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import VoiceBar from '../voice/bar'
import type { Times } from '../voice/bar-session'
import { setKeepListening } from '../voice/keep-listening'
import { closeVoiceBar, openVoiceBar } from '../voice/store'
import {
  API,
  callCommand,
  CLOCK,
  command,
  JAMES,
  JAMES_TOO,
  note,
  notePath,
  notePreview,
  options,
  OTHER_SAMPLE,
  SAM,
  SAMPLE,
  taskCommand,
  teamEmail,
  write,
} from './fixtures'
import { closeCard } from './store'

const BAR = 'Speak to the Assistant'
const HOLD = 5000
/** A short pause ends a turn; nothing else ends the conversation by itself here. */
const TALK: Partial<Times> = { pause: 50, quiet: 600_000, turn: 600_000 }

const TASK_WORDS = 'Add a task to send Sample Logistics the quote on Friday'
const CALL_WORDS = 'Log a call with Jo from Sample Logistics, the lease ends June 2027'
const TASK_CARD = 'Add a task for you: send Sample Logistics the quote, due Fri 27 Nov.'
const CALL_CARD = 'Log a call with Jo Sample at Sample Logistics. Follow-up task on Fri 27 Nov.'

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

/** The command step answers by the words said: each test names its own. */
function byWords(answers: Record<string, AssistantCommand>): Answer {
  return (call) => {
    const said = (call.body as AssistantCommandIn).text
    return Response.json(answers[said] ?? command({ action: 'unknown', read_back: 'No.' }))
  }
}

/** A page with the voice bar on it, "Keep listening" as given, and a fake server. */
function page(answers: Record<string, AssistantCommand>, { keep = true } = {}) {
  setKeepListening(keep)
  const mic = new FakeMic()
  const calls = mockApi({
    [API.options]: options(),
    [API.summary]: { to_confirm: 0, needs_look: 0, logged_today: 0 },
    [API.command]: byWords(answers),
    [API.taskPreview]: write(),
    [API.tasks]: write({ status: 'done' }),
    [API.emailPreview]: teamEmail(),
    [API.team]: [SAM],
    [API.notes]: note({
      status: 'sorting',
      call: { in_hubspot: false, outcome: null, summary: '' },
    }),
    [notePath()]: note(),
    [API.notePreview]: notePreview(),
  })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), { state: 'off' })
  const view = renderWithProviders(
    <>
      <VoiceBar env={mic.env()} makeTool={mic.tool} times={TALK} />
      <Where />
    </>,
    { queryClient, route: '/assistant' },
  )
  const of = (path: string) => calls.filter((call) => call.path === path && call.method === 'POST')
  return { mic, of, ...view }
}

/** What the task command leaves for the next turn (PLAN-V25 T5-1). */
const LAST_TASK = {
  action: 'task',
  company_key: '201',
  company_heard: 'Sample Logistics',
  person_id: null,
  person_heard: '',
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** Opens the bar and waits until it listens. */
async function listening() {
  act(() => {
    openVoiceBar()
  })
  const bar = await screen.findByRole('dialog', { name: BAR })
  await waitFor(() => {
    expect(bar.querySelector('[data-slot=voice-title]')).toHaveTextContent('Listening')
  })
  return bar
}

/** The rep says a turn: the pause after it ends it. */
async function say(mic: FakeMic, words: string) {
  act(() => {
    mic.say(words)
  })
  await wait(TALK.pause ?? 0)
}

/**
 * The voice bar's pill beside the card (PLAN-V24 T5-1): the mic is on. It is in the card's dialog
 * layer, so the dialog holds it, but not in the card's own box.
 */
function strip(card: HTMLElement): HTMLElement | null {
  return card.querySelector<HTMLElement>('[data-slot=listening-pill]')
}

afterEach(() => {
  act(() => {
    closeVoiceBar()
    closeCard()
    toast.dismiss()
  })
  window.localStorage.clear()
  setKeepListening(true)
})

describe('the card in a conversation (T2-3)', () => {
  it('hears the conversation through its one mic: "send it" 30 seconds after it opened sends it', async () => {
    vi.useFakeTimers(CLOCK)
    const { mic, of } = page({ [TASK_WORDS]: taskCommand() })
    await listening()
    await say(mic, TASK_WORDS)
    const card = await screen.findByRole('dialog', { name: TASK_CARD })
    // The mic is on, and the card says so; it opens no mic of its own.
    await waitFor(() => {
      expect(strip(card)).toHaveTextContent('Listening')
    })
    expect(within(card).getByText("Say 'send it' or press Enter")).toBeInTheDocument()
    expect(card.querySelector('[data-slot=card-listen]')).toBeNull()
    // While the card is open, the bar gives way to it.
    expect(screen.queryByRole('dialog', { name: BAR })).toBeNull()
    await wait(30_000)
    await say(mic, 'Send it.')
    expect(await screen.findByText('Adding the task in HubSpot')).toBeInTheDocument()
    await wait(HOLD)
    await waitFor(() => {
      expect(of(API.tasks)).toHaveLength(1)
    })
    // "Send it" never asked the AI, and one mic heard it all.
    expect(of(API.command)).toHaveLength(1)
    expect(mic.tools).toHaveLength(1)
    expect(mic.asked).toHaveLength(1)
  })

  it('after a send the bar comes back, says "Sent.", and the next turn is a new command', async () => {
    vi.useFakeTimers(CLOCK)
    const { mic, of } = page({
      [TASK_WORDS]: taskCommand(),
      'Open call logs': command({
        action: 'open',
        read_back: 'Open Call logs.',
        open: { page: 'call_logs', company_key: null },
      }),
    })
    await listening()
    await say(mic, TASK_WORDS)
    await screen.findByRole('dialog', { name: TASK_CARD })
    await say(mic, 'send it')
    const bar = await screen.findByRole('dialog', { name: BAR })
    await waitFor(() => {
      expect(bar.querySelector('[data-slot=voice-line]')).toHaveTextContent('Sent.')
    })
    await say(mic, 'Open call logs')
    await waitFor(() => {
      expect(screen.getByTestId('where')).toHaveTextContent('/assistant/call-logs')
    })
    // A new command: the card's action and boxes don't go with it; the last turn does (PLAN-V25 T5-1).
    expect(of(API.command).map((call) => call.body)).toEqual([
      { text: TASK_WORDS, source: 'mic' },
      { text: 'Open call logs', source: 'mic', last_turn: LAST_TASK },
    ])
    expect(mic.live()).toBe(1)
  })

  it('"later" keeps a call in Call logs, and nothing goes to HubSpot', async () => {
    vi.useFakeTimers(CLOCK)
    const { mic, of } = page({ [CALL_WORDS]: callCommand() })
    await listening()
    await say(mic, CALL_WORDS)
    await screen.findByRole('dialog', { name: CALL_CARD })
    // The call is saved as the card opens, as now.
    await waitFor(() => {
      expect(of(API.notes)).toHaveLength(1)
    })
    await say(mic, 'later')
    expect(
      await screen.findByText('Kept in Call logs, to send with the others.'),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: CALL_CARD })).toBeNull()
    })
    expect(of(API.confirm)).toHaveLength(0)
    expect(of(API.command)).toHaveLength(1)
  })

  it('a spoken change still works: the words go with the card’s boxes, and the box changes', async () => {
    vi.useFakeTimers(CLOCK)
    const change = 'make it send them the floor plan'
    const { mic, of } = page({
      [TASK_WORDS]: taskCommand(),
      [change]: command({
        action: 'change',
        read_back: 'Change what to do.',
        change: { box: 'subject', value: 'Send Sample Logistics the floor plan', day: null },
      }),
    })
    await listening()
    await say(mic, TASK_WORDS)
    const card = await screen.findByRole('dialog', { name: TASK_CARD })
    await say(mic, change)
    await waitFor(() => {
      expect(within(card).getByRole('textbox', { name: 'What to do' })).toHaveValue(
        'Send Sample Logistics the floor plan',
      )
    })
    expect(of(API.command)[1]?.body).toEqual({
      text: change,
      source: 'mic',
      card: { action: 'task', boxes: ['subject', 'due', 'kind', 'body'] },
      last_turn: LAST_TASK,
    })
    // The card is still open, and still hears.
    expect(strip(card)).toHaveTextContent('Listening')
  })

  it('a new command while a card is open says "Send or keep this one first."', async () => {
    vi.useFakeTimers(CLOCK)
    const { mic } = page({ [TASK_WORDS]: taskCommand(), [CALL_WORDS]: callCommand() })
    await listening()
    await say(mic, TASK_WORDS)
    const card = await screen.findByRole('dialog', { name: TASK_CARD })
    await say(mic, CALL_WORDS)
    await waitFor(() => {
      expect(strip(card)).toHaveTextContent('Send or keep this one first.')
    })
    expect(screen.getByRole('dialog', { name: TASK_CARD })).toBe(card)
  })

  it('the new command’s words are kept: once the card is sent, Type instead puts them in the text line (the PLAN-V24 browser check)', async () => {
    vi.useFakeTimers(CLOCK)
    const { mic, user } = page({ [TASK_WORDS]: taskCommand(), [CALL_WORDS]: callCommand() })
    await listening()
    await say(mic, TASK_WORDS)
    const card = await screen.findByRole('dialog', { name: TASK_CARD })
    await say(mic, CALL_WORDS)
    await waitFor(() => {
      expect(strip(card)).toHaveTextContent('Send or keep this one first.')
    })
    await say(mic, 'send it')
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: TASK_CARD })).toBeNull()
    })
    const bar = await screen.findByRole('dialog', { name: BAR })
    await user.click(within(bar).getByRole('button', { name: 'Type instead' }))
    expect(within(bar).getByRole('textbox', { name: 'Type what to do' })).toHaveValue(CALL_WORDS)
  })

  it('Stop (V) on the card stops listening; the card stays, and works by hand', async () => {
    vi.useFakeTimers(CLOCK)
    const { mic, user } = page({ [TASK_WORDS]: taskCommand() })
    await listening()
    await say(mic, TASK_WORDS)
    const card = await screen.findByRole('dialog', { name: TASK_CARD })
    await waitFor(() => {
      expect(strip(card)).toHaveTextContent('Listening')
    })
    await user.click(within(card).getByRole('button', { name: /^Stop/ }))
    await waitFor(() => {
      expect(mic.live()).toBe(0)
    })
    // The pill goes with the conversation (T5-1), and the focus stays on the card.
    await waitFor(() => {
      expect(strip(card)).toBeNull()
    })
    expect(within(card).getByRole('button', { name: 'Send' })).toHaveFocus()
    expect(screen.getByRole('dialog', { name: TASK_CARD })).toBe(card)
  })

  it('Esc on the card does what it did: the draft is kept, and the bar listens on', async () => {
    vi.useFakeTimers(CLOCK)
    const { mic, user } = page({ [TASK_WORDS]: taskCommand() })
    await listening()
    await say(mic, TASK_WORDS)
    const card = await screen.findByRole('dialog', { name: TASK_CARD })
    await waitFor(() => {
      expect(within(card).getByRole('button', { name: 'Send' })).toHaveFocus()
    })
    await user.keyboard('{Escape}')
    expect(
      await screen.findByText('Not sent. Your draft is kept in this browser.'),
    ).toBeInTheDocument()
    const bar = await screen.findByRole('dialog', { name: BAR })
    expect(bar.querySelector('[data-slot=voice-title]')).toHaveTextContent('Listening')
    expect(mic.live()).toBe(1)
    // The bar takes the focus back, for its keys and the Tab key (T2-6).
    await waitFor(() => {
      expect(bar).toHaveFocus()
    })
  })
})

describe('outside a conversation ("Keep listening" off)', () => {
  it('the card listens 5 seconds for "send it" with its own mic, as before', async () => {
    vi.useFakeTimers(CLOCK)
    const { mic, of, user } = page({ [TASK_WORDS]: taskCommand() }, { keep: false })
    await listening()
    act(() => {
      mic.say(TASK_WORDS)
    })
    await user.keyboard('v')
    const card = await screen.findByRole('dialog', { name: TASK_CARD })
    expect(within(card).getByText("Say 'send it' or press Enter")).toBeInTheDocument()
    expect(card.querySelector('[data-slot=card-listen]')).not.toBeNull()
    expect(strip(card)).toBeNull()
    // The bar's mic was let go; the card opened its own.
    await waitFor(() => {
      expect(mic.tools).toHaveLength(2)
    })
    act(() => {
      mic.say('send it')
    })
    expect(await screen.findByText('Adding the task in HubSpot')).toBeInTheDocument()
    await wait(HOLD)
    await waitFor(() => {
      expect(of(API.tasks)).toHaveLength(1)
    })
  })
})

describe('a choice by voice in a conversation (T2-4)', () => {
  it('"the second one" picks the second company, and nothing asks the AI', async () => {
    vi.useFakeTimers(CLOCK)
    const which = taskCommand({
      company: {
        found: null,
        choices: [SAMPLE, OTHER_SAMPLE],
        from_page: false,
        heard: 'Sample',
      },
    })
    const { mic, of } = page({ [TASK_WORDS]: which })
    await listening()
    await say(mic, TASK_WORDS)
    const card = await screen.findByRole('dialog', { name: TASK_CARD })
    expect(within(card).getByRole('group', { name: 'Which Sample?' })).toBeInTheDocument()
    await say(mic, 'the second one')
    await waitFor(() => {
      expect(within(card).queryByRole('group', { name: 'Which Sample?' })).toBeNull()
    })
    expect(within(card).getByText(OTHER_SAMPLE.name)).toBeInTheDocument()
    expect(of(API.command)).toHaveLength(1)
  })

  it('a person’s name that isn’t there changes nothing and says so; a name that is picks', async () => {
    vi.useFakeTimers(CLOCK)
    const which = callCommand({
      person: { found: null, choices: [JAMES, JAMES_TOO], heard: 'James' },
    })
    const { mic, of } = page({ [CALL_WORDS]: which })
    await listening()
    await say(mic, CALL_WORDS)
    const card = await screen.findByRole('dialog', { name: CALL_CARD })
    const group = within(card).getByRole('group', { name: 'Which James?' })
    await say(mic, 'James Smith')
    await waitFor(() => {
      expect(strip(card)).toHaveTextContent(
        "There's no 'James Smith' here. Pick one, or say its number.",
      )
    })
    expect(group).toBeInTheDocument()
    // Nothing is saved until the person is picked, and the AI wasn't asked.
    expect(of(API.notes)).toHaveLength(0)
    expect(of(API.command)).toHaveLength(1)
    await say(mic, 'James Example')
    await waitFor(() => {
      expect(of(API.notes)).toHaveLength(1)
    })
    expect(of(API.notes)[0]?.body).toMatchObject({ contact_id: JAMES_TOO.id })
    expect(of(API.command)).toHaveLength(1)
  })
})
