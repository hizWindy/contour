import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CompanyDetail,
  CompanyRow,
  CompanySearch,
  HubSpotSync,
  PrepChip,
  PrepFacts,
  PrepOut,
} from '@/api/types'
import { renderWithProviders } from '@/test/render'
import { asPhone } from '@/test/screen'
import CompaniesPage from './index'

const API = '/api/v1/companies'

function row(changes: Partial<CompanyRow> = {}): CompanyRow {
  return {
    key: '101',
    name: 'ABC Logistics',
    domain: 'abclogistics.com.au',
    city: 'Perth',
    industry: 'Logistics and Supply Chain',
    staff: 300,
    owner: 'Levi',
    last_talk: '2026-10-01',
    next_lease_end: '2027-06-30',
    deal: 'open',
    source: 'hubspot',
    lead_result: null,
    lead_score: null,
    ...changes,
  }
}

const ROWS: CompanyRow[] = [
  row(),
  row({
    key: '103',
    name: 'Zed Mining',
    domain: 'zed.com.au',
    city: 'Brisbane',
    industry: 'Mining and Metals',
    staff: 900,
    owner: null,
    last_talk: null,
    next_lease_end: null,
    deal: 'none',
  }),
]

function detail(changes: Partial<CompanyDetail> = {}): CompanyDetail {
  return {
    key: '101',
    source: 'hubspot',
    name: 'ABC Logistics',
    domain: 'abclogistics.com.au',
    website: 'https://abclogistics.com.au',
    city: 'Perth',
    state: 'WA',
    industry: 'Logistics and Supply Chain',
    staff: 300,
    linkedin_staff: 280,
    description: 'Moves freight across WA.',
    owner: 'Levi',
    lifecycle_stage: 'Opportunity',
    last_talk: '2026-10-01',
    last_talk_note: null,
    next_lease_end: '2027-06-30',
    deal: 'open',
    hubspot_url: 'https://app.hubspot.com/contacts/1/company/101',
    offices: [
      {
        label: 'Perth',
        city: 'Perth',
        street: '1 Hay St',
        level: 'Level 5',
        lease_end: '2027-06-30',
        moved_in: null,
        office_m2: '1200',
        linkedin_staff: 150,
        quality: null,
      },
    ],
    deals: [
      {
        name: 'Perth fit-out',
        stage: 'Qualified Deal',
        state: 'open',
        pipeline: 'Sales Pipeline',
        amount_aud: '1500000',
        close_date: '2027-03-01',
        owner: 'Levi',
        next_step: 'Site visit',
        hubspot_url: null,
      },
    ],
    notes: [],
    people: [],
    calls: [],
    people_status: 'waiting',
    lead: null,
    ...changes,
  }
}

const FACETS = {
  cities: [
    { value: 'Perth', count: 1 },
    { value: 'Adelaide', count: 0 },
  ],
  owners: [{ value: 'Levi', count: 1 }],
  leads_shown: false,
}

const SEARCH: CompanySearch = {
  people: [
    {
      id: '201',
      name: 'Jason Reeds',
      title: 'Head of Operations',
      company_key: '101',
      company_name: 'ABC Logistics',
    },
  ],
  companies: [
    { key: '101', name: 'ABC Logistics', city: 'Perth', industry: 'Logistics', source: 'hubspot' },
  ],
}

function facts(changes: Partial<PrepFacts> = {}): PrepFacts {
  return {
    company_key: '101',
    company_name: 'ABC Logistics',
    city: 'Perth',
    industry: 'Logistics and Supply Chain',
    staff: 300,
    owner: 'Levi',
    deal: 'open',
    next_lease_end: '2027-06-30',
    last_talk: '2026-10-01',
    hubspot_url: null,
    person: { id: '201', name: 'Jason Reeds', title: 'Head of Operations' },
    phone: '+61 8 9000 1234',
    last_call: {
      id: '301',
      called_at: '2026-10-01T01:00:00Z',
      person: 'Jason Reeds',
      owner: 'Levi',
      minutes: 7,
      outcome: 'Connected',
      note: 'Lease ends next year. Call back in March.',
      hubspot_url: null,
    },
    facts: [],
    people: [
      {
        id: '201',
        name: 'Jason Reeds',
        title: 'Head of Operations',
        phone: null,
        last_activity: null,
      },
    ],
    people_status: 'ready',
    prep_enabled: true,
    names_ok: true,
    prep_cap_usd: '0.25',
    ...changes,
  }
}

