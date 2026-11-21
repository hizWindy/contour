/**
 * No call lost (PLAN-V24 T3-2, choices 17 to 19): a call whose company isn't found is saved at once
 * as "Needs a company", with the name as heard; Later keeps it in Call logs, never only in this
 * browser; the words said next fill the card's company search, its matches show as choices, and
 * "the first one" picks, so the call is sorted; a name found nowhere says so and keeps the call;
 * Send says why it waits and never sends it; and tasks and emails are still kept in this browser.
 * Typing and buttons do everything voice does (decided in chat, 5).
 *
 * Against a fake server that keeps the call between requests, as T3-1's contract has it, with a
 * fake mic and a fake clock: nothing real is sent. Made-up names only: Sample Logistics Pty Ltd,
 * Sample Freight Pty Ltd, Northwind Pty Ltd, North Wind and Southwind as heard, Jo Sample.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/api/query'
import type {
  AssistantCommand,
  AssistantCommandIn,
  CallNoteIn,
  CallNoteOut,
  CallNotePatch,
  CompanyHit,
} from '@/api/types'
import { FakeMic } from '@/apps/companies/call-notes/mic/fake-mic'
import { mockApi, type Answer, type Call } from '@/test/mock-api'
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
  companyPreview,
  emailCommand,
  FOLLOW_UP,
  LEASE,
  note,
  notePath,
  notePreview,
  NORTHWIND,
  options,
  OTHER_SAMPLE,
  SAM,
  SAMPLE,
  taskCommand,
  teamEmail,
  write,
} from './fixtures'
import { CardHost } from './host'
import { closeCard, openCard } from './store'

const CARD = 'Log a call with North Wind.'
const SAVED = "We couldn't find 'North Wind'. The call is saved. Say the company again, or pick it."
const NOT_THERE = "North Wind isn't in HubSpot. Add it, or pick another company."
const KEPT = 'Kept in Call logs, under Needs a company.'
const WAITS = '1 call needs a company first. It stays in Call logs.'
const STILL_NO = "Still no 'Southwind'. Say it again, or pick it later in Call logs."
const CHANGE_WAITS = 'That change will be made once the call is sorted.'
const DRAFTS = 'assistant.card-drafts'
const NOTE_TEXT = 'Spoke to Jo, the lease ends June 2027. Follow up Friday.'
const HOLD = 5000
/**
 * The card from the voice bar reads a sorting call again every 2 seconds, on a real interval (the
 * fake clock leaves intervals alone, see `CLOCK`): long enough to wait for it, and the test's own.
 */
const SORTED = { timeout: 5000 }
const LONG_TEST = 15_000
/** A short pause ends a turn; nothing else ends the conversation by itself here. */
const TALK: Partial<Times> = { pause: 50, quiet: 600_000, turn: 600_000 }

/** "Log a call with North Wind": the command found the company nowhere, and heard Jo. */
function northWind(change: Partial<AssistantCommand> = {}): AssistantCommand {
  return callCommand({
    read_back: CARD,
    company: { found: null, choices: [], from_page: false, heard: 'North Wind', can_add: true },
    person: { found: null, choices: [], heard: 'Jo' },
    unsure: NOT_THERE,
    ...change,
  })
}

// --- A fake server --------------------------------------------------------------------------------

const COMPANIES: readonly CompanyHit[] = [SAMPLE, OTHER_SAMPLE, NORTHWIND]

/** Our copy's search, as the server's: each company whose name holds the words typed or said. */
const search: Answer = (call) => {
  const q = (new URLSearchParams(call.search).get('q') ?? '').trim().toLowerCase()
  return Response.json({
    people: [],
    companies: COMPANIES.filter((one) => one.name.toLowerCase().includes(q)),
  })
}

function problem(status: number, code: string, title: string, detail: string): Response {
  return Response.json({ title, status, detail, code }, { status })
}

/**
 * The call on a fake server, as T3-1's contract has it. Saved with only the name as heard it is
 * `needs_company`, unsorted, and takes only its outcome (409 `company_first`). Its company is
 * taken once (409 `company_set` after); then it sorts, and the next read finds it sorted, once
 * `sorts()` says the sorter is done.
 */
