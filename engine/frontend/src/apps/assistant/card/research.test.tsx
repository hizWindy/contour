/**
 * Research in the Assistant (PLAN-V27 T4-2, choices 18 and 19), with a fake server, a fake mic and
 * a fake run stream, at a laptop's width (1440px) and a phone's (390px):
 *
 * - the card shows what we know, each line with its source, and the cost line;
 * - Enter, "yes" (said after a spoken command, or in a long conversation) or a tap starts a run of
 *   one company, and the POST carries the company, its key, its city and the words as said;
 * - the card closes at once, and a new command can be given while the run goes on;
 * - each finding shows as it arrives, one line with its source; the end says "Done: Northwind is a
 *   B lead." with "Open the lead card" and "Add to HubSpot";
 * - a lead card from the last 30 days and a HubSpot company's call prep open with no POST;
 * - a maybe shows the best guess and "It's new", and a pick reads the free block with the words as
 *   heard, never the choice's name;
 * - `can_start: false` shows the blocked words and starts nothing; a 409 or a 403 shows plain words.
 *
 * Made-up names only: Northwind, Northwind Pty Ltd, Sample Logistics Pty Ltd, Jo Sample.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import { useLocation } from 'react-router'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/api/query'
import type { AssistantChoice, AssistantCommand, AssistantResearch, RunEvent } from '@/api/types'
import { FakeMic } from '@/apps/companies/call-notes/mic/fake-mic'
import { FakeEventSource } from '@/test/fake-event-source'
import { mockApi, TEST_RUN_ID, type Call } from '@/test/mock-api'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { asLaptop, asPhone } from '@/test/screen'
import { handOver } from '../voice/hand-over'
import { API, command, NORTHWIND, options, SAMPLE, taskCommand, write } from './fixtures'
import { CardHost } from './host'
import { clearResearches } from './research-store'
import { closeCard, openCard } from './store'

// --- Made-up data --------------------------------------------------------------------------------

const RESEARCH = '/api/v1/companies/assistant/research'
const LEAD_ID = '6a1f0000-0000-4000-8000-000000000001'
const QUESTION = 'Research Northwind? About US$0.38.'

function research(change: Partial<AssistantResearch> = {}): AssistantResearch {
  return {
    company: 'Northwind',
    company_key: null,
    city: 'Perth',
    hubspot: 'new',
    last_activity: null,
    lead: null,
    lease_end: '2028-03-31',
    area_m2: 1200,
    known: [
      {
        kind: 'hubspot',
        text: 'Northwind: not in HubSpot.',
        day: null,
        source: 'HubSpot',
        url: null,
      },
      {
        kind: 'lease_end',
        text: 'Property Daily, 3 Oct: lease ends March 2028.',
        day: '2026-10-03',
        source: 'Property Daily',
        url: 'https://www.propertydaily.example.com/northwind-lease',
      },
    ],
    next: 'ask',
    question: QUESTION,
    cost_usd: '0.38',
    can_start: true,
    blocked: null,
    ...change,
  }
}

function researchCommand(
  block: AssistantResearch = research(),
  change: Partial<AssistantCommand> = {},
): AssistantCommand {
  return command({
    action: 'research',
    read_back: block.question ?? block.known[0]?.text ?? '',
    company: { found: null, choices: [], from_page: false, heard: 'Northwind' },
    research: block,
    ...change,
  })
}

/** "Research Northwind" said: two may match, and Northwind Pty Ltd is likely. */
const CHOICES: AssistantChoice[] = [
  { ...NORTHWIND, reason: 'Yours.', detail: 'Perth' },
  { ...SAMPLE, detail: 'Owner: Jo Sample' },
]
function maybeCommand(): AssistantCommand {
  return researchCommand(
    research({
      company: '',
      hubspot: 'possible_match',
      known: [
        {
          kind: 'hubspot',
          text: 'Northwind may be in HubSpot.',
          day: null,
          source: 'HubSpot',
          url: null,
        },
      ],
      next: 'choose',
      question: null,
      cost_usd: null,
    }),
    {
      read_back: 'Northwind may be in HubSpot.',
      company: {
        found: null,
        choices: CHOICES,
        from_page: false,
        heard: 'Northwind',
        level: 'likely',
        reason: 'Yours.',
      },
    },
  )
}

function event(seq: number, type: RunEvent['type'], data: Record<string, unknown>): RunEvent {
  return { seq, type, created_at: '2026-11-24T01:00:00Z', data } as unknown as RunEvent
}

const STARTED = { run_id: TEST_RUN_ID, company: 'Northwind', status: 'queued' }