function prep(changes: Partial<PrepOut> = {}): PrepOut {
  return {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    company_key: '101',
    company_name: 'ABC Logistics',
    person: { id: '201', name: 'Jason Reeds', title: 'Head of Operations' },
    kind: 'person',
    trigger: 'person',
    status: 'ready',
    stage: 3,
    error: null,
    script: {
      still_there: 'yes',
      still_there_note: { text: 'Jason is still Head of Operations.', sources: ['W1'] },
      news: [{ text: 'ABC Logistics won a A$40M contract.', sources: ['W1'] }],
      opener: [{ text: 'Hi Jason, we spoke on 1 Oct about Perth.', sources: ['F11'] }],
      why_now: [{ text: 'The Perth lease ends in June 2027.', sources: ['F7'] }],
      questions: [
        {
          text: 'Are you planning to renew or move?',
          sources: ['F7'],
          follow_ups: [{ if_they_say: 'Move', ask: 'Who is helping you look?' }],
        },
      ],
      if_they_say: [
        { they_say: "We're not ready yet.", answer: { text: 'Fair enough.', sources: ['F7'] } },
      ],
      goal: { text: 'Book a site visit in Perth.', sources: ['F7'] },
      dropped: 1,
    },
    sources: [
      { id: 'F7', kind: 'hubspot', label: 'HubSpot: Perth office', url: null, date: null },
      { id: 'F11', kind: 'call', label: 'HubSpot call, 1 Oct 2026', url: null, date: '2026-10-01' },
      {
        id: 'W1',
        kind: 'web',
        label: 'ABC Logistics wins contract',
        url: 'https://www.afr.com/abc',
        date: '2026-10-20',
      },
    ],
    web_checked: true,
    reused: false,
    made_by: 'Mia',
    created_at: '2026-11-09T19:30:00Z',
    finished_at: '2026-11-09T19:30:09Z',
    ...changes,
  }
}

function sync(changes: Partial<HubSpotSync> = {}): HubSpotSync {
  return {
    id: 2,
    mode: 'full',
    trigger: 'command',
    status: 'done',
    changed_since: null,
    companies_read: 13913,
    deals_read: 8943,
    owners_read: 13,
    companies_saved: 13913,
    offices_saved: 22770,
    deals_saved: 8041,
    deals_skipped: 902,
    companies_removed: 0,
    deals_removed: 0,
    profiles_rebuilt: 13913,
    error: null,
    warnings: [],
    started_at: new Date(Date.now() - 5 * 3_600_000 - 546_000).toISOString(),
    finished_at: new Date(Date.now() - 5 * 3_600_000).toISOString(),
    ...changes,
  }
}

interface Backend {
  rows: CompanyRow[]
  leadsShown: boolean
  detail: CompanyDetail
  prep: PrepOut
  prepStatus: number
  chips: PrepChip[]
  syncs: HubSpotSync[]
  /** What GET /hubspot/syncs answers once a sync is started. */
  afterStart: HubSpotSync[]
  requests: Request[]
}

function mockApi(changes: Partial<Backend> = {}): Backend {
  const backend: Backend = {
    rows: ROWS,
    leadsShown: false,
    detail: detail(),
    prep: prep(),
    prepStatus: 202,
    chips: [],
    syncs: [sync()],
    afterStart: [],
    requests: [],
    ...changes,
  }
  const respond = (request: Request, url: URL): Response => {
    const path = url.pathname
    if (path === '/api/v1/hubspot/syncs') return Response.json(backend.syncs)
    if (path === '/api/v1/hubspot/sync' && request.method === 'POST') {
      backend.syncs = backend.afterStart
      return Response.json(backend.afterStart[0] ?? sync({ status: 'running' }), { status: 202 })
    }
    if (path === API) {
      return Response.json({
        total: backend.rows.length,
        items: backend.rows,
        leads_shown: backend.leadsShown,
      })
    }
    if (path === `${API}/facets`) return Response.json(FACETS)
    if (path === `${API}/search`) return Response.json(SEARCH)
    if (path === `${API}/preps/today`) return Response.json(backend.chips)
    if (path === `${API}/preps` && request.method === 'POST') {
      if (backend.prepStatus === 409) {
        return Response.json(
          { title: 'Call prep is off', status: 409, code: 'prep_off', detail: 'Off.' },
          { status: 409 },
        )
      }
      return Response.json(backend.prep, { status: backend.prepStatus })
    }
    if (path.startsWith(`${API}/preps/`)) return Response.json(backend.prep)
    if (path.endsWith('/facts')) {
      const contact = url.searchParams.get('contact_id')
      return Response.json(contact ? facts() : facts({ person: null, phone: '(08) 9000 0000' }))
    }
    if (path === `${API}/101`) return Response.json(backend.detail)
    return Response.json({ title: 'Not found', status: 404 }, { status: 404 })
  }
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request) => {
      backend.requests.push(request)
      return Promise.resolve(respond(request, new URL(request.url)))
    }),
  )
  return backend
}