function callServer(
  refusePick: (companyKey: string) => Response | undefined = () => undefined,
  sorts: () => boolean = () => true,
): {
  answers: Record<string, unknown>
  saved: () => CallNoteOut | null
} {
  let saved: CallNoteOut | null = null
  const save: Answer = (call) => {
    if (call.method !== 'POST') return undefined
    const body = call.body as CallNoteIn
    const company = COMPANIES.find((one) => one.key === body.company_key) ?? null
    saved ??= note({
      status: company ? 'sorting' : 'needs_company',
      company_key: company?.key ?? null,
      company_name: company?.name ?? null,
      company_heard: body.company_heard ?? null,
      person: null,
      call: { in_hubspot: false, outcome: body.outcome ?? null, summary: '' },
      changes: [],
      tasks: [],
      text: body.text,
      source: body.source,
      sorted_by: 'person',
    })
    return Response.json(saved, { status: 201 })
  }
  const one: Answer = (call) => {
    if (saved === null) return undefined
    if (call.method === 'PATCH') {
      const patch = call.body as CallNotePatch
      if (patch.company_key) {
        const refused = refusePick(patch.company_key)
        if (refused) return refused
        if (saved.status !== 'needs_company') {
          return problem(
            409,
            'company_set',
            'The company is set already',
            "This call has its company already, so it can't be picked again.",
          )
        }
        const company = COMPANIES.find((hit) => hit.key === patch.company_key)
        saved = {
          ...saved,
          status: 'sorting',
          company_key: patch.company_key,
          company_name: company?.name ?? null,
        }
        return Response.json(saved)
      }
      if (
        saved.status === 'needs_company' &&
        Object.keys(patch).some((part) => part !== 'outcome')
      ) {
        return problem(409, 'company_first', 'Pick the company first', 'Pick the company first.')
      }
      if (saved.status === 'sorting') {
        return problem(409, 'note_sorting', 'Still sorting', 'Try again in a moment.')
      }
      const now: CallNoteOut = saved
      saved = {
        ...now,
        call: {
          ...now.call,
          ...(patch.outcome !== undefined ? { outcome: patch.outcome } : {}),
          ...(typeof patch.summary === 'string' ? { summary: patch.summary } : {}),
        },
        tasks: patch.tasks
          ? patch.tasks.map((task, index) => ({
              ...FOLLOW_UP,
              ...task,
              id: task.id ?? `t-new-${String(index)}`,
              due_words: task.due_words ?? '',
            }))
          : now.tasks,
      }
      return Response.json(saved)
    }
    // A read: a call that was sorting is sorted by now, as the sorter would leave it.
    if (saved.status === 'sorting' && sorts()) {
      saved = {
        ...saved,
        status: 'to_confirm',
        sorted_by: 'ai',
        call: {
          ...saved.call,
          outcome: saved.call.outcome ?? 'Connected',
          summary: 'Jo says the lease ends in June 2027.',
        },
        changes: [LEASE],
        tasks: [FOLLOW_UP],
      }
    }
    return Response.json(saved)
  }
  return {
    answers: {
      [API.notes]: save,
      [notePath()]: one,
      [API.notePreview]: () => (saved === null ? undefined : Response.json(notePreview(saved))),
    },
    saved: () => saved,
  }
}

/** Every company search the page asked for, by its words. */
function searches(calls: readonly Call[]): string[] {
  return calls
    .filter((call) => call.path === API.search)
    .map((call) => new URLSearchParams(call.search).get('q') ?? '')
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

/** What every page here answers, whatever the card. */
function base(): Record<string, unknown> {
  return {
    [API.options]: options(),
    [API.summary]: { to_confirm: 0, needs_look: 0, logged_today: 0, needs_company: 0 },
    [API.search]: search,
    [API.taskPreview]: write(),
    [API.emailPreview]: teamEmail(),
    [API.team]: [SAM],
    [API.companyPreview]: companyPreview(),
    [API.learned]: () => new Response(null, { status: 204 }),
    [API.confirm]: { already_sending: false, sending: 1, notes: [] },
  }
}

// --- A card opened by a typed command, or kept -----------------------------------------------------

/** Opens a card for a command on a page with a fake server. Enter works at once. */
function show(made: AssistantCommand, answers: Record<string, unknown> = {}) {
  const mic = new FakeMic()
  const calls = mockApi({ ...base(), ...answers })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), { state: 'off' })
  const view = renderWithProviders(
    <>
      <CardHost env={mic.env()} makeTool={mic.tool} times={{ guard: 0, preview: 0, sort: 20 }} />
      <Where />
    </>,
    { queryClient },
  )
  act(() => {
    openCard({ kind: 'command', command: made, words: 'the words', source: 'typed' })
  })
  const of = (path: string, method = 'POST') =>
    calls.filter((call) => call.path === path && call.method === method)
  return { mic, calls, of, ...view }
}

