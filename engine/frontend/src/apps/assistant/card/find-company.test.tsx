/**
 * The card's own find for a company said or entered again (PLAN-V24 T3-2, choice 19; Al-khair, 21
 * Nov): its three answers by voice, and by typing then Enter (one found is the card's company at
 * once, with its line; two or more are choices, where "the first one" picks; none gives "Still no",
 * with Add to HubSpot); "North Wind" finds Northwind from the server's answer; a call asking "Which
 * Sample?" is saved at once, and its pick from those choices says not to teach the mic, while a
 * pick from the find's results leaves `teach` out; a refusal shows plain words; and none of it asks
 * the AI. Against a fake server, a fake mic and a fake clock: nothing real is sent. Made-up names
 * only: Sample Logistics Pty Ltd, Sample Freight Pty Ltd, Northwind Pty Ltd, North Wind and
 * Southwind as heard, Jo Sample.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/api/query'
import type {
  AssistantCommand,
  AssistantCommandIn,
  AssistantCompanyFind,
  CallNoteIn,
  CallNoteOut,
  CallNotePatch,
  CompanyHit,
} from '@/api/types'
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
  companyPreview,
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
import { companyFindQueryOptions } from './find'
import { CardHost } from './host'
import { closeCard, openCard } from './store'

const FIND = '/api/v1/companies/assistant/companies/find'
const CARD = 'Log a call with North Wind.'
const NEW_IN_HUBSPOT = "Northwind Pty Ltd is new in HubSpot. We'll use it."
const STILL_NO_CALL = "Still no 'Southwind'. Say it again, or pick it later in Call logs."
const STILL_NO_TASK = "Still no 'Southwind'. Say it again, or pick it."
const CONTACT_DETAILS =
  "Contact details left out. Phone numbers and emails can't be searched for. Take them out of the company's name, then try again."
/** A short pause ends a turn; nothing else ends the conversation by itself here. */
const TALK: Partial<Times> = { pause: 50, quiet: 600_000, turn: 600_000 }

/** "Log a call with North Wind": the command found it nowhere, and HubSpot wasn't searched. */
function northWind(): AssistantCommand {
  return callCommand({
    read_back: CARD,
    company: { found: null, choices: [], from_page: false, heard: 'North Wind', can_add: false },
    person: null,
  })
}

/** "Log a call with Sample": the command found two. */
function whichSample(): AssistantCommand {
  return callCommand({
    read_back: 'Log a call with Sample.',
    company: { found: null, choices: [SAMPLE, OTHER_SAMPLE], from_page: false, heard: 'Sample' },
    person: null,
  })
}

// --- A fake server ------------------------------------------------------------------------------

/** The find's answers, as the server gives them (the command's company shape, and its line). */
function found(words: string, hit: CompanyHit, fromHubspot: boolean): AssistantCompanyFind {
  return {
    company: {
      heard: words,
      from_page: false,
      found: hit,
      choices: [],
      from_hubspot: fromHubspot,
      can_add: false,
    },
    line: fromHubspot ? `${hit.name} is new in HubSpot. We'll use it.` : null,
  }
}

function choices(words: string, hits: CompanyHit[]): AssistantCompanyFind {
  return {
    company: {
      heard: words,
      from_page: false,
      found: null,
      choices: hits,
      from_hubspot: false,
      can_add: false,
    },
    line: `Which ${words}?`,
  }
}

function nowhere(words: string): AssistantCompanyFind {
  return {
    company: {
      heard: words,
      from_page: false,
      found: null,
      choices: [],
      from_hubspot: false,
      can_add: true,
    },
    line: `${words} isn't in HubSpot. Add it, or pick another company.`,
  }
}

/** The card's find on a fake server: each answer by its words, or a refusal of a phone number. */
function finder(answers: Record<string, AssistantCompanyFind>): Answer {
  return (call) => {
    const words = new URLSearchParams(call.search).get('words') ?? ''
    if (/\d{3}/.test(words)) {
      return Response.json(
        {
          title: 'Contact details left out',
          status: 422,
          detail:
            "Phone numbers and emails can't be searched for. Take them out of the company's name, then try again.",
          code: 'contact_details',
        },
        { status: 422 },
      )
    }
    return Response.json(answers[words] ?? nowhere(words))
  }
}

/** The find's answers these tests use. */
const FINDS: Record<string, AssistantCompanyFind> = {
  // As the learned names and HubSpot's own search would have it: North Wind is Northwind.
  'North Wind': found('North Wind', NORTHWIND, true),
  Sample: choices('Sample', [SAMPLE, OTHER_SAMPLE]),
  Southwind: nowhere('Southwind'),
}

