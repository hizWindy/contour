/**
 * Live voice and the cards (PLAN-V28 T3-1 and T3-2), with the voice bar, the real cards, a fake
 * talk, the fake mic, a fake clock and a fake server: a tool call opens the same card as the same
 * words typed; neither card opens a mic of its own; only the rep's own "send it" sends, once, and
 * "Sent." comes back only once the send worked, after the 5-second hold; a failed send and Undo
 * are said as they went; a "yes" only in Gemini's request starts no research; and a quick log
 * opens its card. Nothing reaches Google or HubSpot.
 *
 * Made-up names only: Sample Logistics, Northwind, Jo Sample.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/api/query'
import type { AssistantCommand, AssistantCommandIn, AssistantResearch } from '@/api/types'
import { CHROME_LAPTOP, FakeMic } from '@/apps/companies/call-notes/mic/fake-mic'
import { mockApi, type Answer, type Call } from '@/test/mock-api'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import {
  API,
  callCommand,
  CLOCK,
  command,
  note,
  notePath,
  notePreview,
  options,
  SAM,
  taskCommand,
  teamEmail,
  write,
} from '../card/fixtures'
import { clearResearches } from '../card/research-store'
import { closeCard } from '../card/store'
import VoiceBar from './bar'
import { setKeepListening } from './keep-listening'
import { FakeTalks, type FakeTalk } from './live/fake-talk'
import { NOT_SENT_LINE, READY, SAY_SEND_IT_FIRST, SENT_LINE } from './live/words'
import { closeVoiceBar, openVoiceBar } from './store'

const BAR = 'Speak to the Assistant'
const HOLD = 5000
const TASK_WORDS = 'Add a task to send Sample Logistics the quote on Friday'
const TASK_CARD = 'Add a task for you: send Sample Logistics the quote, due Fri 27 Nov.'
const CALL_WORDS = 'Log a call with Jo Sample at Sample Logistics, no answer'
const CALL_CARD = 'Log a call with Jo Sample at Sample Logistics. Follow-up task on Fri 27 Nov.'
const RESEARCH = '/api/v1/companies/assistant/research'
const QUESTION = 'Research Northwind? About US$0.38.'

function research(): AssistantResearch {
  return {
    company: 'Northwind',
    company_key: null,
    city: 'Perth',
    hubspot: 'new',
    last_activity: null,
    lead: null,
    lease_end: null,
    area_m2: null,
    known: [],
    next: 'ask',
    question: QUESTION,
    cost_usd: '0.38',
    can_start: true,
    blocked: null,
  }
}

const RESEARCH_COMMAND = command({
  action: 'research',
  read_back: QUESTION,
  company: { found: null, choices: [], from_page: false, heard: 'Northwind' },
  research: research(),
})

/** The command step answers by the words it reads: Gemini's request, or the typed line. */
function byWords(answers: Record<string, AssistantCommand>): Answer {
  return (call) => {
    const said = (call.body as AssistantCommandIn).text
    return Response.json(answers[said] ?? command({ action: 'unknown', read_back: 'No.' }))
  }
}

interface Page {
  /** The task's send. Default: it goes. */
  tasks?: unknown
}

/** A page with the voice bar on it, for a person with live voice, and a fake server. */
function page(answers: Record<string, AssistantCommand>, { tasks }: Page = {}) {
  setKeepListening(false)
  const mic = new FakeMic({ browser: { ...CHROME_LAPTOP, live: true } })
  const talks = new FakeTalks()
  const calls = mockApi({
    [API.options]: options({ voice_tool: 'browser_service' }),
    [API.summary]: { to_confirm: 0, needs_look: 0, logged_today: 0, needs_company: 0 },
    [API.command]: byWords(answers),
    [API.taskPreview]: write(),
    [API.tasks]: tasks ?? write({ status: 'done' }),
    [API.emailPreview]: teamEmail(),
    [API.team]: [SAM],
    [API.notes]: note({
      status: 'sorting',
      call: { in_hubspot: false, outcome: null, summary: '' },
    }),
    [notePath()]: note(),
    [API.notePreview]: notePreview(),
    [RESEARCH]: (call: Call) =>
      call.method === 'POST'
        ? Response.json(
            { run_id: 'run-1', company: 'Northwind', status: 'queued' },
            { status: 201 },
          )
        : Response.json(research()),
  })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), { state: 'off', liveVoice: true })
  const view = renderWithProviders(
    <VoiceBar env={mic.env()} makeTool={mic.tool} talk={talks.make} tone={() => undefined} />,
    { queryClient, route: '/assistant' },
  )
  const of = (path: string) => calls.filter((call) => call.path === path && call.method === 'POST')
  return { mic, talks, of, ...view }
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** Opens the bar, and Google is ready. */
async function talking(talks: FakeTalks): Promise<FakeTalk> {
  act(() => {
    openVoiceBar()
  })
  await screen.findByRole('dialog', { name: BAR })
  await waitFor(() => {
    expect(talks.made.length).toBeGreaterThan(0)
  })
  const talk = talks.last()
  await act(async () => {
    talk.ready()
    await Promise.resolve()
  })
  return talk
}