async function card() {
  return screen.findByRole('dialog')
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
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

describe('saved at once (choice 17)', () => {
  it('a call whose company isn’t found is saved at once as "Needs a company", with the name as heard', async () => {
    const server = callServer()
    const { of } = show(northWind(), server.answers)
    const found = await card()
    await waitFor(() => {
      expect(of(API.notes)).toHaveLength(1)
    })
    const [saved] = of(API.notes)
    expect(saved?.body).toEqual({
      company_heard: 'North Wind',
      text: NOTE_TEXT,
      source: 'typed',
      called_at: expect.any(String) as string,
    })
    expect(saved?.headers?.get('idempotency-key')).toBeTruthy()
    // The server has it: the card says so, over the search list, with Add to HubSpot and Later.
    expect(await within(found).findByText(SAVED)).toBeInTheDocument()
    expect(within(found).getByRole('button', { name: 'Add to HubSpot' })).toBeInTheDocument()
    expect(within(found).getByRole('textbox', { name: 'Find a company' })).toHaveValue('North Wind')
    expect(within(found).getByRole('button', { name: 'Later' })).toBeInTheDocument()
    // Said once: the server's line about North Wind isn't shown again above it.
    expect(within(found).queryByText(NOT_THERE)).toBeNull()
    // Not sorted, and nothing to sort or preview until its company is picked.
    expect(within(found).queryByText('Sorting the note.')).toBeNull()
    expect(within(found).queryByRole('textbox', { name: 'The note' })).toBeNull()
    expect(of(API.notePreview)).toHaveLength(0)
    expect(server.saved()?.status).toBe('needs_company')
  })

  it('Later keeps it in Call logs, not in this browser', async () => {
    const server = callServer()
    const { user, of } = show(northWind(), server.answers)
    const found = await card()
    await within(found).findByText(SAVED)
    await user.click(within(found).getByRole('button', { name: 'Later' }))
    expect(await screen.findByText(KEPT)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(window.localStorage.getItem(DRAFTS)).toBeNull()
    // Saved once, never sent, picked or taken away.
    expect(of(API.notes)).toHaveLength(1)
    expect(of(API.confirm)).toHaveLength(0)
    expect(of(notePath(), 'PATCH')).toHaveLength(0)
    expect(of(notePath(), 'DELETE')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Open Call logs' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/assistant/call-logs')
  })

  it('Later while the save is still on its way waits for it, and never keeps it here', async () => {
    const server = callServer()
    const save = server.answers[API.notes] as Answer
    let answer = (): void => undefined
    const answered = new Promise<void>((resolve) => {
      answer = resolve
    })
    const slow = ((call: Call) =>
      call.method === 'POST' ? answered.then(() => save(call)) : undefined) as unknown as Answer
    const { user, of } = show(northWind(), { ...server.answers, [API.notes]: slow })
    const found = await card()
    await waitFor(() => {
      expect(of(API.notes)).toHaveLength(1)
    })
    await user.click(within(found).getByRole('button', { name: 'Later' }))
    expect(screen.queryByText(KEPT)).toBeNull()
    act(() => {
      answer()
    })
    expect(await screen.findByText(KEPT)).toBeInTheDocument()
    expect(of(API.notes)).toHaveLength(1)
    expect(window.localStorage.getItem(DRAFTS)).toBeNull()
  })

  it('a call still asking "Which Sample?" stays in Call logs on Later, as "Needs a company"', async () => {
    const server = callServer()
    const { user, of } = show(
      callCommand({
        company: {
          found: null,
          choices: [SAMPLE, OTHER_SAMPLE],
          from_page: false,
          heard: 'Sample',
        },
        person: null,
      }),
      server.answers,
    )
    const found = await card()
    expect(within(found).getByRole('group', { name: 'Which Sample?' })).toBeInTheDocument()
    // Saved at once too (Al-khair, 21 Nov): its pick says not to teach (find-company.test.tsx).
    await waitFor(() => {
      expect(of(API.notes)).toHaveLength(1)
    })
    await user.click(within(found).getByRole('button', { name: 'Later' }))
    expect(await screen.findByText(KEPT)).toBeInTheDocument()
    expect(of(API.notes)).toHaveLength(1)
    expect(of(API.notes)[0]?.body).toMatchObject({ company_heard: 'Sample', text: NOTE_TEXT })
    expect(of(API.notes)[0]?.body).not.toHaveProperty('company_key')
    expect(window.localStorage.getItem(DRAFTS)).toBeNull()
  })

  it('a call the server couldn’t save is kept in this browser, so nothing said is lost', async () => {
    const { user } = show(northWind(), {
      [API.notes]: () =>
        problem(503, 'busy', 'Contour is busy', 'Nothing was saved. Try again in a minute.'),
    })
    const found = await card()
    expect(
      await within(found).findByText('Contour is busy. Nothing was saved. Try again in a minute.'),
    ).toBeInTheDocument()
    // The card says only what is true: the call isn't saved.
    expect(within(found).queryByText(SAVED)).toBeNull()
    await user.click(within(found).getByRole('button', { name: 'Later' }))
    expect(
      await screen.findByText('Not sent. Your draft is kept in this browser.'),
    ).toBeInTheDocument()
    expect(window.localStorage.getItem(DRAFTS)).toContain(NOTE_TEXT)
  })

  it('Later tries a save that failed once more, with the same key, and keeps it in Call logs', async () => {
    const server = callServer()
    const save = server.answers[API.notes] as Answer
    let tries = 0
    const { user, of } = show(northWind(), {
      ...server.answers,
      [API.notes]: (call: Call) => {
        if (call.method !== 'POST') return undefined
        tries += 1
        return tries === 1
          ? problem(503, 'busy', 'Contour is busy', 'Nothing was saved. Try again in a minute.')
          : save(call)
      },
    })
    const found = await card()
    await within(found).findByText('Contour is busy. Nothing was saved. Try again in a minute.')
    await user.click(within(found).getByRole('button', { name: 'Later' }))
    expect(await screen.findByText(KEPT)).toBeInTheDocument()
    const keys = of(API.notes).map((call) => call.headers?.get('idempotency-key'))
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
    expect(window.localStorage.getItem(DRAFTS)).toBeNull()
  })

  it('tasks and emails are still kept in this browser, as now', async () => {
    const task = show(taskCommand())
    await task.user.click(within(await card()).getByRole('button', { name: 'Cancel' }))
    expect(
      await screen.findByText('Not sent. Your draft is kept in this browser.'),
    ).toBeInTheDocument()
    expect(window.localStorage.getItem(DRAFTS)).toContain('Send Sample Logistics the quote')
    expect(task.of(API.notes)).toHaveLength(0)
    act(() => {
      closeCard()
      toast.dismiss()
    })
    task.unmount()

    const email = show(emailCommand())
    await email.user.click(within(await card()).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(window.localStorage.getItem(DRAFTS)).toContain('The Sample Logistics floor plan')
    })
    expect(window.localStorage.getItem(DRAFTS)).toContain('Send Sample Logistics the quote')
  })
})

describe('its Send (choice 18)', () => {
  it('says why it waits, in the plan’s words, and never sends it to HubSpot', async () => {
    vi.useFakeTimers(CLOCK)
    const server = callServer()
    const { user, of } = show(northWind(), server.answers)
    const found = await card()
    await within(found).findByText(SAVED)
    await user.click(within(found).getByRole('button', { name: 'Send' }))
    // Where a screen reader hears it, with the company search to pick from.
    expect(found.querySelector('[data-slot=needs-company]')).toHaveTextContent(WAITS)
    expect(found.querySelector('[data-slot=needs-company]')).toHaveAttribute('role', 'status')
    expect(within(found).getByRole('textbox', { name: 'Find a company' })).toHaveFocus()
    // Enter does the same.
    within(found).getByRole('button', { name: 'Send' }).focus()
    await user.keyboard('{Enter}')
    expect(within(found).getByRole('textbox', { name: 'Find a company' })).toHaveFocus()
    expect(within(found).getAllByText(WAITS)).toHaveLength(1)
    await wait(HOLD * 2)
    expect(screen.queryByText('Sending the call to HubSpot')).toBeNull()
    expect(of(API.confirm)).toHaveLength(0)
    // Open Call logs keeps it there, and goes.
    await user.click(within(found).getByRole('button', { name: 'Open Call logs' }))
    expect(await screen.findByText(KEPT)).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/assistant/call-logs')
    expect(of(API.confirm)).toHaveLength(0)
  })
})

describe('its company picked (choice 21)', () => {
  it('by typing and the keyboard alone: the pick goes to the server, the call is sorted, then sent', async () => {
    vi.useFakeTimers(CLOCK)
    const server = callServer()
    const { user, of, calls } = show(northWind(), server.answers)
    const found = await card()
    await within(found).findByText(SAVED)
    const box = within(found).getByRole('textbox', { name: 'Find a company' })
    await user.clear(box)
    await user.type(box, 'Northwind')
    await within(found).findByRole('group', { name: 'Which company?' })
    expect(searches(calls)).toContain('Northwind')
    await user.keyboard('{ArrowDown}')
    expect(within(found).getByRole('button', { name: /Northwind Pty Ltd/ })).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(of(notePath(), 'PATCH').map((call) => call.body)).toEqual([
        { company_key: NORTHWIND.key },
      ])
    })
    // Sorted as a new call is, then the boxes to check, and Send.
    expect(await within(found).findByRole('button', { name: 'Connected' })).toBeInTheDocument()
    expect(within(found).getByText(NORTHWIND.name)).toBeInTheDocument()
    const send = within(found).getByRole('button', { name: 'Send' })
    await waitFor(() => {
      expect(send).not.toHaveAttribute('aria-disabled')
    })
    send.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Sending the call to HubSpot')).toBeInTheDocument()
    await wait(HOLD)
    await waitFor(() => {
      expect(of(API.confirm)).toHaveLength(1)
    })
    // The server taught the mic as the company was picked: the card sends nothing more for it.
    await wait(100)
    expect(of(API.learned)).toHaveLength(0)
  })

  it('a pick the server refuses goes back, and the card says why', async () => {
    const refused = (): Response =>
      problem(
        422,
        'company_not_found',
        "We can't find that company",
        "It may have been removed, or it isn't open to your account. Pick another company, or search for it again.",
      )
    const server = callServer(refused)
    const { user } = show(northWind(), server.answers)
    const found = await card()
    await within(found).findByText(SAVED)
    const box = within(found).getByRole('textbox', { name: 'Find a company' })
    await user.clear(box)
    await user.type(box, 'Northwind')
    await user.click(await within(found).findByRole('button', { name: /Northwind Pty Ltd/ }))
    expect(
      await within(found).findByText(
        "We can't find that company. It may have been removed, or it isn't open to your account. Pick another company, or search for it again.",
      ),
    ).toBeInTheDocument()
    // The company is to pick again, from the search as it opened, and the call still waits.
    expect(within(found).getByText(SAVED)).toBeInTheDocument()
    expect(within(found).getByRole('textbox', { name: 'Find a company' })).toHaveValue('North Wind')
    expect(server.saved()?.status).toBe('needs_company')
  })

  it('a company the server has already (a retried pick) is read again, and shown', async () => {
    const server = callServer((key) =>
      key === SAMPLE.key
        ? problem(
            409,
            'company_set',
            'The company is set already',
            "This call has its company already, so it can't be picked again.",
          )
        : undefined,
    )
    const { user, of } = show(northWind(), server.answers)
    const found = await card()
    await within(found).findByText(SAVED)
    // Picked in Call logs meanwhile: the server has Northwind for it.
    const saved = server.saved()
    if (saved === null) throw new Error('The call was not saved')
    Object.assign(saved, {
      status: 'to_confirm',
      company_key: NORTHWIND.key,
      company_name: NORTHWIND.name,
    })
    const box = within(found).getByRole('textbox', { name: 'Find a company' })
    await user.clear(box)
    await user.type(box, 'Sample Logistics')
    await user.click(await within(found).findByRole('button', { name: /Sample Logistics/ }))
    await waitFor(() => {
      expect(within(found).getByText(NORTHWIND.name)).toBeInTheDocument()
    })
    expect(of(notePath(), 'GET').length).toBeGreaterThan(0)
    expect(within(found).queryByText(/Sample Logistics Pty Ltd/)).toBeNull()
  })
})