/** Our copy's search, by keys typed: each company whose name holds the words. */
const search: Answer = (call) => {
  const q = (new URLSearchParams(call.search).get('q') ?? '').trim().toLowerCase()
  return Response.json({
    people: [],
    companies: [SAMPLE, OTHER_SAMPLE, NORTHWIND].filter((one) =>
      one.name.toLowerCase().includes(q),
    ),
  })
}

/**
 * The call on a fake server, as T3-1's contract has it: saved with only the name as heard it is
 * `needs_company`; a pick (PATCH `company_key`) sorts it; a read then finds it sorted.
 */
function callServer() {
  let saved: CallNoteOut | null = null
  const save: Answer = (call) => {
    if (call.method !== 'POST') return undefined
    const body = call.body as CallNoteIn
    saved ??= note({
      status: body.company_key ? 'sorting' : 'needs_company',
      company_key: body.company_key ?? null,
      company_name: body.company_key ? SAMPLE.name : null,
      company_heard: body.company_heard ?? null,
      person: null,
      call: { in_hubspot: false, outcome: null, summary: '' },
      changes: [],
      tasks: [],
    })
    return Response.json(saved, { status: 201 })
  }
  const one: Answer = (call) => {
    if (saved === null) return undefined
    const patch = call.body as CallNotePatch
    if (call.method === 'PATCH' && patch.company_key) {
      const hit = [SAMPLE, OTHER_SAMPLE, NORTHWIND].find((one) => one.key === patch.company_key)
      saved = {
        ...saved,
        status: 'sorting',
        company_key: patch.company_key,
        company_name: hit?.name ?? null,
      }
    } else if (saved.status === 'sorting') {
      const { company_key, company_name, company_heard } = saved
      saved = { ...note(), company_key, company_name, company_heard, person: null }
    }
    return Response.json(saved)
  }
  return {
    [API.notes]: save,
    [notePath()]: one,
    [API.notePreview]: () => (saved === null ? undefined : Response.json(notePreview(saved))),
  }
}

/** What every page here answers. */
function base(): Record<string, unknown> {
  return {
    [API.options]: options(),
    [API.summary]: { to_confirm: 0, needs_look: 0, logged_today: 0, needs_company: 0 },
    [API.search]: search,
    [API.taskPreview]: write(),
    [API.emailPreview]: teamEmail(),
    [API.team]: [SAM],
    [API.companyPreview]: companyPreview(),
    [FIND]: finder(FINDS),
    ...callServer(),
  }
}

/** A card opened by a typed command, on a page with a fake server, and these answers too. */
function show(made: AssistantCommand, answers: Record<string, unknown> = {}) {
  const mic = new FakeMic()
  const calls = mockApi({ ...base(), ...answers })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), { state: 'off' })
  const view = renderWithProviders(
    <CardHost env={mic.env()} makeTool={mic.tool} times={{ guard: 0, preview: 0, sort: 20 }} />,
    { queryClient },
  )
  act(() => {
    openCard({ kind: 'command', command: made, words: 'the words', source: 'typed' })
  })
  const of = (path: string, method = 'POST') =>
    calls.filter((call) => call.path === path && call.method === method)
  return { mic, calls, of, ...view }
}

/** The words each find was asked for. */
function finds(calls: readonly { path: string; search: string }[]): string[] {
  return calls
    .filter((call) => call.path === FIND)
    .map((call) => new URLSearchParams(call.search).get('words') ?? '')
}

async function card() {
  return screen.findByRole('dialog')
}