function Address() {
  return <output aria-label="Address">{useLocation().search}</output>
}

function renderCompanies(search = '') {
  return renderWithProviders(
    <>
      <CompaniesPage />
      <Address />
    </>,
    { route: `/companies${search}` },
  )
}

afterEach(() => {
  window.localStorage.clear()
})

describe('the Companies page', () => {
  it('lists the companies with their deal, lease end and last talk, and no Lead Finder column', async () => {
    mockApi()
    renderCompanies()
    const table = await screen.findByRole('table', { name: 'Companies' })
    await within(table).findByText('ABC Logistics')
    expect(within(table).getByText('Open deal')).toBeInTheDocument()
    expect(within(table).getByText('No deal')).toBeInTheDocument()
    expect(within(table).getByText('No owner')).toBeInTheDocument()
    expect(within(table).queryByRole('columnheader', { name: 'Lead Finder' })).toBeNull()
    expect(screen.getByText('2 companies')).toBeInTheDocument()
  })

  it('shows the Lead Finder column and "Not in HubSpot yet" for its tick', async () => {
    mockApi({
      leadsShown: true,
      rows: [
        ...ROWS,
        row({
          key: 'lead:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          name: 'Delta Freight',
          source: 'lead',
          deal: 'none',
          lead_result: 'pass',
          lead_score: 82,
        }),
      ],
    })
    renderCompanies()
    const table = await screen.findByRole('table', { name: 'Companies' })
    await within(table).findByText('Delta Freight')
    expect(within(table).getByRole('columnheader', { name: 'Lead Finder' })).toBeInTheDocument()
    expect(within(table).getByText('Not in HubSpot yet')).toBeInTheDocument()
  })

  it('filters only through the filter bar, and keeps it in the address', async () => {
    const backend = mockApi()
    const { user } = renderCompanies()
    await screen.findByText('ABC Logistics')
    await user.type(screen.getByRole('searchbox', { name: /Filter companies/ }), 'logis')
    await waitFor(() => {
      const asked = backend.requests.map((request) => new URL(request.url))
      expect(
        asked.some((url) => url.pathname === API && url.searchParams.get('q') === 'logis'),
      ).toBe(true)
    })
    expect(new URLSearchParams(screen.getByLabelText('Address').textContent).get('q')).toBe('logis')
  })

  it('opens the panel filled from the row, and Esc closes it and puts focus back on the row', async () => {
    mockApi()
    const { user } = renderCompanies()
    const name = await screen.findByRole('button', { name: 'ABC Logistics' })
    await user.click(name)
    const panel = await screen.findByRole('dialog', { name: 'ABC Logistics' })
    // The four boxes come from the row at once; the rest follows.
    expect(within(panel).getByText('Next lease end')).toBeInTheDocument()
    expect(await within(panel).findByText('Moves freight across WA.')).toBeInTheDocument()
    expect(
      within(panel).getAllByText('Waiting for HubSpot access to contacts and calls.'),
    ).toHaveLength(2)
    expect(within(panel).getByRole('link', { name: /Open in HubSpot/ })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'ABC Logistics' })).toHaveFocus()
    })
  })
})

