/**
 * The pre-meeting form around the app (PLAN-V17 T3-11, "The screens" part 7), in the whole app
 * against a fake server: Home's "Upcoming meetings" card, Ctrl+K's "Pre-read for a meeting", and a
 * person without the Companies tick, who sees none of it and whose browser asks nothing about
 * meetings. Then a company's record, which lists its meetings. The clock is fixed at 9:00 am on
 * Wednesday 18 Nov 2026, Melbourne time. Made-up names only.
 */
import { screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompanyDetail } from '@/api/types'
import type { CompanyDetailV17, Meeting, MeetingItem, MeetingSummary } from '@/api/v17'
import { routes } from '@/router'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { asLaptop } from '@/test/screen'
import { CompanyView } from '../company-view'

// Pages and late parts load lazily. A busy test run can take more than a second to load one.
const LAZY = 5000
const MEETINGS = '/api/v1/companies/meetings'
const GREETING = /^Good (morning|afternoon|evening)/

/** 9:00 am on Wednesday 18 Nov 2026 in Melbourne (daylight saving, +11:00). */
const NOW = new Date('2026-11-17T22:00:00Z')

type ItemChanges = Partial<Omit<MeetingItem, 'meeting'>> & { meeting?: Partial<Meeting> }

function item(id: string, { meeting: changes, ...rest }: ItemChanges = {}): MeetingItem {
  return {
    meeting: {
      id,
      company_id: '101',
      title: 'Office walk-through',
      starts_at: '2026-11-17T23:00:00Z',
      ends_at: '2026-11-18T00:00:00Z',
      where: 'online',
      outcome: 'SCHEDULED',
      ...changes,
    },
    company_name: 'Sample Logistics Pty Ltd',
    group: 'today',
    form: null,
    notes_logged: false,
    typed: false,
    owner_name: null,
    ...rest,
  }
}

/** The rep's next meetings, soonest first, as the server sends them. */
function upcoming(): MeetingItem[] {
  return [
    item('m1'),
    item('m2', {
      meeting: { company_id: '102', title: 'First meeting', outcome: 'CANCELED' },
      company_name: 'Sample Retail Pty Ltd',
      group: 'today',
    }),
    item('m3', {
      meeting: { company_id: '103', title: 'Fit-out budget', starts_at: '2026-11-19T00:00:00Z' },
      company_name: 'Sample Freight Pty Ltd',
      group: 'tomorrow',
      form: { id: 'f3', status: 'draft' },
    }),
    item('m4', {
      meeting: {
        company_id: '104',
        title: 'Workplace strategy',
        starts_at: '2026-11-19T22:30:00Z',
      },
      company_name: 'Sample Health Pty Ltd',
      group: 'this_week',
      form: { id: 'f4', status: 'sent' },
    }),
    item('m5', {
      meeting: { company_id: '105', title: 'Site visit', starts_at: '2026-11-24T04:00:00Z' },
      company_name: 'Sample Energy Pty Ltd',
      group: 'later',
    }),
  ]
}

interface Backend {
  /** The counts, or 'off' for the 409 the server answers while pre-meeting forms are off. */
  summary?: MeetingSummary | 'off'
  items?: MeetingItem[]
  /** Who is signed in. Left out: sign-in is off, so everyone sees every project. */
  user?: { role: 'admin' | 'staff'; apps: string[] }
}

const OFF = () =>
  Response.json(
    {
      title: 'Meetings are off',
      status: 409,
      detail: 'An admin can switch them on.',
      code: 'meeting_forms_off',
    },
    { status: 409 },
  )

/** The fake server. Returns every request it got, as "GET /path?query". */
function stubBackend({
  summary = { need_pre_read: 2, draft_ready: 1 },
  items = upcoming(),
  user,
}: Backend = {}): string[] {
  const requests: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request) => {
      const url = new URL(request.url)
      requests.push(`${request.method} ${url.pathname}${url.search}`)
      const path = url.pathname
      if (path === '/api/v1/auth/me') {
        return Promise.resolve(
          Response.json(
            user
              ? {
                  auth_required: true,
                  user: {
                    id: '11111111-2222-3333-4444-555555555555',
                    email: 'jo@example.test',
                    username: 'jo',
                    name: 'Jo Sample',
                    ...user,
                  },
                  session: null,
                }
              : { auth_required: false, user: null, session: null },
          ),
        )
      }
      if (path === `${MEETINGS}/summary`) {
        return Promise.resolve(summary === 'off' ? OFF() : Response.json(summary))
      }
      if (path === MEETINGS) {
        return Promise.resolve(
          summary === 'off'
            ? OFF()
            : Response.json({
                items,
                total: items.length,
                meetings_state: 'ready',
                sentence: null,
              }),
        )
      }
      return Promise.resolve(Response.json({ title: 'Not found', status: 404 }, { status: 404 }))
    }),
  )
  return requests
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const result = renderWithProviders(<RouterProvider router={router} />, {
    withRouter: false,
    queryClient: createTestQueryClient(),
  })
  return { ...result, router }
}