/** Types a name in the company box, then Enter. */
async function enter(found: HTMLElement, user: ReturnType<typeof show>['user'], name: string) {
  const box = within(found).getByRole('textbox', { name: 'Find a company' })
  await user.clear(box)
  await user.type(box, name)
  await user.keyboard('{Enter}')
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

// --- Typed, then Enter ----------------------------------------------------------------------------

describe('a name typed in the company box, then Enter', () => {
  it('one found: "North Wind" finds Northwind, with its line, and the call is sorted', async () => {
    const { user, of, calls } = show(northWind())
    const found = await card()
    await waitFor(() => {
      expect(of(API.notes)).toHaveLength(1)
    })
    // Keys typed filter our copy, and ask the find nothing.
    const box = within(found).getByRole('textbox', { name: 'Find a company' })
    await user.clear(box)
    await user.type(box, 'North Wind')
    expect(finds(calls)).toEqual([])
    await user.keyboard('{Enter}')
    expect(await within(found).findByText(NEW_IN_HUBSPOT)).toBeInTheDocument()
    expect(within(found).getByText(NORTHWIND.name)).toBeInTheDocument()
    expect(finds(calls)).toEqual(['North Wind'])
    // The pick goes to the server, which teaches the mic: `teach` is left out.
    await waitFor(() => {
      expect(of(notePath(), 'PATCH').map((call) => call.body)).toEqual([
        { company_key: NORTHWIND.key },
      ])
    })
    expect(await within(found).findByRole('button', { name: 'Connected' })).toBeInTheDocument()
    // Enter looked; it never sent, and no AI was asked.
    expect(of(API.confirm)).toHaveLength(0)
    expect(of(API.command)).toHaveLength(0)
  })

  it('two or more: they show as choices, and a pick from them leaves `teach` out', async () => {
    const { user, of } = show(northWind())
    const found = await card()
    await waitFor(() => {
      expect(of(API.notes)).toHaveLength(1)
    })
    await enter(found, user, 'Sample')
    const group = await within(found).findByRole('group', { name: 'Which Sample?' })
    expect(
      within(group)
        .getAllByRole('button')
        .map((one) => one.textContent),
    ).toEqual([
      'Sample Logistics Pty LtdLogistics · Perth',
      'Sample Freight Pty LtdFreight · Melbourne',
    ])
    await user.click(within(group).getByRole('button', { name: /Sample Freight/ }))
    await waitFor(() => {
      expect(of(notePath(), 'PATCH').map((call) => call.body)).toEqual([
        { company_key: OTHER_SAMPLE.key },
      ])
    })
    expect(of(API.command)).toHaveLength(0)
  })

  it('nowhere: "Still no", with Add to HubSpot once HubSpot was searched, and the call is kept', async () => {
    const { user, of } = show(northWind())
    const found = await card()
    await waitFor(() => {
      expect(of(API.notes)).toHaveLength(1)
    })
    // HubSpot wasn't searched for the command: no add yet.
    expect(within(found).queryByRole('button', { name: 'Add to HubSpot' })).toBeNull()
    await enter(found, user, 'Southwind')
    const line = await within(found).findByText(STILL_NO_CALL)
    expect(line.closest('[role=status]')).not.toBeNull()
    expect(within(found).getByRole('button', { name: 'Add to HubSpot' })).toBeInTheDocument()
    // The box keeps the focus, for the next try.
    expect(within(found).getByRole('textbox', { name: 'Find a company' })).toHaveFocus()
    expect(of(notePath(), 'PATCH')).toHaveLength(0)
    expect(of(notePath(), 'DELETE')).toHaveLength(0)
    // Add to HubSpot opens with the words entered.
    await user.click(within(found).getByRole('button', { name: 'Add to HubSpot' }))
    expect(within(found).getByRole('textbox', { name: 'Company name' })).toHaveValue('Southwind')
    expect(of(API.command)).toHaveLength(0)
  })

  it('a phone number in the words: the server’s plain words, and our copy still searches', async () => {
    const { user, of } = show(northWind())
    const found = await card()
    await enter(found, user, 'Sample 0412 345 678')
    expect(await within(found).findByText(CONTACT_DETAILS)).toBeInTheDocument()
    // No code, no field name: only what happened and what to do.
    expect(within(found).queryByText(/contact_details|query\.words/)).toBeNull()
    expect(within(found).getByRole('textbox', { name: 'Find a company' })).toHaveValue(
      'Sample 0412 345 678',
    )
    expect(of(API.command)).toHaveLength(0)
  })

  it('on a task card too: the name found is the task’s company', async () => {
    const { user, of } = show(
      taskCommand({
        company: { found: null, choices: [], from_page: false, heard: 'North Wind' },
      }),
    )
    const found = await card()
    await enter(found, user, 'North Wind')
    expect(await within(found).findByText(NEW_IN_HUBSPOT)).toBeInTheDocument()
    await waitFor(() => {
      expect(of(API.taskPreview).at(-1)?.body).toMatchObject({ company_key: NORTHWIND.key })
    })
    expect(of(API.command)).toHaveLength(0)
  })
})

// --- "Which Sample?" on a call --------------------------------------------------------------------

describe('a find still on its way (PLAN-V24 review)', () => {
  /** The card's find, answering only once the test lets it: HubSpot's search can take 8 seconds. */
  function slowFind() {
    let answer = (): void => undefined
    const answered = new Promise<void>((resolve) => {
      answer = resolve
    })
    const fast = finder(FINDS)
    const slow = ((call: Parameters<Answer>[0]) =>
      answered.then(() => fast(call))) as unknown as Answer
    return { slow, answer: () => answer() }
  }

  it('picks nothing once the box’s words change: a late match for the old words isn’t the company', async () => {
    const find = slowFind()
    const { user, of, calls, queryClient } = show(northWind(), { [FIND]: find.slow })
    const found = await card()
    await waitFor(() => {
      expect(of(API.notes)).toHaveLength(1)
    })
    await enter(found, user, 'North Wind')
    expect(await within(found).findByText('Looking.')).toBeInTheDocument()
    // The rep types another name while HubSpot's search runs.
    const box = within(found).getByRole('textbox', { name: 'Find a company' })
    await user.clear(box)
    await user.type(box, 'Sample')
    find.answer()
    // The answer is in, so the card's find has heard it.
    await waitFor(() => {
      expect(queryClient.getQueryData(companyFindQueryOptions('North Wind').queryKey)).toBeDefined()
    })
    expect(finds(calls)).toEqual(['North Wind'])
    // North Wind's one match isn't the company: nothing picked, nothing sent, nothing it said.
    expect(within(found).queryByText(NEW_IN_HUBSPOT)).toBeNull()
    expect(of(notePath(), 'PATCH')).toEqual([])
    expect(box).toHaveValue('Sample')
    // Our copy's search for the words typed is there to pick from.
    const choices = await within(found).findByRole('group', { name: 'Which company?' })
    expect(within(choices).getAllByRole('button')).toHaveLength(2)
    await user.click(within(choices).getAllByRole('button')[0])
    await waitFor(() => {
      expect(of(notePath(), 'PATCH').map((call) => call.body)).toEqual([
        { company_key: SAMPLE.key },
      ])
    })
  })

  it('with the box as it was, its one match is the company, as before', async () => {
    const find = slowFind()
    const { user, of } = show(northWind(), { [FIND]: find.slow })
    const found = await card()
    await waitFor(() => {
      expect(of(API.notes)).toHaveLength(1)
    })
    await enter(found, user, 'North Wind')
    await within(found).findByText('Looking.')
    act(() => {
      find.answer()
    })
    expect(await within(found).findByText(NEW_IN_HUBSPOT)).toBeInTheDocument()
    await waitFor(() => {
      expect(of(notePath(), 'PATCH').map((call) => call.body)).toEqual([
        { company_key: NORTHWIND.key },
      ])
    })
  })
})

describe('a call asking "Which Sample?" (Al-khair, 21 Nov)', () => {
  it('is saved at once, and a pick from those choices says not to teach the mic', async () => {
    const { user, of } = show(whichSample())
    const found = await card()
    await waitFor(() => {
      expect(of(API.notes)).toHaveLength(1)
    })
    expect(of(API.notes)[0]?.body).toMatchObject({ company_heard: 'Sample' })
    expect(of(API.notes)[0]?.body).not.toHaveProperty('company_key')
    const group = within(found).getByRole('group', { name: 'Which Sample?' })
    await user.click(within(group).getByRole('button', { name: /Sample Freight/ }))
    await waitFor(() => {
      expect(of(notePath(), 'PATCH').map((call) => call.body)).toEqual([
        { company_key: OTHER_SAMPLE.key, teach: false },
      ])
    })
    expect(within(found).getByText(OTHER_SAMPLE.name)).toBeInTheDocument()
    expect(of(API.command)).toHaveLength(0)
  })
})

// --- By voice, in a conversation ------------------------------------------------------------------

const CALL_WORDS = 'Log a call with North Wind, spoke to Jo about the lease'
const SAMPLE_WORDS = 'Log a call with Sample, spoke to Jo about the lease'
const BAR = 'Speak to the Assistant'

/** The command step answers by the words said. */
function byWords(answers: Record<string, AssistantCommand>): Answer {
  return (call) => {
    const said = (call.body as AssistantCommandIn).text
    return Response.json(answers[said] ?? command({ action: 'unknown', read_back: 'No.' }))
  }
}

/** A page with the voice bar on it, "Keep listening" on, and a fake server. */
function page(said: Record<string, AssistantCommand>) {
  setKeepListening(true)
  const mic = new FakeMic()
  const calls = mockApi({ ...base(), [API.command]: byWords(said) })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), { state: 'off' })
  const view = renderWithProviders(<VoiceBar env={mic.env()} makeTool={mic.tool} times={TALK} />, {
    queryClient,
    route: '/assistant',
  })
  const of = (path: string, method = 'POST') =>
    calls.filter((call) => call.path === path && call.method === method)
  return { mic, calls, of, ...view }
}