describe('the prep box and the call prep', () => {
  it('"/" puts the cursor in the prep box, and a person opens their script', async () => {
    mockApi()
    const { user } = renderCompanies()
    await screen.findByText('ABC Logistics')
    fireEvent.keyDown(document.body, { key: '/' })
    const box = screen.getByRole('combobox', { name: /Who are you calling/ })
    expect(box).toHaveFocus()
    await user.type(box, 'jas')
    const option = await screen.findByRole('option', { name: /Jason Reeds/ })
    expect(option).toBeInTheDocument()
    await user.keyboard('{Enter}')
    const modal = await screen.findByRole('dialog', { name: /Jason Reeds/ })
    // Still there?, Last talk and News sit in the card's header, out of the scroll.
    const answers = within(modal).getByRole('list', { name: 'Before you dial' })
    expect(answers.closest('.overflow-y-auto')).toBeNull()
    expect(await within(answers).findByText('Still there')).toBeInTheDocument()
    expect(within(modal).getByText('Are you planning to renew or move?')).toBeInTheDocument()
    // Call prep's guided question opens with its follow-up.
    expect(within(modal).getByText('Who is helping you look?')).toBeInTheDocument()
    expect(within(modal).getByText(/^Made .+ by Mia\.$/)).toBeInTheDocument()
    expect(
      within(modal).getByText('1 line was left out because it had no source.'),
    ).toBeInTheDocument()
    expect(within(modal).getByText('Lease ends next year. Call back in March.')).toBeInTheDocument()
    expect(within(modal).getAllByText('W1').length).toBeGreaterThan(0)
  })

  it('a company asks "Who are you calling?", and a cold call goes to the switchboard', async () => {
    const backend = mockApi({ prep: prep({ person: null, kind: 'cold' }) })
    const { user } = renderCompanies()
    await screen.findByText('ABC Logistics')
    await user.click(screen.getByRole('combobox', { name: /Who are you calling/ }))
    await user.type(screen.getByRole('combobox', { name: /Who are you calling/ }), 'abc')
    await user.click(await screen.findByRole('option', { name: /^ABC Logistics/ }))
    const modal = await screen.findByRole('dialog', { name: 'Who are you calling?' })
    expect(await within(modal).findByText('People at ABC Logistics')).toBeInTheDocument()
    await user.click(within(modal).getByRole('button', { name: 'Prep a cold call' }))
    const card = await screen.findByRole('dialog', { name: 'ABC Logistics' })
    expect(within(card).getByText(/Cold call, no name yet/)).toBeInTheDocument()
    await waitFor(() => {
      const posted = backend.requests.find((request) => request.method === 'POST')
      expect(posted).toBeDefined()
    })
    expect(await screen.findByText('(08) 9000 0000')).toBeInTheDocument()
  })

  it('shows the 3-step bar while call prep checks the web, with the free script already there', async () => {
    mockApi({ prep: prep({ status: 'searching', stage: 2, script: null, sources: [] }) })
    const { user } = renderCompanies()
    await screen.findByText('ABC Logistics')
    await user.type(screen.getByRole('combobox', { name: /Who are you calling/ }), 'jas')
    await user.click(await screen.findByRole('option', { name: /Jason Reeds/ }))
    const modal = await screen.findByRole('dialog', { name: /Jason Reeds/ })
    expect(await within(modal).findByRole('progressbar', { name: /Call prep/ })).toBeInTheDocument()
    expect(within(modal).getByText(/Call prep is checking the web/)).toBeInTheDocument()
    expect(within(modal).getByText('Web check')).toBeInTheDocument()
    expect(
      await within(modal).findByText('Written from our HubSpot copy until the new one is ready.'),
    ).toBeInTheDocument()
    expect(within(modal).getByRole('button', { name: 'Researching...' })).toBeDisabled()
  })

  it('says a failed prep in plain words, and "Try again" makes a new one', async () => {
    const backend = mockApi({
      prep: prep({ status: 'failed', script: null, error: 'Claude did not answer.' }),
    })
    const { user } = renderCompanies()
    await screen.findByText('ABC Logistics')
    await user.type(screen.getByRole('combobox', { name: /Who are you calling/ }), 'jas')
    await user.click(await screen.findByRole('option', { name: /Jason Reeds/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Claude did not answer. The script below is from our HubSpot copy. Press Try again.',
    )
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => {
      expect(backend.requests.filter((request) => request.method === 'POST')).toHaveLength(2)
    })
  })

  it('"Research again" sits at the top of the script and makes a new prep, with no confirm box', async () => {
    const backend = mockApi()
    const { user } = renderCompanies()
    await screen.findByText('ABC Logistics')
    await user.type(screen.getByRole('combobox', { name: /Who are you calling/ }), 'jas')
    await user.click(await screen.findByRole('option', { name: /Jason Reeds/ }))
    const modal = await screen.findByRole('dialog', { name: /Jason Reeds/ })
    const script = await within(modal).findByRole('region', { name: 'Sales script' })
    const again = within(script).getByRole('button', { name: 'Research again' })
    expect(again).toHaveAccessibleDescription(
      'New news, a new "still there?" check and a new script.',
    )
    // The footer has no Refresh any more.
    expect(within(modal).queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(again).toBeEnabled()
    })
    await user.click(again)
    await waitFor(() => {
      const posts = backend.requests.filter((request) => request.method === 'POST')
      expect(posts).toHaveLength(2)
    })
    const posts = backend.requests.filter((request) => request.method === 'POST')
    const last = posts[posts.length - 1]
    if (!last) throw new Error('no request')
    expect(await last.clone().json()).toMatchObject({ contact_id: '201', refresh: true })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('a searched-ahead prep says so', async () => {
    mockApi({ prep: prep({ trigger: 'search_ahead', made_by: null }), prepStatus: 200 })
    const { user } = renderCompanies()
    await screen.findByText('ABC Logistics')
    await user.type(screen.getByRole('combobox', { name: /Who are you calling/ }), 'jas')
    await user.click(await screen.findByRole('option', { name: /Jason Reeds/ }))
    expect(await screen.findByText(/^Searched ahead at /)).toBeInTheDocument()
  })

  it('while call prep is off, the card still has a sales script and guided questions', async () => {
    mockApi({ prepStatus: 409 })
    const { user } = renderCompanies()
    await screen.findByText('ABC Logistics')
    await user.type(screen.getByRole('combobox', { name: /Who are you calling/ }), 'jas')
    await user.click(await screen.findByRole('option', { name: /Jason Reeds/ }))
    const modal = await screen.findByRole('dialog', { name: /Jason Reeds/ })
    expect(await within(modal).findByText(/Call prep is off/)).toBeInTheDocument()
    expect(within(modal).getByText('Lease ends next year. Call back in March.')).toBeInTheDocument()
    expect(await within(modal).findByText('Sales script')).toBeInTheDocument()
    expect(within(modal).getByText('Written from our HubSpot copy.')).toBeInTheDocument()
    expect(within(modal).getByText('I wanted to follow up on Perth fit-out.')).toBeInTheDocument()
    expect(within(modal).queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument()
    // "Research again" stays in view, greyed out, and says who can switch call prep on.
    expect(within(modal).getByRole('button', { name: 'Research again' })).toBeDisabled()
    expect(
      within(modal).getByText('Call prep is off. An admin can switch it on.'),
    ).toBeInTheDocument()

    // The guided questions: the first is open; ticking it opens the next one.
    const questions = within(modal).getAllByRole('button', { expanded: true })
    expect(questions).toHaveLength(1)
    expect(within(modal).getByText('Tick each one as you ask it.')).toBeInTheDocument()
    const first = within(modal).getAllByRole('checkbox', { name: /^Asked: / })[0]
    if (!first) throw new Error('no question')
    await user.click(first)
    expect(within(modal).getByText(/^1 of \d asked\.$/)).toBeInTheDocument()
    const open = within(modal).getAllByRole('button', { expanded: true })
    expect(open).toHaveLength(1)
    expect(open[0]).not.toBe(questions[0])
    expect(
      within(modal).getAllByText('Who else is involved in decisions about the office?'),
    ).toHaveLength(1)
  })

  it('"Company info" closes the card and opens the company panel', async () => {
    mockApi({ prepStatus: 409 })
    const { user } = renderCompanies()
    await screen.findByText('ABC Logistics')
    await user.type(screen.getByRole('combobox', { name: /Who are you calling/ }), 'jas')
    await user.click(await screen.findByRole('option', { name: /Jason Reeds/ }))
    const modal = await screen.findByRole('dialog', { name: /Jason Reeds/ })
    await user.click(await within(modal).findByRole('button', { name: 'Company info' }))
    await waitFor(() => {
      expect(new URLSearchParams(screen.getByLabelText('Address').textContent).get('company')).toBe(
        '101',
      )
    })
  })

  it('copies the number and says "Copied"', async () => {
    mockApi()
    const { user } = renderCompanies()
    await screen.findByText('ABC Logistics')
    await user.type(screen.getByRole('combobox', { name: /Who are you calling/ }), 'jas')
    await user.click(await screen.findByRole('option', { name: /Jason Reeds/ }))
    const modal = await screen.findByRole('dialog', { name: /Jason Reeds/ })
    // user-event puts its own clipboard in place when it is set up, so the spy goes on that one.
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    await user.click(await within(modal).findByRole('button', { name: 'Copy number' }))
    expect(writeText).toHaveBeenCalledWith('+61 8 9000 1234')
    expect(await within(modal).findByText('Copied')).toBeInTheDocument()
    await act(async () => {
      await Promise.resolve()
    })
  })
})

describe('the HubSpot sync button', () => {
  it('says when our copy was updated, follows a full sync, and refreshes the list after', async () => {
    const running = sync({
      id: 5,
      status: 'running',
      trigger: 'website',
      companies_read: 4200,
      deals_read: 0,
      companies_saved: 0,
      deals_saved: 0,
      started_at: new Date().toISOString(),
      finished_at: null,
    })
    const backend = mockApi({ afterStart: [running, sync()] })
    const { user } = renderCompanies()
    expect(await screen.findByText(/HubSpot copy updated 5 hours ago/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sync with HubSpot' }))
    await waitFor(() => {
      const posted = backend.requests.find((request) => request.url.includes('/hubspot/sync?'))
      expect(posted && new URL(posted.url).searchParams.get('mode')).toBe('full')
    })
    expect(await screen.findByText('Reading companies: 4,200 of about 13,913.')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'HubSpot sync' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Syncing' })).toBeDisabled()

    // It finishes: the next look says what was copied, and the list is read again.
    const listReads = (): number =>
      backend.requests.filter((request) => new URL(request.url).pathname === API).length
    const before = listReads()
    backend.syncs = [
      sync({ id: 5, trigger: 'website', companies_saved: 13916, deals_saved: 8050 }),
      sync(),
    ]
    expect(
      await screen.findByText('HubSpot copy updated', {}, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(screen.getByText('13,916 companies and 8,050 deals copied.')).toBeInTheDocument()
    await waitFor(() => {
      expect(listReads()).toBeGreaterThan(before)
    })
  })
})

describe('on a phone', () => {
  it('lists the companies as cards, and a tap opens the panel with "Prep a call" at the bottom', async () => {
    asPhone()
    mockApi()
    const { user } = renderCompanies()
    const list = await screen.findByRole('list', { name: 'Companies' })
    expect(screen.queryByRole('table', { name: 'Companies' })).not.toBeInTheDocument()
    const card = within(list).getByRole('button', { name: 'ABC Logistics' })
    expect(card).toHaveAccessibleDescription(/Open deal/)
    expect(within(card).getByText('Next lease end')).toBeInTheDocument()
    expect(within(card).getByText('Owner: Levi')).toBeInTheDocument()
    expect(within(list).getByRole('button', { name: 'Zed Mining' })).toHaveTextContent('No owner')
    expect(screen.getByText('1 to 2 of 2')).toBeInTheDocument()

    await user.click(card)
    const panel = await screen.findByRole('dialog', { name: 'ABC Logistics' })
    expect(new URLSearchParams(screen.getByLabelText('Address').textContent).get('company')).toBe(
      '101',
    )
    expect(within(panel).getByRole('button', { name: 'Close' })).toBeInTheDocument()
    const prepButtons = within(panel).getAllByRole('button', { name: 'Prep a call' })
    expect(prepButtons).toHaveLength(1)
    await waitFor(() => {
      expect(within(panel).getByRole('button', { name: 'Prep a call' })).toBeEnabled()
    })
  })

  it('puts the filters behind one Filters button that says how many are in use', async () => {
    asPhone()
    mockApi()
    const { user } = renderCompanies('?city=Perth')
    await screen.findByRole('list', { name: 'Companies' })
    expect(screen.queryByRole('combobox', { name: 'City' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Filters, 1 in use' }))
    const sheet = await screen.findByRole('dialog', { name: 'Filters' })
    expect(within(sheet).getByRole('combobox', { name: 'City' })).toHaveTextContent('Perth')
    expect(within(sheet).getByRole('combobox', { name: 'Deal' })).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Show 2 companies' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Filters' })).not.toBeInTheDocument()
    })
  })

  it('gives the prep card one big Call button, with the copy buttons under it', async () => {
    asPhone()
    mockApi({ prepStatus: 409 })
    const { user } = renderCompanies()
    await screen.findByRole('list', { name: 'Companies' })
    await user.type(screen.getByRole('combobox', { name: /Who are you calling/ }), 'jas')
    await user.click(await screen.findByRole('option', { name: /Jason Reeds/ }))
    const modal = await screen.findByRole('dialog', { name: /Jason Reeds/ })
    const call = await within(modal).findByRole('link', { name: 'Call +61 8 9000 1234' })
    expect(call).toHaveAttribute('href', 'tel:+61890001234')
    expect(within(modal).getByRole('button', { name: 'Copy number' })).toBeInTheDocument()
    expect(within(modal).getByRole('button', { name: 'Copy script' })).toBeInTheDocument()
  })
})
