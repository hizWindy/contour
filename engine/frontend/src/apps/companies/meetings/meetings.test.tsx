/**
 * Meetings (PLAN-V17 T3-9, PLAN-V18 T2-3), against the contract and a fake server that keeps its
 * meetings between requests and answers as Track 1's does: in time order, each with its day group,
 * filtered by whose meetings (`who`), and with Sync's fields, in the generated types. The clock is
 * fixed at 9:00 am on Wednesday 18 Nov 2026, Melbourne time. Made-up names only: Sample Logistics
 * Pty Ltd, Jo Sample.
 */
import { QueryClient } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, useParams } from 'react-router'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  FormMeeting,
  FormSummary,
  Meeting,
  MeetingFormOut,
  MeetingFormState,
  MeetingItem,
  MeetingOwner,
  MeetingPage,
  MeetingsState,
  MeetingsSyncOut,
  MeetingWho,
  TeamState,
} from '@/api/types'
import { ApiProblem } from '@/api/client'
import { queryKeys } from '@/api/query'
import { problemHint } from '@/lib/problems'
import { routes } from '@/router'
import { prefetchPage } from '@/shell/prefetch'
import { signedIn, signInOff } from '@/test/fake-auth'
import { fakeIdle } from '@/test/fake-idle'
import { createTestQueryClient, renderWithProviders, startManualClock } from '@/test/render'
import MeetingsPage from './index'
import { meetingsQuery, readMeetings, writeMeetings, type MeetingsView } from './params'
import { otherViews } from './prefetch'
import { MeetingsToolbar, SEARCH_SETTLE_MS } from './toolbar'

const API = '/api/v1/companies'
const MEETINGS = `${API}/meetings`
const FORMS = `${MEETINGS}/forms`

/** 9:00 am on Wednesday 18 Nov 2026 in Melbourne (daylight saving, +11:00). */
const NOW = new Date('2026-11-17T22:00:00Z')

/** The signed-in rep's HubSpot owner, and a teammate's. */
const MINE = 'o-1'
const MIA = 'o-2'

/** When a read of HubSpot's meetings ends, by default: 9:00 am. */
const CHECKED_AT = '2026-11-17T22:00:00Z'

/**
 * Track 1's sentences while HubSpot's meetings can't be read (`meeting_store.py`), word for word:
 * no HubSpot key, and a missing permission. Each says what still works itself.
 */
const NOT_CONNECTED =
  "HubSpot isn't connected, so meetings can't be read from it. You can still start a new pre-read."
const WAITING_FOR_ACCESS =
  'Waiting for HubSpot access to meetings. An admin adds it in HubSpot. You can still start a new pre-read.'

type ItemChanges = Partial<Omit<MeetingItem, 'meeting'>> & { meeting?: Partial<Meeting> }

/** A meeting as HubSpot has it: 10:00 am today in Melbourne, on Teams, the rep's own. */
function meeting(id: string, { meeting: changes, ...rest }: ItemChanges = {}): MeetingItem {
  return {
    meeting: {
      more_companies: false,
      id,
      company_id: '101',
      contact_ids: [],
      owner_id: MINE,
      title: 'Office walk-through',
      starts_at: '2026-11-17T23:00:00Z',
      ends_at: '2026-11-18T00:00:00Z',
      where: 'online',
      location: null,
      outcome: 'scheduled',
      notes: null,
      hubspot_url: null,
      ...changes,
    },
    company_name: 'Sample Logistics Pty Ltd',
    group: 'today',
    form: null,
    notes_logged: false,
    typed: false,
    // The rep's own. The fake server sets it again from the owner on each list.
    mine: true,
    ...rest,
  }
}

function formState(
  id: string,
  status: MeetingFormState['status'],
  extra: Partial<MeetingFormState> = {},
): MeetingFormState {
  return { id, status, sent_at: null, sent_count: 0, sent_names: [], ...extra }
}

/** The days ahead: one meeting for each status, across the four groups. */
function upcoming(): MeetingItem[] {
  return [
    meeting('m1'),
    meeting('m2', {
      meeting: {
        company_id: '102',
        title: 'Lease options',
        starts_at: '2026-11-18T03:00:00Z',
        where: 'in_person',
      },
      company_name: 'Sample Mining Pty Ltd',
      form: formState('f2', 'drafting'),
    }),
    meeting('m3', {
      meeting: {
        company_id: '103',
        title: 'Fit-out budget',
        starts_at: '2026-11-19T00:00:00Z',
        // The client's own Zoom link: the row names Zoom, not Teams.
        location: 'https://us02web.zoom.us/j/81234567890',
      },
      company_name: 'Sample Freight Pty Ltd',
      group: 'tomorrow',
      form: formState('f3', 'draft'),
    }),
    meeting('m6', {
      meeting: {
        company_id: '106',
        title: 'First meeting',
        starts_at: '2026-11-19T02:00:00Z',
        outcome: 'canceled',
      },
      company_name: 'Sample Retail Pty Ltd',
      group: 'tomorrow',
    }),
    meeting('m4', {
      meeting: {
        company_id: '104',
        title: 'Workplace strategy',
        starts_at: '2026-11-19T22:30:00Z',
        where: 'unknown',
      },
      company_name: 'Sample Health Pty Ltd',
      group: 'this_week',
      form: formState('f4', 'sent'),
    }),
    meeting('m5', {
      meeting: {
        company_id: '105',
        title: 'Site visit',
        starts_at: '2026-11-24T04:00:00Z',
        where: 'in_person',
        owner_id: MIA,
      },
      company_name: 'Sample Energy Pty Ltd',
      group: 'later',
      form: formState('f5', 'failed'),
    }),
  ]
}

function past(): MeetingItem[] {
  return [
    meeting('p1', {
      meeting: { title: 'Intro meeting', starts_at: '2026-11-17T03:00:00Z' },
      group: null,
      notes_logged: true,
      form: formState('fp1', 'sent'),
    }),
    meeting('p2', {
      meeting: { company_id: '102', title: 'Lease review', starts_at: '2026-11-12T23:00:00Z' },
      company_name: 'Sample Mining Pty Ltd',
      group: null,
    }),
    meeting('p3', {
      meeting: {
        company_id: '106',
        title: 'Site tour',
        starts_at: '2026-11-10T03:00:00Z',
        outcome: 'canceled',
      },
      company_name: 'Sample Retail Pty Ltd',
      group: null,
    }),
  ]
}

const EMPTY_SUMMARY: FormSummary = { text: '', by: 'ai', sources: [] }

/** A form as POST /meetings/forms answers it: still drafting, with no facts yet. */
function form(id: string, changes: Partial<FormMeeting> = {}): MeetingFormOut {
  return {
    id,
    meeting: {
      meeting_id: 'm1',
      company_key: '101',
      company_name: 'Sample Logistics Pty Ltd',
      title: 'Office walk-through',
      starts_at: '2026-11-17T23:00:00Z',
      ends_at: '2026-11-18T00:00:00Z',
      where: 'online',
      ...changes,
    },
    status: 'drafting',
    facts: [],
    summaries: {
      what_they_do: EMPTY_SUMMARY,
      what_we_know: EMPTY_SUMMARY,
      talks_so_far: EMPTY_SUMMARY,
    },
    next_step: null,
    going: null,
    sent_to: [],
    sent_at: null,
    sent_by: null,
    hubspot_copy: null,
    cost_usd: '0',
    error: null,
  }
}

interface Sent {
  method: string
  path: string
  search: URLSearchParams
  body: unknown
  headers: Headers
}

interface Server {
  upcoming: MeetingItem[]
  past: MeetingItem[]
  /** Whether HubSpot's meetings are read. */
  meetingsState: MeetingsState
  /** The list's sentence while it can't show what was asked. */
  sentence: string | null
  /** The sentence My meetings and My team get while they can't be filled (never All's). */
  whoSentence: string | null
  /** Every meetings route answers 409 `meeting_forms_off`. */
  off: boolean
  /**
   * What POST /meetings/forms does: answer, refuse (409), refuse one field (422), or wait until
   * `release()`.
   */
  start: 'ok' | 'refuse' | 'invalid' | 'wait'
  release: () => void
  sent: Sent[]
  /** PLAN-V18: sign-in on (a rep signed in) or off (no "me"). */
  signIn: 'on' | 'off'
  /** The rep's account has a HubSpot owner. */
  linked: boolean
  teamState: TeamState
  /** When HubSpot's meetings were last read. */
  checkedAt: string | null
  /** A read of HubSpot's meetings is running. */
  syncing: boolean
  syncProblem: string | null
  /** What POST /meetings/sync answers: a state, or a whole response. */
  sync: MeetingsSyncOut['state'] | (() => Response)
  /** How many reads of the list still say `syncing` before the read of HubSpot ends. */
  syncReads: number
  /** What a read of HubSpot ends with: the new time, a problem, and any meeting it found. */
  syncEnd: { checkedAt: string; problem: string | null; adds: MeetingItem[] }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status })
}

