/**
 * Meetings (PLAN-V17 T3-9), against Track 2's real contract (v17.ts Part 3) and a fake server that
 * keeps its meetings between requests and answers as Track 2's does: the soonest first, the rep's
 * own first on the team's list, each with its day group. The clock is fixed at 9:00 am on
 * Wednesday 18 Nov 2026, Melbourne time. Made-up names only: Sample Logistics Pty Ltd, Jo Sample.
 */
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
  MeetingsState,
} from '@/api/v17'
import { routes } from '@/router'
import { prefetchPage } from '@/shell/prefetch'
import { createTestQueryClient, renderWithProviders, startManualClock } from '@/test/render'
import MeetingsPage from './index'
import { readMeetings } from './params'
import { MeetingsToolbar, SEARCH_SETTLE_MS } from './toolbar'

const API = '/api/v1/companies'
const MEETINGS = `${API}/meetings`
const FORMS = `${MEETINGS}/forms`

/** 9:00 am on Wednesday 18 Nov 2026 in Melbourne (daylight saving, +11:00). */
const NOW = new Date('2026-11-17T22:00:00Z')

/** The signed-in rep's HubSpot owner, and a teammate's. */
const MINE = 'o-1'
const MIA = 'o-2'

type ItemChanges = Partial<Omit<MeetingItem, 'meeting'>> & { meeting?: Partial<Meeting> }

/** A meeting as HubSpot has it: 10:00 am today in Melbourne, on Teams, the rep's own. */
function meeting(id: string, { meeting: changes, ...rest }: ItemChanges = {}): MeetingItem {
  return {
    meeting: {
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
    ...rest,
  }
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
      form: { id: 'f2', status: 'drafting' },
    }),
    meeting('m3', {
      meeting: { company_id: '103', title: 'Fit-out budget', starts_at: '2026-11-19T00:00:00Z' },
      company_name: 'Sample Freight Pty Ltd',
      group: 'tomorrow',
      form: { id: 'f3', status: 'draft' },
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
      form: { id: 'f4', status: 'sent' },
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
      form: { id: 'f5', status: 'failed' },
    }),
  ]
}