/** The rep says a turn: the pause after it ends it. */
async function say(mic: FakeMic, words: string) {
  act(() => {
    mic.say(words)
  })
  await wait(TALK.pause ?? 0)
}

/** Opens the bar, says the call, and waits for its card. */
async function callCard(mic: FakeMic, words: string, name: string) {
  act(() => {
    openVoiceBar()
  })
  const bar = await screen.findByRole('dialog', { name: BAR })
  await waitFor(() => {
    expect(bar.querySelector('[data-slot=voice-title]')).toHaveTextContent('Listening')
  })
  await say(mic, words)
  return screen.findByRole('dialog', { name })
}

describe('the company said again, by voice', () => {
  it('one found: "North Wind" is Northwind at once, with its line, and no AI is asked', async () => {
    vi.useFakeTimers(CLOCK)
    const { mic, of, calls } = page({ [CALL_WORDS]: northWind() })
    const found = await callCard(mic, CALL_WORDS, CARD)
    await waitFor(() => {
      expect(of(API.notes)).toHaveLength(1)
    })
    await say(mic, 'North Wind.')
    expect(await within(found).findByText(NEW_IN_HUBSPOT)).toBeInTheDocument()
    expect(finds(calls)).toEqual(['North Wind'])
    await waitFor(() => {
      expect(of(notePath(), 'PATCH').map((call) => call.body)).toEqual([
        { company_key: NORTHWIND.key },
      ])
    })
    // Only the command that opened the card asked the AI.
    expect(of(API.command)).toHaveLength(1)
  })

  it('two or more: "Which Sample?", and "the second one" picks, leaving `teach` out', async () => {
    vi.useFakeTimers(CLOCK)
    const { mic, of } = page({ [CALL_WORDS]: northWind() })
    const found = await callCard(mic, CALL_WORDS, CARD)
    await waitFor(() => {
      expect(of(API.notes)).toHaveLength(1)
    })
    await say(mic, 'Sample')
    expect(await within(found).findByRole('group', { name: 'Which Sample?' })).toBeInTheDocument()
    await say(mic, 'the second one')
    await waitFor(() => {
      expect(of(notePath(), 'PATCH').map((call) => call.body)).toEqual([
        { company_key: OTHER_SAMPLE.key },
      ])
    })
    expect(of(API.command)).toHaveLength(1)
  })

  it('nowhere: "Still no", with Add to HubSpot, and the call is kept', async () => {
    vi.useFakeTimers(CLOCK)
    const { mic, of } = page({ [CALL_WORDS]: northWind() })
    const found = await callCard(mic, CALL_WORDS, CARD)
    await waitFor(() => {
      expect(of(API.notes)).toHaveLength(1)
    })
    await say(mic, 'Southwind')
    expect(await within(found).findByText(STILL_NO_CALL)).toBeInTheDocument()
    expect(within(found).getByRole('button', { name: 'Add to HubSpot' })).toBeInTheDocument()
    expect(within(found).getByRole('textbox', { name: 'Find a company' })).toHaveValue('Southwind')
    expect(of(notePath(), 'PATCH')).toHaveLength(0)
    expect(of(API.command)).toHaveLength(1)
  })

  it('"the second one" from a call’s own "Which Sample?" says not to teach the mic', async () => {
    vi.useFakeTimers(CLOCK)
    const { mic, of, calls } = page({ [SAMPLE_WORDS]: whichSample() })
    await callCard(mic, SAMPLE_WORDS, 'Log a call with Sample.')
    await waitFor(() => {
      expect(of(API.notes)).toHaveLength(1)
    })
    await say(mic, 'the second one')
    await waitFor(() => {
      expect(of(notePath(), 'PATCH').map((call) => call.body)).toEqual([
        { company_key: OTHER_SAMPLE.key, teach: false },
      ])
    })
    expect(finds(calls)).toEqual([])
    expect(of(API.command)).toHaveLength(1)
  })
})

describe('on a task card, by voice', () => {
  it('nowhere says so in the task’s own words', async () => {
    vi.useFakeTimers(CLOCK)
    const TASK_WORDS = 'Add a task to send North Wind the quote'
    const { mic, of } = page({
      [TASK_WORDS]: taskCommand({
        company: { found: null, choices: [], from_page: false, heard: 'North Wind' },
      }),
    })
    const found = await callCard(
      mic,
      TASK_WORDS,
      'Add a task for you: send Sample Logistics the quote, due Fri 27 Nov.',
    )
    await say(mic, 'Southwind')
    expect(await within(found).findByText(STILL_NO_TASK)).toBeInTheDocument()
    expect(of(API.command)).toHaveLength(1)
  })
})