function problem(status: number, title: string, detail: string, code: string): Response {
  return json({ title, detail, status, code }, status)
}

const OFF = (): Response =>
  problem(409, 'Meetings are off', 'An admin can switch them on.', 'meeting_forms_off')

const dayWords = new Intl.DateTimeFormat('en-AU', {
  timeZone: 'Australia/Melbourne',
  day: 'numeric',
  month: 'short',
})

/** As the server is to search (plain code): every word in the company, the title or the day. */
function matches(item: MeetingItem, q: string): boolean {
  const { title, starts_at } = item.meeting
  const text = `${item.company_name} ${title} ${dayWords.format(new Date(starts_at))}`.toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word))
}

/** The server's order: by time only, the soonest first, or the newest first for Past. */
function serverOrder(items: MeetingItem[], when: string): MeetingItem[] {
  const moment = (item: MeetingItem) => Date.parse(item.meeting.starts_at)
  return [...items].sort((a, b) =>
    when === 'past' ? moment(b) - moment(a) : moment(a) - moment(b),
  )
}

/** The rep's HubSpot team: the rep and Mia. */
const TEAM = new Set([MINE, MIA])

/** The owners our copy of HubSpot has a name for (the server offers only these). */
const OWNER_NAMES: Readonly<Record<string, string>> = { [MINE]: 'Jo Sample', [MIA]: 'Mia Sample' }

/** The people who own one of these meetings, by name, as the server's `owners` lists them. */
function ownersOf(items: readonly MeetingItem[]): MeetingOwner[] {
  const ids = new Set(items.map((item) => item.meeting.owner_id ?? ''))
  return Object.keys(OWNER_NAMES)
    .filter((id) => ids.has(id))
    .map((id) => ({ id, name: OWNER_NAMES[id] ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Whether a meeting is in a list of `who`'s, as the server decides (PLAN-V18 T1-4). */
function whose(item: MeetingItem, who: string, server: Server): boolean {
  if (item.typed || who === 'all') return true
  if (who === 'mine') return server.linked && item.meeting.owner_id === MINE
  return server.teamState === 'ready' && TEAM.has(item.meeting.owner_id ?? '')
}

function mockServer(changes: Partial<Omit<Server, 'sent' | 'release'>> = {}): Server {
  const server: Server = {
    upcoming: upcoming(),
    past: past(),
    meetingsState: 'ready',
    sentence: null,
    whoSentence: null,
    off: false,
    start: 'ok',
    release: () => undefined,
    sent: [],
    signIn: 'on',
    linked: true,
    teamState: 'ready',
    checkedAt: null,
    syncing: false,
    syncProblem: null,
    sync: 'started',
    syncReads: 0,
    syncEnd: { checkedAt: CHECKED_AT, problem: null, adds: [] },
    ...changes,
  }
  /** A read of the list while a read of HubSpot runs: it ends after `syncReads` reads. */
  const readWhileSyncing = (): void => {
    if (!server.syncing) return
    if (server.syncReads > 0) {
      server.syncReads -= 1
      return
    }
    server.syncing = false
    server.checkedAt = server.syncEnd.checkedAt
    server.syncProblem = server.syncEnd.problem
    server.upcoming = [...server.upcoming, ...server.syncEnd.adds]
  }
  const respond = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method
    const text = method === 'GET' ? '' : await request.clone().text()
    const body: unknown = text ? JSON.parse(text) : null
    server.sent.push({ method, path, search: url.searchParams, body, headers: request.headers })
    if (path === '/api/v1/auth/me') return server.signIn === 'on' ? signedIn() : signInOff()
    if (path.startsWith(MEETINGS) && server.off) return OFF()
    if (path === MEETINGS && method === 'GET') {
      readWhileSyncing()
      const when = url.searchParams.get('when') ?? 'upcoming'
      const who = url.searchParams.get('who') ?? 'all'
      const q = url.searchParams.get('q') ?? ''
      const limit = Number(url.searchParams.get('limit') ?? '50')
      const offset = Number(url.searchParams.get('offset') ?? '0')
      const owner = url.searchParams.get('owner')
      const inWindow = (when === 'past' ? server.past : server.upcoming).filter((item) =>
        whose(item, who, server),
      )
      // `owner` narrows to one person's (owned or been on); a typed one is the rep's own.
      const items = serverOrder(
        inWindow.filter(
          (item) =>
            (owner === null || (item.typed ? owner === MINE : item.meeting.owner_id === owner)) &&
            matches(item, q),
        ),
        when,
      )
      const page: MeetingPage = {
        items: items
          .slice(offset, offset + limit)
          .map((item) => ({ ...item, mine: item.meeting.owner_id === MINE })),
        total: items.length,
        meetings_state: server.meetingsState,
        sentence: who !== 'all' && server.whoSentence ? server.whoSentence : server.sentence,
        who: who as MeetingWho,
        linked: server.linked,
        team_state: server.teamState,
        team_names: server.teamState === 'ready' ? ['Sales'] : [],
        owners: ownersOf(inWindow),
        checked_at: server.checkedAt,
        syncing: server.syncing,
        sync_problem: server.syncProblem,
      }
      return json(page)
    }
    if (path === `${MEETINGS}/sync` && method === 'POST') {
      if (typeof server.sync === 'function') return server.sync()
      if (server.sync === 'started') server.syncing = true
      const answer: MeetingsSyncOut = { state: server.sync, checked_at: server.checkedAt }
      return json(answer, 202)
    }
    if (path === FORMS && method === 'POST') {
      if (server.start === 'refuse') return OFF()
      if (server.start === 'invalid') {
        return json(
          {
            title: "The meeting couldn't be saved",
            status: 422,
            errors: [{ field: 'body.starts_at', message: 'Pick a day within the next 90 days.' }],
          },
          422,
        )
      }
      if (server.start === 'wait') {
        await new Promise<void>((resolve) => {
          server.release = resolve
        })
      }
      const start = body as { meeting_id?: string; title?: string }
      const meetingId = start.meeting_id
      if (meetingId !== undefined) {
        const state: MeetingFormState = formState(`f-${meetingId}`, 'drafting')
        server.upcoming = server.upcoming.map((item) =>
          item.meeting.id === meetingId ? { ...item, form: state } : item,
        )
        return json(form(state.id, { meeting_id: meetingId }), 201)
      }
      return json(form('f-typed', { meeting_id: null, title: start.title ?? '' }), 201)
    }
    if (path === `${API}/search`) {
      return json({
        people: [],
        companies: [
          {
            key: '101',
            name: 'Sample Logistics Pty Ltd',
            city: 'Perth',
            industry: 'Logistics',
            source: 'hubspot',
          },
        ],
      })
    }
    return problem(404, 'Not found', 'Not here.', 'not_found')
  }
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request) => respond(request)),
  )
  return server
}

function lists(server: Server): URLSearchParams[] {
  return server.sent
    .filter((one) => one.method === 'GET' && one.path === MEETINGS)
    .map((one) => one.search)
}

function PreReadStub() {
  const { formId } = useParams()
  return <h1>{`Pre-read ${formId ?? ''}`}</h1>
}

function renderMeetings(path = '/assistant/meetings', state?: unknown) {
  const router = createMemoryRouter(
    [
      { path: '/assistant/meetings', element: <MeetingsPage /> },
      { path: '/assistant/meetings/:formId', element: <PreReadStub /> },
    ],
    { initialEntries: [state === undefined ? path : { pathname: path, state }] },
  )
  const result = renderWithProviders(<RouterProvider router={router} />, { withRouter: false })
  return { ...result, router }
}

/** The row of a meeting, found by its company. */
function row(company: string): HTMLElement {
  const found = screen.getByText(company).closest('li')
  if (!found) throw new Error(`No row for ${company}`)
  return found
}

function companies(list: HTMLElement): string[] {
  return within(list)
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.font-semibold')?.textContent ?? '')
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  // Sonner keeps toasts in one store for the whole file.
  toast.dismiss()
})