/** Gemini asks Contour, with the rep's own words since the last call. */
async function call(talk: FakeTalk, id: string, request: string, heard = request) {
  await act(async () => {
    talk.call(id, request, heard)
    await Promise.resolve()
  })
}

afterEach(() => {
  act(() => {
    closeVoiceBar()
    closeCard()
    clearResearches()
    toast.dismiss()
  })
  window.localStorage.clear()
  setKeepListening(true)
})

describe('a tool call opens the card the words typed open (T3-1)', () => {
  it('spoken: the card, "Ready. Say send it.", and no mic of its own', async () => {
    vi.useFakeTimers(CLOCK)
    const { talks, mic, of } = page({ [TASK_WORDS]: taskCommand() })
    const talk = await talking(talks)
    await call(talk, 'call-1', TASK_WORDS)
    const card = await screen.findByRole('dialog', { name: TASK_CARD })

    expect(within(card).getByRole('textbox', { name: 'What to do' })).toHaveValue(
      'Send Sample Logistics the quote',
    )
    expect(of(API.command).map((one) => one.body)).toEqual([{ text: TASK_WORDS, source: 'mic' }])
    await waitFor(() => {
      expect(talk.answerTo('call-1')).toEqual({
        id: 'call-1',
        status: 'ok',
        retryable: false,
        message: READY,
      })
    })
    // One mic, the talk's: the card listens for nothing itself.
    await wait(6000)
    expect(mic.asked).toEqual([])
    expect(mic.tools).toEqual([])
    expect(talk.answers).toHaveLength(1)
  })

  it('typed: the same card', async () => {
    vi.useFakeTimers(CLOCK)
    const { talks, of, user } = page({ [TASK_WORDS]: taskCommand() })
    await talking(talks)
    const bar = screen.getByRole('dialog', { name: BAR })
    await user.click(within(bar).getByRole('button', { name: 'Type instead' }))
    await user.type(within(bar).getByRole('textbox', { name: 'Type what to do' }), TASK_WORDS)
    await user.keyboard('{Enter}')
    const card = await screen.findByRole('dialog', { name: TASK_CARD })

    expect(within(card).getByRole('textbox', { name: 'What to do' })).toHaveValue(
      'Send Sample Logistics the quote',
    )
    expect(of(API.command).map((one) => one.body)).toEqual([{ text: TASK_WORDS, source: 'typed' }])
  })

  it('the research card: its question with the cost, and no mic of its own', async () => {
    vi.useFakeTimers(CLOCK)
    const { talks, mic, of } = page({ 'Research Northwind': RESEARCH_COMMAND })
    const talk = await talking(talks)
    await call(talk, 'call-1', 'Research Northwind')
    await screen.findByRole('dialog', { name: QUESTION })

    await waitFor(() => {
      expect(talk.answerTo('call-1')).toEqual({
        id: 'call-1',
        status: 'unsure',
        retryable: false,
        message: QUESTION,
      })
    })
    await wait(6000)
    expect(mic.asked).toEqual([])
    expect(mic.tools).toEqual([])
    expect(of(RESEARCH)).toEqual([])
  })
})