// --- The page ------------------------------------------------------------------------------------

function Where() {
  const location = useLocation()
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>
}

interface Show {
  answers?: Record<string, unknown>
  source?: 'mic' | 'typed'
}

function show(made: AssistantCommand, { answers = {}, source = 'typed' }: Show = {}) {
  const mic = new FakeMic()
  const calls = mockApi({
    [API.options]: options(),
    [API.summary]: { to_confirm: 0, needs_look: 0, logged_today: 0 },
    [API.taskPreview]: write(),
    [RESEARCH]: (call: Call) =>
      call.method === 'POST' ? Response.json(STARTED, { status: 201 }) : Response.json(research()),
    ...answers,
  })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), { state: 'off' })
  const view = renderWithProviders(
    <>
      <CardHost env={mic.env()} makeTool={mic.tool} times={{ guard: 0, preview: 0 }} />
      <Where />
    </>,
    { queryClient },
  )
  act(() => {
    openCard({ kind: 'command', command: made, words: 'research Northwind', source })
  })
  const posts = () => calls.filter((call) => call.path === RESEARCH && call.method === 'POST')
  const gets = () => calls.filter((call) => call.path === RESEARCH && call.method === 'GET')
  return { mic, calls, posts, gets, ...view }
}

async function card() {
  return screen.findByRole('dialog')
}

/** The run's stream, once the tray has opened it. */
async function stream(): Promise<FakeEventSource> {
  await waitFor(() => {
    expect(FakeEventSource.instances.length).toBeGreaterThan(0)
  })
  const source = FakeEventSource.last()
  expect(source.url).toContain(`/runs/${TEST_RUN_ID}/events`)
  act(() => {
    source.emitOpen()
  })
  return source
}

function send(source: FakeEventSource, item: RunEvent) {
  act(() => {
    source.emitMessage(item)
  })
}

/** The progress. A dialog open over it hides it from the reading order, as any page behind. */
function tray(behindDialog = false): HTMLElement {
  if (!behindDialog) return screen.getByRole('region', { name: 'Research in the background' })
  const found = document.querySelector<HTMLElement>('[data-slot=research-tray]')
  if (!found) throw new Error('No research tray')
  return found
}

afterEach(() => {
  act(() => {
    closeCard()
    clearResearches()
    toast.dismiss()
  })
  window.localStorage.clear()
})

// --- On screen -----------------------------------------------------------------------------------