describe('Upcoming', () => {
  it("groups the meetings under the server's days, each with its time, where, one status and one button", async () => {
    mockServer({
      upcoming: upcoming().map((item) => ({
        ...item,
        meeting: { ...item.meeting, owner_id: MINE },
      })),
    })
    renderMeetings()
    const today = await screen.findByRole('list', { name: 'Today' })
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['Today', 'Tomorrow', 'This week', 'Later'])
    // In the server's order: the soonest first.
    expect(companies(today)).toEqual(['Sample Logistics Pty Ltd', 'Sample Mining Pty Ltd'])
    expect(companies(screen.getByRole('list', { name: 'Tomorrow' }))).toEqual([
      'Sample Freight Pty Ltd',
      'Sample Retail Pty Ltd',
    ])

    // No pre-read yet: Draft it.
    const logistics = within(row('Sample Logistics Pty Ltd'))
    expect(logistics.getByText('10:00 am')).toBeInTheDocument()
    expect(logistics.getByText('Office walk-through')).toBeInTheDocument()
    expect(logistics.getByText('Teams')).toBeInTheDocument()
    expect(logistics.getByText('Needs pre-read')).toBeInTheDocument()
    expect(
      logistics.getByRole('button', { name: 'Draft it: Sample Logistics Pty Ltd, 10:00 am' }),
    ).toBeEnabled()

    // Each other status opens the pre-read's own page.
    const opens: [string, string, string, string][] = [
      ['Sample Mining Pty Ltd', 'Drafting', 'Open: Sample Mining Pty Ltd, 2:00 pm', 'f2'],
      [
        'Sample Freight Pty Ltd',
        'Draft ready',
        'Check and send: Sample Freight Pty Ltd, 11:00 am',
        'f3',
      ],
      ['Sample Health Pty Ltd', 'Sent', 'Open: Sample Health Pty Ltd, Fri, 9:30 am', 'f4'],
      [
        'Sample Energy Pty Ltd',
        'Draft failed',
        'Open: Sample Energy Pty Ltd, Tue 24 Nov, 3:00 pm',
        'f5',
      ],
    ]
    for (const [company, status, link, id] of opens) {
      const one = within(row(company))
      expect(one.getByText(status)).toBeInTheDocument()
      expect(one.getByRole('link', { name: link })).toHaveAttribute(
        'href',
        `/assistant/meetings/${id}`,
      )
      expect(one.getAllByRole('link').length + one.queryAllByRole('button').length).toBe(1)
    }
    // Where it is: a word and an icon, never colour alone. Not known: nothing.
    expect(within(row('Sample Mining Pty Ltd')).getByText('In person')).toBeInTheDocument()
    expect(within(row('Sample Health Pty Ltd')).queryByText(/Teams|In person/)).toBeNull()
    // A video call is Teams, unless HubSpot's location names Zoom or Google Meet.
    expect(within(row('Sample Freight Pty Ltd')).getByText('Zoom')).toBeInTheDocument()
    expect(within(row('Sample Freight Pty Ltd')).queryByText('Teams')).toBeNull()
  })

  it('greys a cancelled meeting with the quieter text colour, says so, and offers no draft', async () => {
    mockServer()
    renderMeetings()
    await screen.findByRole('list', { name: 'Tomorrow' })
    const retail = row('Sample Retail Pty Ltd')
    expect(within(retail).getByText('Cancelled')).toBeInTheDocument()
    expect(within(retail).getByText('Sample Retail Pty Ltd')).toHaveClass('text-muted-foreground')
    expect(within(retail).getByText('First meeting')).toHaveClass('text-muted-foreground')
    // Readable: dimmed by colour, never by opacity.
    expect(retail.className).not.toMatch(/opacity/)
    expect(within(retail).queryByRole('button')).toBeNull()
    expect(within(retail).queryByRole('link')).toBeNull()
  })

  it('"Draft it" says Drafting at once, starts the form, then opens the pre-read', async () => {
    const server = mockServer({ start: 'wait' })
    const { user, router } = renderMeetings()
    await screen.findByRole('list', { name: 'Today' })
    await user.click(
      screen.getByRole('button', { name: 'Draft it: Sample Logistics Pty Ltd, 10:00 am' }),
    )
    // The row answers before the server does.
    const logistics = within(row('Sample Logistics Pty Ltd'))
    expect(await logistics.findByText('Drafting')).toBeInTheDocument()
    expect(logistics.getByRole('button', { name: /^Draft it/ })).toBeDisabled()
    await waitFor(() => {
      expect(server.sent.filter((one) => one.path === FORMS)).toHaveLength(1)
    })
    // The meeting, and its place (the server reads a HubSpot meeting's own).
    expect(server.sent.find((one) => one.path === FORMS)?.body).toEqual({
      meeting_id: 'm1',
      where: 'online',
    })

    server.release()
    expect(await screen.findByRole('heading', { name: 'Pre-read f-m1' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/assistant/meetings/f-m1')
  })

  it('a refused draft puts the row back and says why', async () => {
    mockServer({ start: 'refuse' })
    const { user, router } = renderMeetings()
    await screen.findByRole('list', { name: 'Today' })
    await user.click(
      screen.getByRole('button', { name: 'Draft it: Sample Logistics Pty Ltd, 10:00 am' }),
    )
    expect(await screen.findByText('Meetings are off')).toBeInTheDocument()
    const logistics = within(row('Sample Logistics Pty Ltd'))
    expect(logistics.getByText('Needs pre-read')).toBeInTheDocument()
    expect(logistics.getByRole('button', { name: /^Draft it/ })).toBeEnabled()
    expect(router.state.location.pathname).toBe('/assistant/meetings')
  })
})

describe('Past', () => {
  it('lists past meetings newest first, each saying whether its notes are logged', async () => {
    const server = mockServer()
    const { user, router } = renderMeetings()
    await screen.findByRole('list', { name: 'Today' })
    await user.click(screen.getByRole('radio', { name: 'Past' }))

    const list = await screen.findByRole('list', { name: 'Past meetings' })
    expect(router.state.location.search).toBe('?when=past')
    expect(lists(server).at(-1)?.get('when')).toBe('past')
    expect(companies(list)).toEqual([
      'Sample Logistics Pty Ltd',
      'Sample Mining Pty Ltd',
      'Sample Retail Pty Ltd',
    ])
    expect(within(row('Sample Logistics Pty Ltd')).getByText('Notes logged')).toBeInTheDocument()
    expect(
      within(row('Sample Logistics Pty Ltd')).getByText('Yesterday, 2:00 pm'),
    ).toBeInTheDocument()
    expect(within(row('Sample Mining Pty Ltd')).getByText('No notes yet')).toBeInTheDocument()
    expect(
      within(row('Sample Mining Pty Ltd')).getByText('Fri 13 Nov, 10:00 am'),
    ).toBeInTheDocument()
    expect(within(row('Sample Retail Pty Ltd')).getByText('Cancelled')).toBeInTheDocument()
    // Call notes aren't on here (the server has no switches to give): no "Log meeting" (T3-11).
    expect(within(list).queryAllByRole('button')).toEqual([])
    expect(within(list).queryAllByRole('link')).toEqual([])
  })
})

describe('the search', () => {
  it('waits 250ms after the last key, then sends the words once', async () => {
    // Exact edges need a clock that moves only when told (render.tsx).
    vi.useRealTimers()
    startManualClock()
    const onChange = vi.fn()
    const { user } = renderWithProviders(
      <MeetingsToolbar view={readMeetings(new URLSearchParams())} onChange={onChange} who={null} />,
    )
    await user.type(
      screen.getByRole('searchbox', { name: 'Find a meeting by company, title or date' }),
      'vitera 26 nov',
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEARCH_SETTLE_MS - 1)
    })
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(onChange.mock.calls).toEqual([[{ q: 'vitera 26 nov' }]])
  })

  it('asks the server with the words, and keeps them in the address', async () => {
    const server = mockServer()
    const { user, router } = renderMeetings()
    await screen.findByRole('list', { name: 'Today' })
    await user.type(
      screen.getByRole('searchbox', { name: 'Find a meeting by company, title or date' }),
      'freight 19 nov',
    )
    await waitFor(() => {
      expect(router.state.location.search).toBe('?q=freight+19+nov')
    })
    await waitFor(() => {
      expect(screen.queryByText('Sample Logistics Pty Ltd')).toBeNull()
    })
    expect(lists(server).at(-1)?.get('q')).toBe('freight 19 nov')
    expect(companies(screen.getByRole('list', { name: 'Tomorrow' }))).toEqual([
      'Sample Freight Pty Ltd',
    ])
  })

  it('says when nothing matches, and where else to look', async () => {
    mockServer()
    renderMeetings('/assistant/meetings?q=vitera+26+nov')
    expect(
      await screen.findByRole('heading', { name: 'No meeting matches "vitera 26 nov".' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Meetings that are over are under Past\./)).toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toHaveValue('vitera 26 nov')
  })
})

describe('whose meetings', () => {
  it("opens on All: everyone's meetings in time order, the rep's own marked You, the rest named", async () => {
    const server = mockServer({
      upcoming: upcoming().map((item) => ({
        ...item,
        owner_name: item.meeting.owner_id === MIA ? 'Mia Sample' : 'Jo Sample',
      })),
    })
    renderMeetings()
    await screen.findByRole('list', { name: 'Today' })
    expect(lists(server).at(-1)?.get('who')).toBe('all')
    expect(lists(server).at(-1)?.has('mine')).toBe(false)
    const choice = screen.getByRole('radiogroup', { name: 'Whose meetings' })
    expect(within(choice).getByRole('radio', { name: 'All' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(
      within(choice)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['All', 'My meetings', 'My team'])
    // Mia's meeting is there, with her name; the rep's own say "You", never their own name.
    const energy = within(row('Sample Energy Pty Ltd'))
    expect(energy.getByText('Mia Sample').closest('[data-slot=meeting-owner]')).toHaveTextContent(
      'Whose meeting: Mia Sample',
    )
    const mark = row('Sample Logistics Pty Ltd').querySelector('[data-slot=meeting-owner]')
    expect(mark).toHaveTextContent('Whose meeting: You')
    expect(mark).toHaveAttribute('data-you', 'true')
    expect(screen.queryByText('Jo Sample')).toBeNull()
  })

  it('My meetings and My team go in the address and to the server, and All takes them out', async () => {
    const server = mockServer()
    const { user, router } = renderMeetings()
    await screen.findByText('Sample Energy Pty Ltd')

    await user.click(screen.getByRole('radio', { name: 'My meetings' }))
    await waitFor(() => {
      expect(screen.queryByText('Sample Energy Pty Ltd')).toBeNull()
    })
    expect(router.state.location.search).toBe('?who=mine')
    expect(lists(server).at(-1)?.get('who')).toBe('mine')
    await screen.findByText('Sample Logistics Pty Ltd')
    // All the rep's own: no row says whose it is.
    expect(document.querySelector('[data-slot=meeting-owner]')).toBeNull()

    await user.click(screen.getByRole('radio', { name: 'My team' }))
    expect(await screen.findByText('Sample Energy Pty Ltd')).toBeInTheDocument()
    expect(router.state.location.search).toBe('?who=team')
    expect(lists(server).at(-1)?.get('who')).toBe('team')

    await user.click(screen.getByRole('radio', { name: 'All' }))
    await waitFor(() => {
      expect(router.state.location.search).toBe('')
    })
    expect(lists(server).at(-1)?.get('who')).toBe('all')
  })

  it("opens All from an old link to the team's meetings", async () => {
    const server = mockServer()
    renderMeetings('/assistant/meetings?team=1')
    expect(await screen.findByText('Sample Energy Pty Ltd')).toBeInTheDocument()
    expect(lists(server).at(-1)?.get('who')).toBe('all')
    expect(screen.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true')
  })

  it('leaves out My team when HubSpot has no teams', async () => {
    mockServer({ teamState: 'none_in_hubspot' })
    renderMeetings()
    await screen.findByRole('list', { name: 'Today' })
    const choice = await screen.findByRole('radiogroup', { name: 'Whose meetings' })
    expect(
      within(choice)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['All', 'My meetings'])
  })

  it("leaves the choice out while sign-in is off, and asks for everyone's", async () => {
    const server = mockServer({ signIn: 'off' })
    renderMeetings('/assistant/meetings?who=mine')
    expect(await screen.findByText('Sample Energy Pty Ltd')).toBeInTheDocument()
    expect(lists(server).at(-1)?.get('who')).toBe('all')
    expect(screen.queryByRole('radiogroup', { name: 'Whose meetings' })).toBeNull()
    // The rest of the toolbar is there.
    expect(
      screen.getByRole('radiogroup', { name: 'Upcoming or past meetings' }),
    ).toBeInTheDocument()
  })

  it("says why My meetings is empty while the rep's account isn't linked, with Show all meetings", async () => {
    const notLinked =
      "Your account isn't linked to a HubSpot owner yet, so My meetings is empty. All shows everyone's. An admin can link you in Admin, People."
    mockServer({ linked: false, teamState: 'not_linked', whoSentence: notLinked })
    const { user, router } = renderMeetings('/assistant/meetings?who=mine')
    expect(
      await screen.findByRole('heading', { name: 'No meetings of your own to show yet.' }),
    ).toHaveClass('font-serif')
    expect(screen.getByText(notLinked)).toBeInTheDocument()
    // Not the waiting line: HubSpot's meetings are read.
    expect(document.querySelector('[data-slot=waiting-line]')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show all meetings' }))
    expect(await screen.findByText('Sample Energy Pty Ltd')).toBeInTheDocument()
    expect(router.state.location.search).toBe('')
    // All never says it.
    expect(screen.queryByText(notLinked)).toBeNull()
  })

  it("says why My team is empty while the rep is in no HubSpot team, in the server's words", async () => {
    const noTeam = "You aren't in a HubSpot team yet, so My team is empty. All shows everyone's."
    mockServer({ teamState: 'no_team', whoSentence: noTeam })
    renderMeetings('/assistant/meetings?who=team')
    expect(
      await screen.findByRole('heading', { name: 'No team meetings to show yet.' }),
    ).toBeInTheDocument()
    expect(screen.getByText(noTeam)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show all meetings' })).toBeInTheDocument()
  })

  it('says why in its own words when the server sends none', async () => {
    mockServer({ teamState: 'no_team' })
    renderMeetings('/assistant/meetings?who=team')
    expect(
      await screen.findByText(
        "You aren't in a HubSpot team yet, so My team is empty. All shows everyone's.",
      ),
    ).toBeInTheDocument()
  })
})

describe('the Owner filter (Improvements 1, #5)', () => {
  it("offers the people who own a meeting, and shows one person's, in the address and to the server", async () => {
    const server = mockServer()
    const { user, router } = renderMeetings()
    await screen.findByText('Sample Energy Pty Ltd')
    const owner = screen.getByRole('combobox', { name: 'Owner' })
    expect(owner).toHaveTextContent('Owner: Anyone')
    await user.click(owner)
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'Anyone',
      'Jo Sample',
      'Mia Sample',
    ])
    await user.click(screen.getByRole('option', { name: 'Mia Sample' }))
    // Mia owns the one meeting at Sample Energy: the rest of the list goes.
    await waitFor(() => {
      expect(screen.queryByText('Sample Logistics Pty Ltd')).toBeNull()
    })
    expect(screen.getByText('Sample Energy Pty Ltd')).toBeInTheDocument()
    expect(router.state.location.search).toBe(`?owner=${MIA}`)
    expect(lists(server).at(-1)?.get('owner')).toBe(MIA)
    expect(screen.getByRole('combobox', { name: 'Owner' })).toHaveTextContent('Owner: Mia Sample')

    // The choices stay, so another person is one pick away, and Anyone takes it out again.
    await user.click(screen.getByRole('combobox', { name: 'Owner' }))
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'Anyone',
      'Jo Sample',
      'Mia Sample',
    ])
    await user.click(screen.getByRole('option', { name: 'Anyone' }))
    await waitFor(() => {
      expect(router.state.location.search).toBe('')
    })
    expect(lists(server).at(-1)?.has('owner')).toBe(false)
    expect(await screen.findByText('Sample Logistics Pty Ltd')).toBeInTheDocument()
  })

  it('is there with sign-in off, where My meetings cannot know who "my" is', async () => {
    const server = mockServer({ signIn: 'off' })
    renderMeetings()
    await screen.findByText('Sample Energy Pty Ltd')
    // No Whose choice (there is no "me"), but the Owner choice is.
    expect(screen.queryByRole('radiogroup', { name: 'Whose meetings' })).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Owner' })).toBeInTheDocument()
    expect(lists(server).at(-1)?.get('who')).toBe('all')
  })

  it('sits beside the three choices when signed in, and narrows whichever is picked', async () => {
    const server = mockServer()
    const { user } = renderMeetings('/assistant/meetings?who=team')
    await screen.findByText('Sample Energy Pty Ltd')
    expect(screen.getByRole('radiogroup', { name: 'Whose meetings' })).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Owner' }))
    await user.click(await screen.findByRole('option', { name: 'Jo Sample' }))
    await waitFor(() => {
      expect(lists(server).at(-1)?.get('owner')).toBe(MINE)
    })
    // Both go to the server: the team's meetings, narrowed to the ones Jo owns.
    expect(lists(server).at(-1)?.get('who')).toBe('team')
    await waitFor(() => {
      expect(screen.queryByText('Sample Energy Pty Ltd')).toBeNull()
    })
  })

  it('keeps a person from a link, and says whose when they have none, with Show all meetings', async () => {
    const server = mockServer()
    const { user, router } = renderMeetings('/assistant/meetings?owner=o-9')
    expect(
      await screen.findByRole('heading', { name: 'No meetings for This person this week.' }),
    ).toBeInTheDocument()
    // The list no longer offers that person: the choice still says something.
    expect(screen.getByRole('combobox', { name: 'Owner' })).toHaveTextContent('Owner: This person')
    expect(lists(server).at(-1)?.get('owner')).toBe('o-9')
    await user.click(screen.getByRole('button', { name: 'Show all meetings' }))
    await waitFor(() => {
      expect(router.state.location.search).toBe('')
    })
    expect(await screen.findByText('Sample Energy Pty Ltd')).toBeInTheDocument()
  })

  it('says whose, by name, when a person has no past meetings', async () => {
    mockServer({ past: [] })
    renderMeetings('/assistant/meetings?when=past&owner=o-2')
    // No past meetings at all: the server offers nobody, so the name is not known.
    expect(
      await screen.findByRole('heading', { name: 'No past meetings for This person.' }),
    ).toBeInTheDocument()
  })

  it('reads and writes the address: a stray id means Anyone, and a change goes back to page 1', () => {
    expect(readMeetings(new URLSearchParams('owner=o-2')).owner).toBe('o-2')
    expect(readMeetings(new URLSearchParams('owner=a%20b')).owner).toBeNull()
    expect(readMeetings(new URLSearchParams('owner=')).owner).toBeNull()
    expect(readMeetings(new URLSearchParams('owner=' + 'x'.repeat(33))).owner).toBeNull()
    expect(
      writeMeetings(new URLSearchParams('when=past&page=3'), { owner: 'o-2' }).toString(),
    ).toBe('when=past&owner=o-2')
    expect(
      writeMeetings(new URLSearchParams('owner=o-2&q=lease'), { owner: null }).toString(),
    ).toBe('q=lease')
    expect(meetingsQuery(readMeetings(new URLSearchParams('owner=o-2')))).toMatchObject({
      when: 'upcoming',
      who: 'all',
      owner: 'o-2',
    })
    expect(meetingsQuery(readMeetings(new URLSearchParams()))).not.toHaveProperty('owner')
  })
})

describe('Sync', () => {
  /** The Sync button, by the words it shows now. */
  function syncButton(name: string | RegExp = /^(Sync|Checking HubSpot|Up to date)$/) {
    return screen.getByRole('button', { name })
  }

  function syncLine(): HTMLElement {
    const line = document.querySelector<HTMLElement>('[data-slot=sync-line]')
    if (!line) throw new Error('No sync line')
    return line
  }

  function syncs(server: Server): number {
    return server.sent.filter((one) => one.path === `${MEETINGS}/sync`).length
  }

  it('sits at the right end, and says when meetings were last read', async () => {
    mockServer({ checkedAt: '2026-11-17T21:14:00Z' })
    renderMeetings()
    await screen.findByRole('list', { name: 'Today' })
    const toolbar = document.querySelector('[data-slot=meetings-toolbar]')
    const button = syncButton('Sync')
    expect(toolbar?.lastElementChild).toBe(button.closest('[data-slot=meetings-sync]'))
    expect(button).toHaveAccessibleDescription("Reads HubSpot's meetings now.")
    expect(button.querySelector('[data-slot=spin-once] svg')).not.toBeNull()
    expect(syncLine()).toHaveTextContent('Checked 8:14 am')
    expect(syncLine()).toHaveAttribute('role', 'status')
  })

  it('keeps the line, empty, while the time is not known', async () => {
    mockServer({ checkedAt: null })
    renderMeetings()
    await screen.findByRole('list', { name: 'Today' })
    expect(syncLine()).toHaveTextContent('')
    expect(syncLine()).toHaveClass('min-h-5')
  })

  it('started: says Checking HubSpot, asks every 2 seconds until done, then Up to date and the new time', async () => {
    // This test waits longer than the quiet warm-up of the other views does (3 seconds without an
    // idle call), and counts the page's own reads, so the browser here is never idle.
    fakeIdle()
    const found = meeting('m9', {
      meeting: { company_id: '109', title: 'Fit-out walk', starts_at: '2026-11-18T05:00:00Z' },
      company_name: 'Sample Ports Pty Ltd',
    })
    const server = mockServer({
      checkedAt: '2026-11-17T21:14:00Z',
      syncReads: 1,
      syncEnd: { checkedAt: '2026-11-17T22:00:00Z', problem: null, adds: [found] },
    })
    const { user } = renderMeetings()
    await screen.findByRole('list', { name: 'Today' })
    expect(lists(server)).toHaveLength(1)
    await user.click(syncButton('Sync'))
    expect(await screen.findByRole('button', { name: 'Checking HubSpot' })).toBeInTheDocument()
    expect(syncs(server)).toBe(1)
    // The icon turned once: it is held, not looping.
    expect(syncButton('Checking HubSpot').querySelector('[data-slot=spin-once]')).not.toBeNull()
    // The list asks again at once, and the server is still reading.
    await waitFor(() => {
      expect(lists(server)).toHaveLength(2)
    })
    expect(syncButton('Checking HubSpot')).toBeInTheDocument()
    // 2 seconds later it asks again, and the read is done.
    expect(
      await screen.findByRole('button', { name: 'Up to date' }, { timeout: 4000 }),
    ).toBeInTheDocument()
    expect(lists(server)).toHaveLength(3)
    expect(syncLine()).toHaveTextContent('Checked 9:00 am')
    // The meeting the read found is on the list.
    expect(await screen.findByText('Sample Ports Pty Ltd')).toBeInTheDocument()
    // Done: the asking stops.
    const afterDone = lists(server).length
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2300))
    })
    expect(lists(server).length).toBe(afterDone)
  }, 10_000)

  it('running: says HubSpot is being checked already, and how long it takes', async () => {
    const server = mockServer({ syncing: true, syncReads: 5, sync: 'running' })
    const { user } = renderMeetings()
    await screen.findByRole('list', { name: 'Today' })
    // A read someone else started shows too.
    expect(syncButton('Checking HubSpot')).toBeInTheDocument()
    await user.click(syncButton('Checking HubSpot'))
    expect(
      await screen.findByText('Already checking HubSpot. It takes about 15 seconds.'),
    ).toBeInTheDocument()
    expect(syncs(server)).toBe(1)
  })

  it("fresh: Up to date, checked a moment ago, and HubSpot isn't asked again", async () => {
    mockServer({ checkedAt: '2026-11-17T21:59:30Z', sync: 'fresh' })
    const { user } = renderMeetings()
    await screen.findByRole('list', { name: 'Today' })
    await user.click(syncButton('Sync'))
    expect(await screen.findByRole('button', { name: 'Up to date' })).toBeInTheDocument()
    expect(syncLine()).toHaveTextContent('Up to date. Checked a moment ago.')
    expect(syncLine()).not.toHaveAttribute('data-problem')
  })

  it("a failed read: the server's sentence with an Ochre mark, and the list as it was", async () => {
    const failed =
      "HubSpot didn't answer, so this list is from 9:02 am. Try Sync again in a minute."
    mockServer({
      checkedAt: '2026-11-17T22:02:00Z',
      syncEnd: { checkedAt: '2026-11-17T22:02:00Z', problem: failed, adds: [] },
    })
    const { user } = renderMeetings()
    await screen.findByRole('list', { name: 'Today' })
    await user.click(syncButton('Sync'))
    expect(await within(syncLine()).findByText(failed)).toBeInTheDocument()
    expect(syncLine()).toHaveAttribute('data-problem', 'true')
    expect(syncLine().querySelector('svg.lucide-triangle-alert')).toHaveAttribute(
      'aria-hidden',
      'true',
    )
    // Not "Up to date": it didn't read.
    expect(syncButton('Sync')).toBeInTheDocument()
    expect(screen.getByText('Sample Logistics Pty Ltd')).toBeInTheDocument()
  })

  it("a press that doesn't reach HubSpot says why, in plain words, and the next step once", async () => {
    // Track 1's 503 (`meeting_store.py`), word for word: its detail ends with the next step.
    const detail =
      "HubSpot isn't connected, so meetings can't be read from it. An admin can connect it on the HubSpot page in Admin."
    mockServer({
      sync: () => problem(503, "HubSpot isn't connected", detail, 'hubspot_not_connected'),
    })
    const { user } = renderMeetings()
    await screen.findByRole('list', { name: 'Today' })
    await user.click(syncButton('Sync'))
    // The detail starts with the title, so it is said alone, with no hint after it.
    expect(await within(syncLine()).findByText(detail)).toBeInTheDocument()
    expect(syncButton('Sync')).toBeInTheDocument()
  })

  it("is greyed while HubSpot isn't connected, which the waiting line says", async () => {
    mockServer({ meetingsState: 'off', sentence: NOT_CONNECTED })
    renderMeetings()
    expect(await screen.findByText(NOT_CONNECTED)).toBeInTheDocument()
    await waitFor(() => {
      expect(syncButton('Sync')).toBeDisabled()
    })
  })
})