describe('"send it" (T3-2, choice 7)', () => {
  it('sends once, on the rep\'s own words, and says "Sent." only after the hold', async () => {
    vi.useFakeTimers(CLOCK)
    const { talks, of } = page({ [TASK_WORDS]: taskCommand() })
    const talk = await talking(talks)
    await call(talk, 'call-1', TASK_WORDS)
    await screen.findByRole('dialog', { name: TASK_CARD })
    await waitFor(() => {
      expect(talk.answerTo('call-1')?.message).toBe(READY)
    })
    await wait(600)
    await call(talk, 'call-2', 'Send the task now', 'Send it.')

    expect(await screen.findByText('Adding the task in HubSpot')).toBeInTheDocument()
    await wait(HOLD - 100)
    expect(talk.answerTo('call-2')).toBeUndefined()
    expect(of(API.tasks)).toEqual([])
    await wait(200)
    await waitFor(() => {
      expect(talk.answerTo('call-2')).toEqual({
        id: 'call-2',
        status: 'ok',
        retryable: false,
        message: SENT_LINE,
      })
    })
    expect(of(API.tasks)).toHaveLength(1)
    // "Send it" never asked the AI.
    expect(of(API.command)).toHaveLength(1)

    // "Send it" again: the card has gone, and nothing more is sent.
    await call(talk, 'call-3', 'Send it', 'Send it.')
    await wait(HOLD + 100)
    expect(of(API.tasks)).toHaveLength(1)
    expect(talk.answerTo('call-3')?.message).not.toBe(SENT_LINE)
  })

  it("a failed send is said as failed, with the card's own line", async () => {
    vi.useFakeTimers(CLOCK)
    const { talks, of } = page(
      { [TASK_WORDS]: taskCommand() },
      { tasks: write({ status: 'failed', error: 'HubSpot said no.' }) },
    )
    const talk = await talking(talks)
    await call(talk, 'call-1', TASK_WORDS)
    await screen.findByRole('dialog', { name: TASK_CARD })
    await wait(600)
    await call(talk, 'call-2', 'Send it', 'Send it.')
    await wait(HOLD + 100)

    await waitFor(() => {
      expect(talk.answerTo('call-2')).toEqual({
        id: 'call-2',
        status: 'error',
        retryable: true,
        message: 'Not sent. HubSpot said no.',
      })
    })
    expect(of(API.tasks)).toHaveLength(1)
  })

  it('Undo in the hold: "Not sent.", and the card comes back', async () => {
    vi.useFakeTimers(CLOCK)
    const { talks, of, user } = page({ [TASK_WORDS]: taskCommand() })
    const talk = await talking(talks)
    await call(talk, 'call-1', TASK_WORDS)
    await screen.findByRole('dialog', { name: TASK_CARD })
    await wait(600)
    await call(talk, 'call-2', 'Send it', 'Send it.')
    await screen.findByText('Adding the task in HubSpot')
    await user.click(screen.getByRole('button', { name: 'Undo' }))

    await waitFor(() => {
      expect(talk.answerTo('call-2')).toEqual({
        id: 'call-2',
        status: 'ok',
        retryable: false,
        message: NOT_SENT_LINE,
      })
    })
    expect(await screen.findByRole('dialog', { name: TASK_CARD })).toBeInTheDocument()
    await wait(HOLD + 100)
    expect(of(API.tasks)).toEqual([])
  })

  it('"send" only in Gemini\'s words sends nothing, and asks the rep to say it', async () => {
    vi.useFakeTimers(CLOCK)
    const { talks, of } = page({
      [TASK_WORDS]: taskCommand(),
      'Send it': command({ action: 'send', read_back: 'Sending it.' }),
    })
    const talk = await talking(talks)
    await call(talk, 'call-1', TASK_WORDS)
    await screen.findByRole('dialog', { name: TASK_CARD })
    await wait(600)
    // Google heard none of the rep's words this time: only Gemini's request says "send".
    await call(talk, 'call-2', 'Send it', '')

    await waitFor(() => {
      expect(talk.answerTo('call-2')).toEqual({
        id: 'call-2',
        status: 'unsure',
        retryable: false,
        message: SAY_SEND_IT_FIRST,
      })
    })
    await wait(HOLD + 100)
    expect(of(API.tasks)).toEqual([])
    expect(screen.getByRole('dialog', { name: TASK_CARD })).toBeInTheDocument()
  })

  it('a quick log opens its card in live voice, and nothing goes until "send it"', async () => {
    vi.useFakeTimers(CLOCK)
    const { talks, of } = page({ [CALL_WORDS]: callCommand({ quick: true }) })
    const talk = await talking(talks)
    await call(talk, 'call-1', CALL_WORDS)

    expect(await screen.findByRole('dialog', { name: CALL_CARD })).toBeInTheDocument()
    expect(screen.queryByText('Logging the call')).toBeNull()
    await wait(HOLD + 100)
    expect(of(API.confirm)).toEqual([])
  })

  it('a "yes" only in Gemini\'s request starts no research; the rep\'s own "yes" does', async () => {
    vi.useFakeTimers(CLOCK)
    const { talks, of } = page({ 'Research Northwind': RESEARCH_COMMAND })
    const talk = await talking(talks)
    await call(talk, 'call-1', 'Research Northwind')
    await screen.findByRole('dialog', { name: QUESTION })
    await call(talk, 'call-2', 'Yes, start the research', 'Hmm, let me think.')
    await wait(1000)

    expect(of(RESEARCH)).toEqual([])
    expect(talk.answerTo('call-2')?.status).toBe('unsure')

    await call(talk, 'call-3', 'Yes, start the research', 'Yes.')
    await waitFor(() => {
      expect(talk.answerTo('call-3')?.status).toBe('ok')
    })
    expect(of(RESEARCH)).toHaveLength(1)
  })
})