function past(): MeetingItem[] {
  return [
    meeting('p1', {
      meeting: { title: 'Intro meeting', starts_at: '2026-11-17T03:00:00Z' },
      group: null,
      notes_logged: true,
      form: { id: 'fp1', status: 'sent' },
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
  /** Every meetings route answers 409 `meeting_forms_off`. */
  off: boolean
  /**
   * What POST /meetings/forms does: answer, refuse (409), refuse one field (422), or wait until
   * `release()`.
   */
  start: 'ok' | 'refuse' | 'invalid' | 'wait'
  release: () => void
  sent: Sent[]
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

/** The server's order: the rep's own first on the team's list, then by time. */
function serverOrder(items: MeetingItem[], when: string, mine: boolean): MeetingItem[] {
  const moment = (item: MeetingItem) => Date.parse(item.meeting.starts_at)
  return [...items].sort((a, b) => {
    const theirs = (item: MeetingItem) => (!mine && item.meeting.owner_id !== MINE ? 1 : 0)
    const time = when === 'past' ? moment(b) - moment(a) : moment(a) - moment(b)
    return theirs(a) - theirs(b) || time
  })
}

function mockServer(changes: Partial<Omit<Server, 'sent' | 'release'>> = {}): Server {
  const server: Server = {
    upcoming: upcoming(),
    past: past(),
    meetingsState: 'ready',
    sentence: null,
    off: false,
    start: 'ok',
    release: () => undefined,
    sent: [],
    ...changes,
  }
  const respond = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method
    const text = method === 'GET' ? '' : await request.clone().text()
    const body: unknown = text ? JSON.parse(text) : null
    server.sent.push({ method, path, search: url.searchParams, body, headers: request.headers })
    if (path.startsWith(MEETINGS) && server.off) return OFF()
    if (path === MEETINGS && method === 'GET') {
      const when = url.searchParams.get('when') ?? 'upcoming'
      const mine = url.searchParams.get('mine') !== 'false'
      const q = url.searchParams.get('q') ?? ''
      const limit = Number(url.searchParams.get('limit') ?? '50')
      const offset = Number(url.searchParams.get('offset') ?? '0')
      const items = serverOrder(
        (when === 'past' ? server.past : server.upcoming).filter(
          (item) => (item.typed || !mine || item.meeting.owner_id === MINE) && matches(item, q),
        ),
        when,
        mine,
      )
      return json({
        items: items.slice(offset, offset + limit),
        total: items.length,
        meetings_state: server.meetingsState,
        sentence: server.sentence,
      })
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
        const state: MeetingFormState = { id: `f-${meetingId}`, status: 'drafting' }
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

function renderMeetings(path = '/companies/meetings') {
  const router = createMemoryRouter(
    [
      { path: '/companies/meetings', element: <MeetingsPage /> },
      { path: '/companies/meetings/:formId', element: <PreReadStub /> },
    ],
    { initialEntries: [path] },
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
        `/companies/meetings/${id}`,
      )
      expect(one.getAllByRole('link').length + one.queryAllByRole('button').length).toBe(1)
    }
    // Where it is: a word and an icon, never colour alone. Not known: nothing.
    expect(within(row('Sample Mining Pty Ltd')).getByText('In person')).toBeInTheDocument()
    expect(within(row('Sample Health Pty Ltd')).queryByText(/Teams|In person/)).toBeNull()
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
    expect(router.state.location.pathname).toBe('/companies/meetings/f-m1')
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
    expect(router.state.location.pathname).toBe('/companies/meetings')
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
    // "Log meeting" comes with T3-11: no button on a past row yet.
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
      <MeetingsToolbar view={readMeetings(new URLSearchParams())} onChange={onChange} />,
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
    renderMeetings('/companies/meetings?q=vitera+26+nov')
    expect(
      await screen.findByRole('heading', { name: 'No meeting matches "vitera 26 nov".' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Meetings that are over are under Past\./)).toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toHaveValue('vitera 26 nov')
  })
})

describe('the team switch', () => {
  it("shows the team's meetings too, and back to the rep's own", async () => {
    const server = mockServer()
    const { user, router } = renderMeetings()
    await screen.findByRole('list', { name: 'Today' })
    // The rep's own first: Mia's meeting isn't there.
    expect(lists(server).at(-1)?.get('mine')).toBe('true')
    expect(screen.queryByText('Sample Energy Pty Ltd')).toBeNull()

    const team = screen.getByRole('switch', { name: "The team's meetings" })
    expect(team).not.toBeChecked()
    await user.click(team)
    expect(await screen.findByText('Sample Energy Pty Ltd')).toBeInTheDocument()
    expect(router.state.location.search).toBe('?team=1')
    expect(lists(server).at(-1)?.get('mine')).toBe('false')

    await user.click(screen.getByRole('switch', { name: "The team's meetings" }))
    await waitFor(() => {
      expect(screen.queryByText('Sample Energy Pty Ltd')).toBeNull()
    })
    expect(router.state.location.search).toBe('')
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
    mockServer({
      meetingsState: 'waiting',
      sentence: 'Waiting for HubSpot access to meetings.',
      upcoming: [],
      past: [],
    })
    const { user } = renderMeetings()
    const line = await screen.findByText(
      'Waiting for HubSpot access to meetings. You can still start a new pre-read.',
    )
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
    // Track 1's sentence when no key is set and nothing was read yet.
    const notConnected = "HubSpot isn't connected, so meetings can't be read from it."
    // A meeting typed in with New pre-read is still on the list, with a Lead Finder lead's key.
    const typed = meeting('', {
      meeting: { company_id: 'lead:7', owner_id: null, title: 'Office walk-through' },
      typed: true,
      form: { id: 'f-typed', status: 'draft' },
    })
    mockServer({
      meetingsState: 'off',
      sentence: notConnected,
      upcoming: [typed],
    })
    const { user } = renderMeetings()
    const line = await screen.findByText(`${notConnected} You can still start a new pre-read.`)
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
    ).toHaveAttribute('href', '/companies/meetings/f-typed')
    await user.click(screen.getByRole('button', { name: 'New pre-read' }))
    expect(await screen.findByRole('dialog', { name: 'New pre-read' })).toBeInTheDocument()
  })

  it("the rep's own can't be picked out yet: the server's line, and words that don't say none", async () => {
    const notLinked =
      "Your account isn't linked to a HubSpot owner yet, so your own meetings can't be picked out. Show the team's meetings to see them."
    mockServer({ sentence: notLinked, upcoming: [] })
    renderMeetings()
    expect(
      await screen.findByText(`${notLinked} You can still start a new pre-read.`),
    ).toHaveAttribute('role', 'status')
    expect(
      await screen.findByRole('heading', { name: 'No meetings of your own to show yet.' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('No meetings this week.')).toBeNull()
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
    prefetchPage(routes, { pathname: '/companies/meetings', search: '?when=past&team=1' }, client)
    // The prefetch loads its own small file first.
    await waitFor(() => {
      expect(server.sent).toHaveLength(1)
    })
    expect(server.sent.map((one) => `${one.path}?${one.search.toString()}`)).toEqual([
      `${MEETINGS}?when=past&mine=false&limit=25&offset=0`,
    ])
  })
})

describe('New pre-read', () => {
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
    expect(router.state.location.pathname).toBe('/companies/meetings/f-typed')
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
      expect(router.state.location.pathname).toBe('/companies/meetings')
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
})