describe('the states', () => {
  it('empty: says "No meetings this week." in the serif voice, and Past its own words', async () => {
    mockServer({ upcoming: [], past: [] })
    const { user } = renderMeetings()
    const empty = await screen.findByRole('heading', { name: 'No meetings this week.' })
    expect(empty).toHaveClass('font-serif')
    expect(screen.getByText(/start a new pre-read/)).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Past' }))
    expect(await screen.findByRole('heading', { name: 'No past meetings yet.' })).toHaveClass(
      'font-serif',
    )
  })

  it("waiting: one quiet line in the server's words, and New pre-read still works", async () => {
    mockServer({ meetingsState: 'waiting', sentence: WAITING_FOR_ACCESS, upcoming: [], past: [] })
    const { user } = renderMeetings()
    const line = await screen.findByText(WAITING_FOR_ACCESS)
    expect(line).toHaveAttribute('role', 'status')
    expect(line).toHaveClass('text-muted-foreground')
    // Not "No meetings this week.": the list can't know that yet.
    expect(
      await screen.findByRole('heading', { name: 'No meetings from HubSpot yet.' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('No meetings this week.')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'New pre-read' }))
    expect(await screen.findByRole('dialog', { name: 'New pre-read' })).toBeInTheDocument()
  })

  it('HubSpot not connected (off, forms on): the same quiet line, and the typed rows it has', async () => {
    // A meeting typed in with New pre-read is still on the list, with a Lead Finder lead's key.
    const typed = meeting('', {
      meeting: { company_id: 'lead:7', owner_id: null, title: 'Office walk-through' },
      typed: true,
      form: formState('f-typed', 'draft'),
    })
    // Track 1's sentence when no key is set and nothing was read yet.
    mockServer({ meetingsState: 'off', sentence: NOT_CONNECTED, upcoming: [typed] })
    const { user } = renderMeetings()
    const line = await screen.findByText(NOT_CONNECTED)
    expect(line).toHaveAttribute('role', 'status')
    // Not the switch-off page: the controls and the rows are there.
    expect(screen.queryByText('Pre-meeting forms are switched off.')).toBeNull()
    expect(
      screen.getByRole('radiogroup', { name: 'Upcoming or past meetings' }),
    ).toBeInTheDocument()
    const today = await screen.findByRole('list', { name: 'Today' })
    expect(companies(today)).toEqual(['Sample Logistics Pty Ltd'])
    expect(
      within(row('Sample Logistics Pty Ltd')).getByRole('link', { name: /^Check and send/ }),
    ).toHaveAttribute('href', '/assistant/meetings/f-typed')
    await user.click(screen.getByRole('button', { name: 'New pre-read' }))
    expect(await screen.findByRole('dialog', { name: 'New pre-read' })).toBeInTheDocument()
  })

  it('off: the list answers 409, and the page says pre-meeting forms are switched off', async () => {
    const server = mockServer({ off: true })
    renderMeetings()
    expect(
      await screen.findByRole('heading', { name: 'Pre-meeting forms are switched off.' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Ask an admin to switch them on/)).toBeInTheDocument()
    // Nothing to press, and no list asked for beyond the one that said so.
    expect(screen.queryByRole('button', { name: 'New pre-read' })).toBeNull()
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(lists(server)).toHaveLength(1)
  })

  it('an error: the error box, in plain words, with Try again', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(json({ title: 'Something went wrong on our side', status: 500 }, 500)),
      ),
    )
    renderMeetings()
    expect(await screen.findByText("Your meetings couldn't be loaded.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('the prefetch asks for the list in the address, as the page does', async () => {
    const server = mockServer()
    const client = createTestQueryClient()
    client.setQueryData(queryKeys.auth.me(), { state: 'off' })
    prefetchPage(routes, { pathname: '/assistant/meetings', search: '?when=past&who=team' }, client)
    // The prefetch loads its own small file first.
    await waitFor(() => {
      expect(server.sent).toHaveLength(1)
    })
    expect(server.sent.map((one) => `${one.path}?${one.search.toString()}`)).toEqual([
      `${MEETINGS}?when=past&who=team&limit=25&offset=0`,
    ])
  })
})