describe.each([
  ['a laptop (1440px)', asLaptop],
  ['a phone (390px)', asPhone],
])('research in the Assistant, on %s', (_width, size) => {
  it('the card shows what we know, with its source, and asks with the cost', async () => {
    size()
    show(researchCommand())
    const found = await card()
    expect(found).toHaveAccessibleName(QUESTION)
    const known = within(found).getByRole('list', { name: 'What we know' })
    expect(within(known).getByText('Northwind: not in HubSpot.')).toBeInTheDocument()
    expect(within(known).getByText(/lease ends March 2028/)).toBeInTheDocument()
    expect(
      within(known).getByRole('link', { name: /propertydaily\.example\.com/ }),
    ).toHaveAttribute('href', 'https://www.propertydaily.example.com/northwind-lease')
    // The one main button, with the focus, and Cancel.
    await waitFor(() => {
      expect(within(found).getByRole('button', { name: /Start research/ })).toHaveFocus()
    })
    expect(within(found).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('Enter starts a run of one company, and the card closes at once', async () => {
    size()
    const { user, posts } = show(
      researchCommand(research({ company_key: 'lead:9b1d', city: 'Perth' })),
    )
    const found = await card()
    await waitFor(() => {
      expect(within(found).getByRole('button', { name: /Start research/ })).toHaveFocus()
    })
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(posts()).toHaveLength(1)
    })
    expect(posts()[0]?.body).toEqual({
      company: 'Northwind',
      company_key: 'lead:9b1d',
      city: 'Perth',
      said: 'Northwind',
    })
    expect(posts()[0]?.headers?.get('idempotency-key')).toBeTruthy()
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    // The progress's code loads as the first research starts.
    expect(
      await within(
        await screen.findByRole('region', { name: 'Research in the background' }),
      ).findByRole('heading', { name: 'Researching Northwind' }),
    ).toBeInTheDocument()
  })

  it('a tap starts it too, once, and each finding shows as it arrives, then the end', async () => {
    size()
    const { user, posts, queryClient } = show(researchCommand())
    const refreshed = vi.spyOn(queryClient, 'invalidateQueries')
    const found = await card()
    await user.click(within(found).getByRole('button', { name: /Start research/ }))
    await waitFor(() => {
      expect(posts()).toHaveLength(1)
    })
    const source = await stream()
    expect(within(tray()).getByText(/Each finding shows here as it arrives/)).toBeInTheDocument()

    send(source, event(1, 'run_started', { mode: 'company' }))
    send(
      source,
      event(2, 'finding', {
        company: 'Northwind',
        text: 'Northwind hired 40 staff this year.',
        source_url: 'https://news.example.com/northwind',
        next_question: 'A second office?',
      }),
    )
    const first = within(tray()).getAllByRole('listitem')
    expect(first).toHaveLength(1)
    expect(first[0]).toHaveTextContent(
      'Found: Northwind hired 40 staff this year (news.example.com',
    )
    expect(first[0]).toHaveTextContent('Now checking: A second office?')
    expect(within(first[0]).getByRole('link')).toHaveAttribute(
      'href',
      'https://news.example.com/northwind',
    )

    send(
      source,
      event(3, 'finding', {
        company: 'Northwind',
        text: 'Its lease ends in March 2028',
        source_url: null,
      }),
    )
    expect(within(tray()).getAllByRole('listitem')).toHaveLength(2)
    expect(within(tray()).getAllByRole('listitem')[1]).toHaveTextContent(
      'Found: Its lease ends in March 2028.',
    )

    send(
      source,
      event(4, 'company_done', {
        name: 'Northwind',
        lead_id: LEAD_ID,
        result: 'pass',
        score: 71,
        cost_usd: '0.36',
        hubspot_status: 'new',
        tier: 'B',
      }),
    )
    send(
      source,
      event(5, 'run_finished', { status: 'done', stop_reason: null, cost_usd: '0.36', counts: {} }),
    )
    expect(
      within(tray()).getByRole('heading', { name: 'Done: Northwind is a B lead.' }),
    ).toBeInTheDocument()
    expect(within(tray()).getByRole('link', { name: 'Open the lead card' })).toHaveAttribute(
      'href',
      `/leads/${LEAD_ID}`,
    )
    expect(within(tray()).getByRole('button', { name: 'Add to HubSpot' })).toBeInTheDocument()
    // One polite line at the end, not one for each finding.
    expect(document.querySelector('[data-slot=research-said]')).toHaveTextContent(
      'Done: Northwind is a B lead.',
    )
    // Its lead shows in Results, on Home and in the runs list without a reload.
    expect(refreshed).toHaveBeenCalledWith({ queryKey: queryKeys.leads.lists() })
    expect(refreshed).toHaveBeenCalledWith({ queryKey: queryKeys.runs.lists() })
  })

  it('a failed or stopped research says so plainly, with Open the run', async () => {
    size()
    const { user, posts } = show(researchCommand())
    await user.click(within(await card()).getByRole('button', { name: /Start research/ }))
    await waitFor(() => {
      expect(posts()).toHaveLength(1)
    })
    const source = await stream()
    send(
      source,
      event(1, 'company_failed', { name: 'Northwind', reason: 'Claude did not answer in time.' }),
    )
    send(
      source,
      event(2, 'run_finished', {
        status: 'cancelled',
        stop_reason: 'Stopped by Jo Sample.',
        cost_usd: '0.10',
        counts: {},
      }),
    )
    expect(
      within(tray()).getByText("Northwind couldn't be researched: Claude did not answer in time."),
    ).toBeInTheDocument()
    expect(
      within(tray()).getByRole('heading', {
        name: 'The research of Northwind was stopped. Stopped by Jo Sample.',
      }),
    ).toBeInTheDocument()
    expect(within(tray()).getByRole('link', { name: 'Open the run' })).toHaveAttribute(
      'href',
      `/runs/${TEST_RUN_ID}`,
    )
    expect(within(tray()).queryByRole('button', { name: 'Add to HubSpot' })).toBeNull()
  })

  it('Add to HubSpot opens the lead card’s own preview, and sends nothing before Confirm', async () => {
    size()
    const preview = `/api/v1/lead-finder/leads/${LEAD_ID}/hubspot/preview`
    const { user, calls } = show(researchCommand(), { answers: { [preview]: write() } })
    await user.click(within(await card()).getByRole('button', { name: /Start research/ }))
    const source = await stream()
    send(
      source,
      event(1, 'company_done', {
        name: 'Northwind',
        lead_id: LEAD_ID,
        result: 'pass',
        score: 80,
        cost_usd: '0.35',
        hubspot_status: 'new',
        tier: 'A',
      }),
    )
    expect(
      within(tray()).getByRole('heading', { name: 'Done: Northwind is an A lead.' }),
    ).toBeInTheDocument()
    await user.click(within(tray()).getByRole('button', { name: 'Add to HubSpot' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    await waitFor(() => {
      expect(calls.filter((call) => call.path === preview)).toHaveLength(1)
    })
    expect(calls.filter((call) => call.path.endsWith('/hubspot/send'))).toHaveLength(0)
  })

  it('a new command can be given while the research runs', async () => {
    size()
    const { user, posts } = show(researchCommand())
    await user.click(within(await card()).getByRole('button', { name: /Start research/ }))
    await waitFor(() => {
      expect(posts()).toHaveLength(1)
    })
    const source = await stream()
    // The next command, as the voice bar hands it on: its card opens at once.
    const go = vi.fn()
    act(() => {
      void handOver(
        { kind: 'command', command: taskCommand(), words: 'add a task', source: 'typed' },
        { go },
      )
    })
    const next = await card()
    expect(within(next).getByRole('button', { name: 'Send' })).toBeInTheDocument()
    // The research goes on beside it, and its findings still arrive.
    send(
      source,
      event(1, 'finding', {
        company: 'Northwind',
        text: 'Northwind opened a Sydney office',
        source_url: 'https://news.example.com/sydney',
      }),
    )
    expect(within(tray(true)).getByText(/Northwind opened a Sydney office/)).toBeInTheDocument()
    expect(FakeEventSource.instances.filter((one) => !one.closedByClient)).toHaveLength(1)
  })

  it('can_start false shows the blocked words and starts nothing', async () => {
    size()
    const blocked = 'Researching a new company needs the Lead Finder. Ask your Platform admin.'
    const { user, posts } = show(
      researchCommand(research({ can_start: false, question: null, blocked })),
    )
    const found = await card()
    expect(found).toHaveAccessibleName(blocked)
    expect(within(found).getByText('Northwind: not in HubSpot.')).toBeInTheDocument()
    expect(within(found).queryByRole('button', { name: /Start research/ })).toBeNull()
    await user.keyboard('{Enter}')
    await user.click(within(found).getByRole('button', { name: 'Close' }))
    expect(posts()).toHaveLength(0)
  })

  it.each([
    [409, 'run_already_active', 'A run is already going', 'Wait for it to finish, then try again.'],
    [
      403,
      'feature_not_allowed',
      'Not open to you',
      'Researching a new company needs the Lead Finder. Ask your Platform admin.',
    ],
  ])('a %s shows its plain words, and the card stays', async (status, code, title, detail) => {
    size()
    const { user, posts } = show(researchCommand(), {
      answers: {
        [RESEARCH]: () => Response.json({ title, detail, status, code }, { status }),
      },
    })
    const found = await card()
    await user.click(within(found).getByRole('button', { name: /Start research/ }))
    expect(await within(found).findByText(`${title}. ${detail}`)).toBeInTheDocument()
    expect(posts()).toHaveLength(1)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Research in the background' })).toBeNull()
  })

  it('a maybe shows the best guess and "It\'s new"; a pick reads the block with the words as heard', async () => {
    size()
    const { user, gets, posts } = show(maybeCommand())
    const found = await card()
    expect(found).toHaveAccessibleName('Northwind may be in HubSpot.')
    expect(found.querySelector('[data-slot=suggestion]')).toHaveTextContent(
      'Northwind Pty Ltd? Yours.',
    )
    expect(within(found).getByRole('button', { name: 'Use it' })).toBeInTheDocument()
    await user.click(within(found).getByRole('button', { name: "It's new" }))
    await waitFor(() => {
      expect(gets()).toHaveLength(1)
    })
    // "It's new": the words as heard only.
    expect(new URLSearchParams(gets()[0]?.search).get('name')).toBe('Northwind')
    expect(new URLSearchParams(gets()[0]?.search).get('company_key')).toBeNull()
    const asked = await screen.findByRole('dialog', { name: QUESTION })
    // The focus goes on to the one main button, so Enter starts it from here.
    await waitFor(() => {
      expect(within(asked).getByRole('button', { name: /Start research/ })).toHaveFocus()
    })
    expect(posts()).toHaveLength(0)
  })

  it('a picked HubSpot company that is not quiet opens its call prep, with no POST', async () => {
    size()
    const { user, gets, posts } = show(maybeCommand(), {
      answers: {
        [RESEARCH]: () =>
          Response.json(
            research({
              company: 'Northwind',
              company_key: NORTHWIND.key,
              hubspot: 'in_hubspot',
              next: 'open_prep',
              question: null,
            }),
          ),
      },
    })
    const found = await card()
    await user.click(within(found).getByRole('button', { name: 'Use it' }))
    await waitFor(() => {
      expect(screen.getByTestId('where')).toHaveTextContent(`/companies/${NORTHWIND.key}?prep=1`)
    })
    // The key of the pick, and the rep's words, never the choice's HubSpot name.
    const asked = new URLSearchParams(gets()[0]?.search)
    expect(asked.get('company_key')).toBe(NORTHWIND.key)
    expect(asked.get('name')).toBe('Northwind')
    expect(
      await screen.findByText('Northwind Pty Ltd is in HubSpot. Opening its call prep.'),
    ).toBeInTheDocument()
    expect(posts()).toHaveLength(0)
  })
})

// --- "yes" by voice ------------------------------------------------------------------------------

describe('"yes" by voice', () => {
  it('after a spoken command, "yes" starts the run', async () => {
    const { mic, posts } = show(researchCommand(), { source: 'mic' })
    const found = await card()
    expect(await within(found).findByText("Say 'yes' or press Enter")).toBeInTheDocument()
    await waitFor(() => {
      expect(mic.tools.at(-1)?.started).toBe(true)
    })
    act(() => {
      mic.say('Yes.')
    })
    await waitFor(() => {
      expect(posts()).toHaveLength(1)
    })
    expect(mic.live()).toBe(0)
  })

  it('"cancel" closes the card and starts nothing', async () => {
    const { mic, posts } = show(researchCommand(), { source: 'mic' })
    await card()
    await waitFor(() => {
      expect(mic.tools.at(-1)?.started).toBe(true)
    })
    act(() => {
      mic.say('cancel')
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(posts()).toHaveLength(0)
  })
})

// --- Where the command goes, with no card ---------------------------------------------------------

describe('the hand-over (choice 18)', () => {
  it('a lead card from the last 30 days opens at once, with no cost', () => {
    const calls = mockApi({})
    const go = vi.fn()
    const tell = vi.fn()
    const after = handOver(
      {
        kind: 'command',
        command: researchCommand(
          research({
            next: 'open_lead',
            question: null,
            lead: {
              lead_id: LEAD_ID,
              found_on: '2026-11-20',
              result: 'pass',
              tier: 'B',
              link: `/leads/${LEAD_ID}`,
            },
          }),
          { read_back: 'Northwind has a lead card from 20 Nov. Opening it.' },
        ),
        words: 'research Northwind',
        source: 'typed',
      },
      { go, tell },
    )
    expect(after).toEqual({ kind: 'close' })
    expect(go).toHaveBeenCalledWith(`/leads/${LEAD_ID}`)
    expect(tell).toHaveBeenCalledWith('Northwind has a lead card from 20 Nov. Opening it.')
    expect(calls).toHaveLength(0)
  })

  it('a HubSpot company that is not quiet opens its call prep; without call prep, its page', () => {
    const calls = mockApi({})
    const made = researchCommand(
      research({ company_key: '301', hubspot: 'in_hubspot', next: 'open_prep', question: null }),
      {
        read_back: 'Northwind Pty Ltd is in HubSpot. Opening its call prep.',
        company: { found: NORTHWIND, choices: [], from_page: false, heard: 'Northwind' },
      },
    )
    const heard = {
      kind: 'command',
      command: made,
      words: 'research Northwind',
      source: 'typed',
    } as const
    const go = vi.fn()
    const tell = vi.fn()
    void handOver(heard, { go, tell })
    expect(go).toHaveBeenLastCalledWith('/companies/301?prep=1')
    expect(tell).toHaveBeenLastCalledWith('Northwind Pty Ltd is in HubSpot. Opening its call prep.')
    void handOver(heard, { go, tell, canPrep: () => false })
    expect(go).toHaveBeenLastCalledWith('/companies/301')
    expect(tell).toHaveBeenLastCalledWith(
      "Northwind Pty Ltd is in HubSpot. Call prep isn't open to you, so its page opens.",
    )
    expect(calls).toHaveLength(0)
  })

  it('no name asks for one in the bar', () => {
    const after = handOver(
      {
        kind: 'command',
        command: researchCommand(
          research({ company: '', known: [], next: 'needs_name', question: null }),
          { read_back: 'Research which company? Say or type its name.' },
        ),
        words: 'research',
        source: 'typed',
      },
      { go: vi.fn() },
    )
    expect(after).toEqual({
      kind: 'show',
      line: 'Research which company? Say or type its name.',
      unsure: null,
      again: true,
    })
  })
})