// --- In a conversation -------------------------------------------------------------------------------

/** The command step answers by the words said: each test names its own. */
function byWords(answers: Record<string, AssistantCommand>): Answer {
  return (call) => {
    const said = (call.body as AssistantCommandIn).text
    return Response.json(answers[said] ?? command({ action: 'unknown', read_back: 'No.' }))
  }
}

const CALL_WORDS = 'Log a call with North Wind, spoke to Jo about the lease'
const BAR = 'Speak to the Assistant'

/** A page with the voice bar on it, "Keep listening" on, and a fake server. */
function page(said: Record<string, AssistantCommand>, answers: Record<string, unknown>) {
  setKeepListening(true)
  const mic = new FakeMic()
  const calls = mockApi({ ...base(), [API.command]: byWords(said), ...answers })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), { state: 'off' })
  const view = renderWithProviders(
    <>
      <VoiceBar env={mic.env()} makeTool={mic.tool} times={TALK} />
      <Where />
    </>,
    { queryClient, route: '/assistant' },
  )
  const of = (path: string, method = 'POST') =>
    calls.filter((call) => call.path === path && call.method === method)
  return { mic, calls, of, ...view }
}

/** Opens the bar, waits until it listens, and says the call: its card opens. */
async function callCard(mic: FakeMic) {
  act(() => {
    openVoiceBar()
  })
  const bar = await screen.findByRole('dialog', { name: BAR })
  await waitFor(() => {
    expect(bar.querySelector('[data-slot=voice-title]')).toHaveTextContent('Listening')
  })
  await say(mic, CALL_WORDS)
  const found = await screen.findByRole('dialog', { name: CARD })
  expect(await within(found).findByText(SAVED)).toBeInTheDocument()
  return found
}