describe('warming the next views (Improvements 1, #10)', () => {
  /** The lists asked for so far, as "when/who" and "+owner" when an owner narrows it. */
  const views = (server: Server): string[] =>
    lists(server).map(
      (search) =>
        `${search.get('when') ?? ''}/${search.get('who') ?? ''}${search.has('owner') ? `+${search.get('owner') ?? ''}` : ''}`,
    )

  /** A cache that keeps an answer fresh for 15 seconds, as the app's does. */
  function appCache(): QueryClient {
    return new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 15_000 } },
    })
  }

  /** The first list is in, and the browser has an idle moment. */
  async function afterIdle(browser: ReturnType<typeof fakeIdle>): Promise<void> {
    await screen.findByRole('list', { name: 'Today' })
    await waitFor(() => {
      expect(browser.waiting()).toBeGreaterThan(0)
    })
    browser.idle()
  }

  it('asks for Past and the other choices of whose, once the list is in and the browser is idle', async () => {
    const browser = fakeIdle()
    const server = mockServer()
    renderMeetings()
    await screen.findByRole('list', { name: 'Today' })
    // While the browser is busy, only the list on screen is asked for.
    expect(views(server)).toEqual(['upcoming/all'])

    await afterIdle(browser)
    await waitFor(() => {
      expect([...views(server)].sort()).toEqual([
        'past/all',
        'upcoming/all',
        'upcoming/mine',
        'upcoming/team',
      ])
    })
  })

  it('opens Past and My meetings at once from the cache, and asks the server nothing more', async () => {
    const browser = fakeIdle()
    const server = mockServer()
    const queryClient = appCache()
    const { user } = renderWithProviders(
      <RouterProvider
        router={createMemoryRouter([{ path: '/assistant/meetings', element: <MeetingsPage /> }], {
          initialEntries: ['/assistant/meetings'],
        })}
      />,
      { withRouter: false, queryClient },
    )
    await afterIdle(browser)
    await waitFor(() => {
      expect(views(server)).toHaveLength(4)
      expect(queryClient.isFetching()).toBe(0)
    })

    await user.click(screen.getByRole('radio', { name: 'Past' }))
    // The list is there as the click ends, not grey blocks first.
    expect(screen.getByRole('list', { name: 'Past meetings' })).toBeInTheDocument()
    expect(document.querySelector('[data-slot=pending]')).toBeNull()
    await user.click(screen.getByRole('radio', { name: 'Upcoming' }))
    expect(screen.getByRole('list', { name: 'Today' })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'My meetings' }))
    expect(screen.getByText('Sample Logistics Pty Ltd')).toBeInTheDocument()
    expect(views(server)).toHaveLength(4)
  })

  it('leaves out My team when HubSpot has no teams, and Whose when sign-in is off', async () => {
    const browser = fakeIdle()
    const noTeams = mockServer({ teamState: 'none_in_hubspot' })
    const first = renderMeetings()
    await afterIdle(browser)
    await waitFor(() => {
      expect([...views(noTeams)].sort()).toEqual(['past/all', 'upcoming/all', 'upcoming/mine'])
    })
    first.unmount()

    const signInOffServer = mockServer({ signIn: 'off' })
    renderMeetings()
    await afterIdle(browser)
    await waitFor(() => {
      expect([...views(signInOffServer)].sort()).toEqual(['past/all', 'upcoming/all'])
    })
  })

  it('keeps the owner, and asks for no more of the owners', async () => {
    const browser = fakeIdle()
    const server = mockServer()
    renderMeetings(`/assistant/meetings?owner=${MINE}`)
    await afterIdle(browser)
    await waitFor(() => {
      expect([...views(server)].sort()).toEqual([
        `past/all+${MINE}`,
        `upcoming/all+${MINE}`,
        `upcoming/mine+${MINE}`,
        `upcoming/team+${MINE}`,
      ])
    })
  })

  it('asks for nothing more while a search is typed in the address', async () => {
    const browser = fakeIdle()
    const server = mockServer()
    renderMeetings('/assistant/meetings?q=logistics')
    await screen.findByRole('list', { name: 'Today' })
    expect(browser.waiting()).toBe(0)
    expect(views(server)).toEqual(['upcoming/all'])
  })

  it('is stopped by leaving the page', async () => {
    const browser = fakeIdle()
    const server = mockServer()
    const { unmount } = renderMeetings()
    await screen.findByRole('list', { name: 'Today' })
    await waitFor(() => {
      expect(browser.waiting()).toBeGreaterThan(0)
    })
    unmount()
    browser.idle()
    expect(views(server)).toEqual(['upcoming/all'])
  })

  it('names the views a click opens: the other of Upcoming and Past, and each other choice of whose', () => {
    const view: MeetingsView = { when: 'past', who: 'mine', owner: 'o-9', q: '', page: 3 }
    expect(otherViews(view, ['all', 'mine', 'team'])).toEqual([
      { when: 'upcoming', who: 'mine', owner: 'o-9', q: '', page: 0 },
      { when: 'past', who: 'all', owner: 'o-9', q: '', page: 0 },
      { when: 'past', who: 'team', owner: 'o-9', q: '', page: 0 },
    ])
    expect(otherViews({ ...view, when: 'upcoming', who: 'all' }, [])).toEqual([
      { when: 'past', who: 'all', owner: 'o-9', q: '', page: 0 },
    ])
  })
})