async function home() {
  await screen.findByRole('heading', { level: 1, name: GREETING }, { timeout: LAZY })
}

function meetingRequests(requests: readonly string[]): string[] {
  return requests.filter((request) => request.includes('/companies/meetings'))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("Home's Upcoming meetings", () => {
  it('shows the next three, each with its status and button, under what needs doing', async () => {
    asLaptop()
    const requests = stubBackend()
    renderAt('/')
    await home()
    const card = within(
      await screen.findByRole('region', { name: 'Upcoming meetings' }, { timeout: LAZY }),
    )
    expect(
      card.getByText('2 need a pre-read, and 1 is ready to check and send.'),
    ).toBeInTheDocument()
    // The next three, a cancelled one left out: it needs nothing.
    const rows = card.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.querySelector('.font-semibold')?.textContent)).toEqual([
      'Sample Logistics Pty Ltd',
      'Sample Freight Pty Ltd',
      'Sample Health Pty Ltd',
    ])
    const [first, second] = rows
    if (!first || !second) throw new Error('Too few rows')
    expect(within(first).getByText('Today, 10:00 am')).toBeInTheDocument()
    expect(within(first).getByText('Needs pre-read')).toBeInTheDocument()
    expect(
      card.getByRole('button', { name: 'Draft it: Sample Logistics Pty Ltd, Today, 10:00 am' }),
    ).toBeEnabled()
    expect(within(second).getByText('Draft ready')).toBeInTheDocument()
    expect(
      card.getByRole('link', {
        name: 'Check and send: Sample Freight Pty Ltd, Tomorrow, 11:00 am',
      }),
    ).toHaveAttribute('href', '/companies/meetings/f3')
    expect(
      card.getByRole('link', { name: 'Open: Sample Health Pty Ltd, Fri 20 Nov, 9:30 am' }),
    ).toHaveAttribute('href', '/companies/meetings/f4')
    expect(card.getByRole('link', { name: 'Open Meetings' })).toHaveAttribute(
      'href',
      '/companies/meetings',
    )
    // The list Meetings shows first, so opening Meetings from here shows it at once.
    expect(meetingRequests(requests)).toContain(
      `GET ${MEETINGS}?when=upcoming&mine=true&limit=100&offset=0`,
    )
  })

  it('comes after every other card, so its coming moves none of them', async () => {
    asLaptop()
    stubBackend()
    renderAt('/')
    await home()
    const meetings = await screen.findByRole(
      'region',
      { name: 'Upcoming meetings' },
      {
        timeout: LAZY,
      },
    )
    const cost = screen.getByRole('region', { name: 'Runs and cost' })
    expect(cost.compareDocumentPosition(meetings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('says so in the serif voice when there are no meetings in the next few days', async () => {
    asLaptop()
    stubBackend({ summary: { need_pre_read: 0, draft_ready: 0 }, items: [] })
    renderAt('/')
    await home()
    const card = within(
      await screen.findByRole('region', { name: 'Upcoming meetings' }, { timeout: LAZY }),
    )
    expect(card.getByText('No meetings in the next few days.')).toHaveClass('font-serif')
    expect(card.queryByRole('listitem')).toBeNull()
  })

  it('is not there while pre-meeting forms are off, and asks for no meetings', async () => {
    asLaptop()
    const requests = stubBackend({ summary: 'off' })
    renderAt('/')
    await home()
    await waitFor(() => {
      expect(meetingRequests(requests)).toContain(`GET ${MEETINGS}/summary`)
    })
    // The card took no place in the grid either.
    expect(screen.queryByRole('region', { name: 'Upcoming meetings' })).toBeNull()
    expect(meetingRequests(requests)).toEqual([`GET ${MEETINGS}/summary`])
  })
})

describe("Ctrl+K's Pre-read for a meeting", () => {
  it('opens Meetings, upcoming', async () => {
    asLaptop()
    stubBackend()
    const { user, router } = renderAt('/')
    await home()
    await user.keyboard('{Control>}k{/Control}')
    await user.type(await screen.findByPlaceholderText('Type a page or an action'), 'pre-read')
    await user.click(await screen.findByRole('option', { name: 'Pre-read for a meeting' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/companies/meetings')
    })
    expect(router.state.location.search).toBe('')
  })

  it('is not there while pre-meeting forms are off', async () => {
    asLaptop()
    const requests = stubBackend({ summary: 'off' })
    const { user } = renderAt('/')
    await home()
    await waitFor(() => {
      expect(meetingRequests(requests)).toContain(`GET ${MEETINGS}/summary`)
    })
    await user.keyboard('{Control>}k{/Control}')
    const menu = await screen.findByRole('dialog', { name: 'Go to a page' })
    expect(within(menu).getByRole('option', { name: 'Meetings' })).toBeInTheDocument()
    expect(within(menu).queryByRole('option', { name: 'Pre-read for a meeting' })).toBeNull()
  })
})

describe('who sees it', () => {
  it('a person without the Companies tick sees none of it, and nothing asks about meetings', async () => {
    asLaptop()
    const requests = stubBackend({ user: { role: 'staff', apps: ['lead_finder'] } })
    const { user } = renderAt('/')
    await home()
    expect(screen.queryByRole('region', { name: 'Upcoming meetings' })).toBeNull()
    await user.keyboard('{Control>}k{/Control}')
    const menu = await screen.findByRole('dialog', { name: 'Go to a page' })
    expect(within(menu).queryByRole('option', { name: 'Pre-read for a meeting' })).toBeNull()
    expect(meetingRequests(requests)).toEqual([])
  })

  it('the same person with the tick sees the card and the entry', async () => {
    asLaptop()
    stubBackend({ user: { role: 'staff', apps: ['lead_finder', 'companies'] } })
    const { user } = renderAt('/')
    await home()
    expect(
      await screen.findByRole('region', { name: 'Upcoming meetings' }, { timeout: LAZY }),
    ).toBeInTheDocument()
    await user.keyboard('{Control>}k{/Control}')
    expect(
      await screen.findByRole('option', { name: 'Pre-read for a meeting' }),
    ).toBeInTheDocument()
  })
})

describe("a company's record", () => {
  function company(meetings: MeetingItem[]): CompanyDetailV17 {
    const detail: CompanyDetail = {
      key: '101',
      source: 'hubspot',
      name: 'Sample Logistics Pty Ltd',
      domain: null,
      website: null,
      city: 'Perth',
      state: 'WA',
      industry: 'Logistics',
      staff: 300,
      linkedin_staff: null,
      description: null,
      owner: 'Levi',
      lifecycle_stage: null,
      last_talk: null,
      last_talk_note: null,
      next_lease_end: null,
      deal: 'none',
      hubspot_url: null,
      offices: [],
      deals: [],
      notes: [],
      people: [],
      calls: [],
      people_status: 'ready',
      lead: null,
    }
    return { ...detail, meetings }
  }

  it('lists its next and last meetings, each with its status and a link to its pre-read or Meetings', () => {
    const next = item('m3', {
      meeting: { title: 'Fit-out budget', starts_at: '2026-11-19T00:00:00Z' },
      group: 'tomorrow',
      form: { id: 'f3', status: 'draft' },
      owner_name: 'Mia Sample',
    })
    const later = item('m5', {
      meeting: { title: 'Site visit', starts_at: '2026-11-24T04:00:00Z', where: 'in_person' },
      group: 'later',
    })
    const before = item('p1', {
      meeting: { title: 'Lease review', starts_at: '2026-11-12T23:00:00Z' },
      group: null,
    })
    renderWithProviders(<CompanyView company={company([next, later, before])} today="2026-11-18" />)
    const section = within(screen.getByRole('region', { name: 'Meetings' }))
    const coming = within(section.getByRole('list', { name: 'Coming up' }))
    const past = within(section.getByRole('list', { name: 'Past' }))
    expect(coming.getAllByRole('listitem')).toHaveLength(2)

    // A draft ready: its pre-read, to check and send. Whose meeting it is, when the server knows.
    expect(coming.getByText('Tomorrow, 11:00 am · Teams · Mia Sample')).toBeInTheDocument()
    expect(coming.getByText('Draft ready')).toBeInTheDocument()
    expect(
      coming.getByRole('link', { name: 'Check and send: Fit-out budget, Tomorrow, 11:00 am' }),
    ).toHaveAttribute('href', '/companies/meetings/f3')
    // No pre-read yet: Meetings, found by the company's name, everyone's.
    expect(coming.getByText('Needs pre-read')).toBeInTheDocument()
    expect(
      coming.getByRole('link', { name: 'Open Meetings: Site visit, Tue 24 Nov, 3:00 pm' }),
    ).toHaveAttribute('href', '/companies/meetings?team=1&q=Sample+Logistics+Pty+Ltd')
    // A past one says whether its notes are logged, and opens Meetings' Past.
    expect(past.getByText('No notes yet')).toBeInTheDocument()
    expect(past.getByRole('link', { name: /^Open Meetings: Lease review/ })).toHaveAttribute(
      'href',
      '/companies/meetings?when=past&team=1&q=Sample+Logistics+Pty+Ltd',
    )
  })

  it('has no Meetings section while it has none: forms off, or meetings not read yet', () => {
    renderWithProviders(<CompanyView company={company([])} today="2026-11-18" />)
    expect(screen.queryByRole('region', { name: 'Meetings' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Deals' })).toBeInTheDocument()
  })
})