/** The rep says a turn: the pause after it ends it. */
async function say(mic: FakeMic, words: string) {
  act(() => {
    mic.say(words)
  })
  await wait(TALK.pause ?? 0)
}

/** The conversation's last line, in the voice bar's pill beside the card (PLAN-V24 T5-1). */
function line(found: HTMLElement): HTMLElement | null {
  return found.querySelector<HTMLElement>('[data-slot=pill-line]')
}

describe('the company said again (choice 19)', () => {
  it(
    'the next words fill the company search, its matches show as choices, and "the first one" picks: the call is sorted',
    async () => {
      vi.useFakeTimers(CLOCK)
      const server = callServer()
      const { mic, of, calls } = page({ [CALL_WORDS]: northWind() }, server.answers)
      const found = await callCard(mic)
      await say(mic, 'Northwind.')
      await wait(300)
      // The words fill the search box, and what it finds shows as choices.
      expect(within(found).getByRole('textbox', { name: 'Find a company' })).toHaveValue(
        'Northwind',
      )
      const choices = await within(found).findByRole('group', { name: 'Which company?' })
      expect(
        within(choices)
          .getAllByRole('button')
          .map((one) => one.textContent),
      ).toEqual(['Northwind Pty LtdFreight · Perth'])
      expect(searches(calls)).toContain('Northwind')
      await say(mic, 'the first one')
      await waitFor(() => {
        expect(of(notePath(), 'PATCH').map((call) => call.body)).toEqual([
          { company_key: NORTHWIND.key },
        ])
      })
      expect(within(found).getByText(NORTHWIND.name)).toBeInTheDocument()
      // Sorted, as a new call is, then waiting to be confirmed.
      expect(
        await within(found).findByRole('button', { name: 'Connected' }, SORTED),
      ).toBeInTheDocument()
      expect(server.saved()?.status).toBe('to_confirm')
      // Neither the name nor "the first one" asked the AI, and nothing went to HubSpot.
      expect(of(API.command)).toHaveLength(1)
      expect(of(API.confirm)).toHaveLength(0)
    },
    LONG_TEST,
  )

  it('a name found nowhere says so and keeps the call', async () => {
    vi.useFakeTimers(CLOCK)
    const server = callServer()
    const { mic, of } = page({ [CALL_WORDS]: northWind() }, server.answers)
    const found = await callCard(mic)
    await say(mic, 'Southwind')
    await wait(300)
    // The line says it once, where a screen reader hears it, in place of the first one.
    const said = await within(found).findByText(STILL_NO)
    expect(said.closest('[role=status]')).not.toBeNull()
    expect(within(found).queryByText(SAVED)).toBeNull()
    expect(within(found).queryByText('No company matches.')).toBeNull()
    expect(within(found).getByRole('textbox', { name: 'Find a company' })).toHaveValue('Southwind')
    // The call is kept, as it was: nothing picked, removed or sent, and no AI asked.
    expect(server.saved()?.status).toBe('needs_company')
    expect(of(notePath(), 'PATCH')).toHaveLength(0)
    expect(of(notePath(), 'DELETE')).toHaveLength(0)
    expect(of(API.command)).toHaveLength(1)
    // Said again, it searches again.
    await say(mic, 'Northwind')
    await wait(300)
    expect(await within(found).findByRole('button', { name: /Northwind Pty Ltd/ })).toBeVisible()
    expect(within(found).queryByText(STILL_NO)).toBeNull()
  })

  it('"send it" says why the call waits, and never sends it', async () => {
    vi.useFakeTimers(CLOCK)
    const server = callServer()
    const { mic, of } = page({ [CALL_WORDS]: northWind() }, server.answers)
    const found = await callCard(mic)
    await say(mic, 'send it')
    await waitFor(() => {
      expect(found.querySelector('[data-slot=needs-company]')).toHaveTextContent(WAITS)
    })
    await wait(HOLD * 2)
    expect(of(API.confirm)).toHaveLength(0)
    expect(screen.getByRole('dialog', { name: CARD })).toBe(found)
  })

  it('"later" keeps it in Call logs, not in this browser', async () => {
    vi.useFakeTimers(CLOCK)
    const server = callServer()
    const { mic, of } = page({ [CALL_WORDS]: northWind() }, server.answers)
    await callCard(mic)
    await say(mic, 'later')
    expect(await screen.findByText(KEPT)).toBeInTheDocument()
    expect(window.localStorage.getItem(DRAFTS)).toBeNull()
    expect(of(API.notes)).toHaveLength(1)
    expect(of(API.command)).toHaveLength(1)
  })

  it(
    'a change said before the call is sorted waits, and is made once it is; an outcome goes at once',
    async () => {
      vi.useFakeTimers(CLOCK)
      const server = callServer()
      const followUp = 'make the follow-up Monday'
      const outcome = 'it went to voicemail'
      const { mic, of } = page(
        {
          [CALL_WORDS]: northWind(),
          [followUp]: command({
            action: 'change',
            read_back: 'Make the follow-up Monday.',
            change: { box: 'follow-up', value: 'Monday', day: '2099-11-30' },
          }),
          [outcome]: command({
            action: 'change',
            read_back: 'Left voicemail.',
            change: { box: 'outcome', value: 'Left voicemail', day: null },
          }),
        },
        server.answers,
      )
      const found = await callCard(mic)
      const patches = () => of(notePath(), 'PATCH').map((call) => call.body)
      await say(mic, followUp)
      await waitFor(() => {
        expect(line(found)).toHaveTextContent(CHANGE_WAITS)
      })
      // Never sent before its company: the server would refuse it.
      expect(patches()).toEqual([])
      await say(mic, outcome)
      await waitFor(() => {
        expect(patches()).toEqual([{ outcome: 'Left voicemail' }])
      })
      await say(mic, 'Northwind')
      await wait(300)
      await within(found).findByRole('group', { name: 'Which company?' })
      await say(mic, 'the first one')
      // Sorted: the change kept goes now, on the follow-up the sort made.
      await waitFor(() => {
        expect(patches()).toEqual([
          { outcome: 'Left voicemail' },
          { company_key: NORTHWIND.key },
          {
            tasks: [
              {
                id: FOLLOW_UP.id,
                subject: FOLLOW_UP.subject,
                due: '2099-11-30',
                due_words: 'Monday',
                kind: 'call',
              },
            ],
          },
        ])
      }, SORTED)
      expect(server.saved()?.call.outcome).toBe('Left voicemail')
      await waitFor(() => {
        expect(found).toHaveAccessibleName(
          'Log a call with Northwind Pty Ltd. Follow-up task on Mon 30 Nov 2099.',
        )
      })
    },
    LONG_TEST,
  )

  it(
    'a change said while the call sorts is still made once it is sorted, after the next card took its card’s place (PLAN-V24 review)',
    async () => {
      vi.useFakeTimers(CLOCK)
      let sorted = false
      const server = callServer(undefined, () => sorted)
      const followUp = 'make the follow-up Monday'
      const nextCommand = 'Add a task to send Sample the quote'
      const { mic, of } = page(
        {
          [CALL_WORDS]: northWind(),
          [followUp]: command({
            action: 'change',
            read_back: 'Make the follow-up Monday.',
            change: { box: 'follow-up', value: 'Monday', day: '2099-11-30' },
          }),
          [nextCommand]: taskCommand(),
        },
        server.answers,
      )
      const found = await callCard(mic)
      const patches = () => of(notePath(), 'PATCH').map((call) => call.body)
      await say(mic, 'Northwind')
      await wait(300)
      await within(found).findByRole('group', { name: 'Which company?' })
      await say(mic, 'the first one')
      await waitFor(() => {
        expect(patches()).toEqual([{ company_key: NORTHWIND.key }])
      })
      // Said while the call sorts: kept, and said once, as it is kept.
      await say(mic, followUp)
      await waitFor(() => {
        expect(line(found)).toHaveTextContent(CHANGE_WAITS)
      })
      // Later, then the next command: its card takes the call card's place.
      await say(mic, 'later')
      expect(
        await screen.findByText('Kept in Call logs, to send with the others.'),
      ).toBeInTheDocument()
      await say(mic, nextCommand)
      expect(
        await screen.findByRole('dialog', {
          name: 'Add a task for you: send Sample Logistics the quote, due Fri 27 Nov.',
        }),
      ).toBeInTheDocument()
      expect(found).not.toBeInTheDocument()
      expect(patches()).toEqual([{ company_key: NORTHWIND.key }])
      // The sorter is done: the change kept goes now, on the follow-up the sort made, once.
      sorted = true
      await waitFor(() => {
        expect(patches()).toEqual([
          { company_key: NORTHWIND.key },
          {
            tasks: [
              {
                id: FOLLOW_UP.id,
                subject: FOLLOW_UP.subject,
                due: '2099-11-30',
                due_words: 'Monday',
                kind: 'call',
              },
            ],
          },
        ])
      }, SORTED)
      expect(server.saved()?.tasks.map((task) => task.due)).toEqual(['2099-11-30'])
    },
    LONG_TEST,
  )

  it('a reply or a sound alone asks nothing: no find, no search and no AI (PLAN-V24 review)', async () => {
    vi.useFakeTimers(CLOCK)
    const server = callServer()
    const { mic, of, calls } = page({ [CALL_WORDS]: northWind() }, server.answers)
    const found = await callCard(mic)
    for (const said of ['hmm', 'great', 'okay', 'sure']) await say(mic, said)
    await wait(1000)
    const finds = calls.filter((call) => call.path === '/api/v1/companies/assistant/companies/find')
    expect(finds).toEqual([])
    // The box searches our copy for the name as heard as it opens, and for nothing since.
    expect(searches(calls).filter((words) => words !== 'North Wind')).toEqual([])
    expect(of(API.command)).toHaveLength(1)
    expect(within(found).getByRole('textbox', { name: 'Find a company' })).toHaveValue('North Wind')
  })

  it('a name said while "Which Sample?" asks, and not in its list, opens the search with it', async () => {
    vi.useFakeTimers(CLOCK)
    const TASK_WORDS = 'Add a task to send Sample the quote'
    const { mic, of } = page(
      {
        [TASK_WORDS]: taskCommand({
          company: {
            found: null,
            choices: [SAMPLE, OTHER_SAMPLE],
            from_page: false,
            heard: 'Sample',
          },
        }),
      },
      {},
    )
    act(() => {
      openVoiceBar()
    })
    const bar = await screen.findByRole('dialog', { name: BAR })
    // Words said before the mic listens are heard by no one: run alone, the bar starts cold.
    await waitFor(() => {
      expect(bar.querySelector('[data-slot=voice-title]')).toHaveTextContent('Listening')
    })
    await say(mic, TASK_WORDS)
    const found = await screen.findByRole('dialog', {
      name: 'Add a task for you: send Sample Logistics the quote, due Fri 27 Nov.',
    })
    expect(within(found).getByRole('group', { name: 'Which Sample?' })).toBeInTheDocument()
    await say(mic, 'Northwind')
    await wait(300)
    expect(within(found).queryByRole('group', { name: 'Which Sample?' })).toBeNull()
    expect(within(found).getByRole('textbox', { name: 'Find a company' })).toHaveValue('Northwind')
    await say(mic, 'the first one')
    await waitFor(() => {
      expect(of(API.taskPreview).at(-1)?.body).toMatchObject({ company_key: NORTHWIND.key })
    })
    expect(of(API.command)).toHaveLength(1)
  })
})

describe('V on the card, with "Keep listening" off', () => {
  it('the company said again fills the search too, after the command step', async () => {
    const server = callServer()
    const { mic, user, of } = show(northWind(), {
      ...server.answers,
      [API.command]: command({ action: 'unknown', read_back: 'No.' }),
    })
    const found = await card()
    await within(found).findByText(SAVED)
    within(found).getByRole('button', { name: 'Send' }).focus()
    await user.keyboard('v')
    await waitFor(() => {
      expect(found.querySelector('[data-slot=card-voice]')).toHaveTextContent('Listening')
    })
    act(() => {
      mic.say('Northwind')
    })
    await user.keyboard('v')
    await waitFor(() => {
      expect(within(found).getByRole('textbox', { name: 'Find a company' })).toHaveValue(
        'Northwind',
      )
    })
    expect(await within(found).findByRole('button', { name: /Northwind Pty Ltd/ })).toBeVisible()
    // Its words went to the command step first, as any change said on the card does.
    expect(of(API.command)).toHaveLength(1)
    expect(of(notePath(), 'PATCH')).toHaveLength(0)
  })
})