describe('words for when things go wrong (PLAN-V18 T2-7)', () => {
  // Each row of the plan's table for Meetings, with its button. The draft's two rows are in the
  // pre-read's tests, and "Email isn't set up" in the send dialog's.

  it("HubSpot's meetings aren't read yet: one quiet line, and New pre-read still works", async () => {
    mockServer({ meetingsState: 'waiting', sentence: null, upcoming: [], past: [] })
    renderMeetings()
    expect(
      await screen.findByText(
        "Meetings can't be read from HubSpot yet. You can still start a new pre-read.",
      ),
    ).toHaveAttribute('role', 'status')
    expect(screen.getByRole('button', { name: 'New pre-read' })).toBeEnabled()
  })

  it("no permission to read meetings: the server's words once, with what still works", async () => {
    // Nothing read yet: the server says it as the list's sentence and as the read's problem.
    mockServer({
      meetingsState: 'waiting',
      sentence: WAITING_FOR_ACCESS,
      syncProblem: WAITING_FOR_ACCESS,
      upcoming: [],
    })
    renderMeetings()
    expect(await screen.findByText(WAITING_FOR_ACCESS)).toHaveAttribute('data-slot', 'waiting-line')
    // Said once: the line under the toolbar doesn't say it again.
    expect(screen.getAllByText(/You can still start a new pre-read\./)).toHaveLength(1)
    expect(document.querySelector('[data-slot=sync-line]')).toHaveTextContent('')
    expect(screen.getByRole('button', { name: 'New pre-read' })).toBeEnabled()
  })

  it("HubSpot didn't answer a Sync: when the list is from, and Sync to press again", async () => {
    const words = "HubSpot didn't answer, so this list is from 9:02 am. Try Sync again in a minute."
    mockServer({ syncProblem: words, checkedAt: '2026-11-17T22:02:00Z' })
    renderMeetings()
    expect(await screen.findByText(words)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sync' })).toBeEnabled()
  })

  it('a Sync already running: says HubSpot is being checked, and how long it takes', async () => {
    mockServer({ sync: 'running', syncing: true, syncReads: 5 })
    const { user } = renderMeetings()
    await screen.findByRole('list', { name: 'Today' })
    await user.click(screen.getByRole('button', { name: 'Checking HubSpot' }))
    expect(
      await screen.findByText('Already checking HubSpot. It takes about 15 seconds.'),
    ).toBeInTheDocument()
  })

  it('synced a moment ago: up to date, and HubSpot is not asked', async () => {
    mockServer({ sync: 'fresh', checkedAt: '2026-11-17T21:59:30Z' })
    const { user } = renderMeetings()
    await screen.findByRole('list', { name: 'Today' })
    await user.click(screen.getByRole('button', { name: 'Sync' }))
    expect(await screen.findByText('Up to date. Checked a moment ago.')).toBeInTheDocument()
  })

  it("My meetings while the account isn't linked, and My team in no team: why, and Show all meetings", async () => {
    const notLinked =
      "Your account isn't linked to a HubSpot owner yet, so My meetings is empty. All shows everyone's. An admin can link you in Admin, People."
    mockServer({ linked: false, teamState: 'no_team', whoSentence: null })
    const { user } = renderMeetings('/assistant/meetings?who=mine')
    expect(await screen.findByText(notLinked)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show all meetings' })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'My team' }))
    expect(
      await screen.findByText(
        "You aren't in a HubSpot team yet, so My team is empty. All shows everyone's.",
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show all meetings' })).toBeInTheDocument()
  })

  it('no connection: a quiet line that points at the connection bar, never a red box', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    renderMeetings()
    const quiet = await screen.findByText('The bar at the top shows when the connection is back.')
    expect(quiet.closest('[data-slot=error-state]')).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it("adds no hint to the meetings codes: the server's words end with the next step", () => {
    // Track 1 (T1-8) ends every detail with what to do, so a hint would say it twice.
    const hint = (code: string) => problemHint(new ApiProblem({ title: 'x', status: 409, code }))
    for (const code of [
      'hubspot_not_connected',
      'meeting_not_found',
      'form_not_found',
      'email_not_set_up',
      'form_sending',
      'no_one',
    ]) {
      expect(hint(code)).toBeNull()
    }
  })
})

describe('AI drafts the pre-read', () => {
  it('New pre-read says so above its buttons: from what, how long, the check, and the cost', async () => {
    mockServer()
    const { user } = renderMeetings()
    await screen.findByRole('list', { name: 'Today' })
    await user.click(screen.getByRole('button', { name: 'New pre-read' }))
    const dialog = await screen.findByRole('dialog', { name: 'New pre-read' })
    const note = dialog.querySelector('[data-slot=ai-note]')
    expect(note).toHaveTextContent(
      'AI drafts this pre-read from what we know in HubSpot: the company, its people, calls, meetings and notes. It takes a few seconds. You check it before anyone gets it.',
    )
    expect(within(note as HTMLElement).getByText('Under US$0.01.')).toHaveClass(
      'text-muted-foreground',
    )
    expect(note?.querySelector('svg.lucide-cpu')).toHaveAttribute('aria-hidden', 'true')
    // Above the buttons, and said once: the description no longer says how it is drafted.
    const buttons = within(dialog).getByRole('button', { name: 'Draft the pre-read' })
    expect(note?.compareDocumentPosition(buttons)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(dialog).toHaveAccessibleDescription("For a meeting that isn't in HubSpot.")
  })

  it('"Draft it" says that AI drafts it and the rep checks it, to the pointer and to a screen reader', async () => {
    mockServer()
    const { user } = renderMeetings()
    await screen.findByRole('list', { name: 'Today' })
    const draftIt = screen.getByRole('button', {
      name: 'Draft it: Sample Logistics Pty Ltd, 10:00 am',
    })
    expect(draftIt).toHaveAccessibleDescription("AI drafts it. You check it before it's sent.")
    await user.hover(draftIt)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      "AI drafts it. You check it before it's sent.",
    )
  })
})

describe('New pre-read', () => {
  it('opens by itself with the company filled in, when the Assistant asks (PLAN-V23 T4-2)', async () => {
    const server = mockServer()
    const { user, router } = renderMeetings('/assistant/meetings', {
      newPreRead: { key: '101', name: 'Sample Logistics Pty Ltd' },
    })
    const dialog = within(await screen.findByRole('dialog', { name: 'New pre-read' }))
    expect(dialog.getByRole('combobox', { name: 'Company' })).toHaveTextContent(
      'Sample Logistics Pty Ltd',
    )
    // The company is there: the title is the next thing to type.
    const title = dialog.getByRole('textbox', { name: 'Title' })
    await waitFor(() => {
      expect(title).toHaveFocus()
    })
    // The ask is used once: the address forgets it, so Back or a reload doesn't open it again.
    await waitFor(() => {
      expect(router.state.location.state).toBeNull()
    })
    expect(router.state.location.pathname).toBe('/assistant/meetings')

    await user.type(title, 'Office walk-through')
    await user.type(dialog.getByRole('textbox', { name: 'Day' }), '26 nov')
    await user.type(dialog.getByRole('textbox', { name: 'Time' }), '10am')
    await user.click(dialog.getByRole('button', { name: 'Draft the pre-read' }))
    expect(await screen.findByRole('heading', { name: 'Pre-read f-typed' })).toBeInTheDocument()
    expect(server.sent.filter((one) => one.path === FORMS)[0]?.body).toMatchObject({
      company_key: '101',
      title: 'Office walk-through',
    })
  })

  it('opens with no company when the Assistant found none, and the button opens it empty', async () => {
    mockServer()
    const { user } = renderMeetings('/assistant/meetings', { newPreRead: null })
    const dialog = within(await screen.findByRole('dialog', { name: 'New pre-read' }))
    expect(dialog.getByRole('combobox', { name: 'Company' })).toHaveTextContent('Pick a company')
    await user.click(dialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'New pre-read' })).toBeNull()
    })
    await user.click(screen.getByRole('button', { name: 'New pre-read' }))
    expect(
      within(await screen.findByRole('dialog', { name: 'New pre-read' })).getByRole('combobox', {
        name: 'Company',
      }),
    ).toHaveTextContent('Pick a company')
  })

  it('says what each field needs, and reads the day and the time as typed', async () => {
    const server = mockServer()
    const { user } = renderMeetings()
    await screen.findByRole('list', { name: 'Today' })
    await user.click(screen.getByRole('button', { name: 'New pre-read' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'New pre-read' }))
    const day = dialog.getByRole('textbox', { name: 'Day' })
    const time = dialog.getByRole('textbox', { name: 'Time' })
    const dayWrong = "That day couldn't be read. Try 26 nov, 26/11 or thu."

    // Text it can't read says so once the field is left, not while it is typed.
    await user.type(day, 'soonish')
    expect(dialog.queryByText(dayWrong)).toBeNull()
    await user.tab()
    expect(dialog.getByText(dayWrong)).toHaveAttribute('role', 'alert')
    expect(day).toHaveAttribute('aria-invalid', 'true')
    // A weekend stays a weekend, and a bare 2 is 2 pm. What it read shows under each field.
    await user.clear(day)
    await user.type(day, 'sat')
    expect(dialog.getByText('Sat 21 Nov 2026')).toBeInTheDocument()
    expect(day).toHaveAccessibleDescription('Sat 21 Nov 2026')
    await user.type(time, '2')
    expect(dialog.getByText('2:00 pm')).toBeInTheDocument()
    await user.clear(time)
    await user.type(time, 'half past')
    await user.tab()
    expect(dialog.getByText("That time couldn't be read. Try 10am or 14:30.")).toBeInTheDocument()

    // Sent with nothing in it: each field says what it needs, and the first takes the focus.
    await user.clear(day)
    await user.clear(time)
    await user.click(dialog.getByRole('button', { name: 'Draft the pre-read' }))
    expect(dialog.getByText('Pick the company.')).toBeInTheDocument()
    expect(dialog.getByText('Give the meeting a title.')).toBeInTheDocument()
    expect(dialog.getByText('Type the day of the meeting.')).toBeInTheDocument()
    expect(dialog.getByText('Type the time it starts.')).toBeInTheDocument()
    expect(dialog.getByRole('combobox', { name: 'Company' })).toHaveFocus()
    expect(server.sent.filter((one) => one.path === FORMS)).toEqual([])
  })

  it('starts a form for a meeting typed in, once, and opens its pre-read', async () => {
    const server = mockServer()
    const { user, router } = renderMeetings()
    await screen.findByRole('list', { name: 'Today' })
    await user.click(screen.getByRole('button', { name: 'New pre-read' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'New pre-read' }))

    // The company, with the picker Log call uses.
    await user.click(dialog.getByRole('combobox', { name: 'Company' }))
    const search = await screen.findByRole('combobox', {
      name: 'Which company is the meeting with?',
    })
    expect(screen.getByText('Type 2 letters or more.')).toBeInTheDocument()
    await user.type(search, 'sample')
    await user.click(await screen.findByRole('option', { name: /Sample Logistics Pty Ltd/ }))
    expect(dialog.getByRole('combobox', { name: 'Company' })).toHaveTextContent(
      'Sample Logistics Pty Ltd',
    )
    const title = dialog.getByRole('textbox', { name: 'Title' })
    await waitFor(() => {
      expect(title).toHaveFocus()
    })

    await user.type(title, 'Office walk-through')
    await user.type(dialog.getByRole('textbox', { name: 'Day' }), '26 nov')
    expect(dialog.getByText('Thu 26 Nov 2026')).toBeInTheDocument()
    await user.type(dialog.getByRole('textbox', { name: 'Time' }), '10am')
    const inPerson = dialog.getByRole('button', { name: 'In person' })
    await user.click(inPerson)
    expect(inPerson).toHaveAttribute('aria-pressed', 'true')
    await user.click(dialog.getByRole('button', { name: 'Draft the pre-read' }))

    expect(await screen.findByRole('heading', { name: 'Pre-read f-typed' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/assistant/meetings/f-typed')
    const started = server.sent.filter((one) => one.path === FORMS)
    expect(started).toHaveLength(1)
    expect(started[0]?.body).toEqual({
      company_key: '101',
      title: 'Office walk-through',
      // 10 am in Melbourne, in daylight saving.
      starts_at: '2026-11-26T10:00:00+11:00',
      where: 'in_person',
    })
  })

  it.each<['refuse' | 'invalid', string, string]>([
    ['refuse', 'Meetings are off', 'An admin can switch them on.'],
    ['invalid', 'Pick a day within the next 90 days.', ''],
  ])(
    'keeps the dialog and what was typed when the server says no (%s), and says why',
    async (start, words, more) => {
      mockServer({ start })
      const { user, router } = renderMeetings()
      await screen.findByRole('list', { name: 'Today' })
      await user.click(screen.getByRole('button', { name: 'New pre-read' }))
      const dialog = within(await screen.findByRole('dialog', { name: 'New pre-read' }))
      await user.click(dialog.getByRole('combobox', { name: 'Company' }))
      await user.type(
        await screen.findByRole('combobox', { name: 'Which company is the meeting with?' }),
        'sample',
      )
      await user.click(await screen.findByRole('option', { name: /Sample Logistics Pty Ltd/ }))
      await user.type(dialog.getByRole('textbox', { name: 'Title' }), 'Lease chat')
      const day = dialog.getByRole('textbox', { name: 'Day' })
      await user.type(day, '26 nov')
      await user.type(dialog.getByRole('textbox', { name: 'Time' }), '10am')
      await user.click(dialog.getByRole('button', { name: 'Draft the pre-read' }))

      expect(await dialog.findByText(words)).toBeInTheDocument()
      if (more) expect(dialog.getByText(more)).toBeInTheDocument()
      if (start === 'invalid') {
        // The server's words sit under the field it refused.
        expect(day).toHaveAccessibleDescription(words)
        expect(day).toHaveAttribute('aria-invalid', 'true')
      }
      expect(dialog.getByRole('textbox', { name: 'Title' })).toHaveValue('Lease chat')
      expect(day).toHaveValue('26 nov')
      expect(router.state.location.pathname).toBe('/assistant/meetings')
    },
  )

  it('sends "unknown" when neither Teams nor in person is picked', async () => {
    const server = mockServer()
    const { user } = renderMeetings()
    await screen.findByRole('list', { name: 'Today' })
    await user.click(screen.getByRole('button', { name: 'New pre-read' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'New pre-read' }))
    await user.click(dialog.getByRole('combobox', { name: 'Company' }))
    await user.type(
      await screen.findByRole('combobox', { name: 'Which company is the meeting with?' }),
      'sample',
    )
    await user.click(await screen.findByRole('option', { name: /Sample Logistics Pty Ltd/ }))
    await user.type(dialog.getByRole('textbox', { name: 'Title' }), 'Lease chat')
    await user.type(dialog.getByRole('textbox', { name: 'Day' }), 'tomorrow')
    await user.type(dialog.getByRole('textbox', { name: 'Time' }), '14:30')
    await user.click(dialog.getByRole('button', { name: 'Draft the pre-read' }))
    await screen.findByRole('heading', { name: 'Pre-read f-typed' })
    expect(server.sent.find((one) => one.path === FORMS)?.body).toEqual({
      company_key: '101',
      title: 'Lease chat',
      starts_at: '2026-11-19T14:30:00+11:00',
      where: 'unknown',
    })
  })

  it('shows who got a sent pre-read and when on the meeting row (V19 T2-4)', async () => {
    mockServer({
      upcoming: [
        meeting('m-sent', {
          company_name: 'Sample Health Pty Ltd',
          group: 'this_week',
          form: formState('f-sent', 'sent', {
            sent_at: '2026-11-17T03:00:00Z',
            sent_count: 3,
            sent_names: ['Jo Sample', 'Mia Sample'],
          }),
        }),
      ],
    })
    renderMeetings()
    await screen.findByText('Sent to Jo Sample and 2 more, 17 Nov')
    expect(screen.getByText('Sent to Jo Sample and 2 more, 17 Nov')).toBeInTheDocument()
  })
})
