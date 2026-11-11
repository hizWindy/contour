import { screen, within } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { melbourneDate } from '@/lib/format'
import { PLANNED } from '@/modules'
import { mockApi } from '@/test/mock-api'
import { renderWithProviders } from '@/test/render'
import HomePage from './home'

const RUN = {
  id: '11111111-2222-3333-4444-555555555555',
  app: 'lead_finder',
  status: 'done',
  mode: 'discovery',
  params: { cities: ['Perth'] },
  created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
  cost_usd: '5.48',
  counts: { researched: 4, by_result: { pass: 1, director_review: 1, watch: 3 } },
}

const RESULTS = [
  { value: 'pass', count: 4 },
  { value: 'director_review', count: 8 },
  { value: 'watch', count: 30 },
  { value: 'drop', count: 0 },
]

const TRIGGERS = [
  { id: 'hiring', label: 'Hiring push', count: 8 },
  { id: 'merger', label: 'Merger or acquisition', count: 15 },
  { id: 'contract', label: 'Big new contract', count: 9 },
  { id: 'restructure', label: 'Restructure', count: 4 },
  { id: 'lease', label: 'Lease ending', count: 2 },
  { id: 'none', label: 'Nothing seen', count: 0 },
]

const LEAD = {
  id: '99999999-2222-3333-4444-555555555555',
  company: 'KBR',
  city: 'Perth',
  result: 'director_review',
  score: 76,
  trigger_label: 'Merger or acquisition',
  trigger_date: '2026-11-03',
  reason: 'A merger means two offices become one.',
}

const TODAY = melbourneDate()

const SUMMARY = {
  since: '2026-10-13',
  total_cost_usd: '42.81',
  total_runs: 8,
  days: [
    { date: '2026-10-27', runs: 1, cost_usd: '5.00' },
    { date: '2026-10-28', runs: 1, cost_usd: '1.50' },
    { date: TODAY, runs: 2, cost_usd: '8.42' },
  ],
}

interface Backend {
  runs?: unknown[]
  results?: Array<{ value: string; count: number }>
  triggers?: unknown[]
  leads?: unknown[]
  summary?: unknown
  preps?: unknown[]
  me?: Response
  fail?: boolean
}

/** A backend for every card on Home, or one that can't be reached. */
function stubBackend({
  runs = [RUN],
  results = RESULTS,
  triggers = TRIGGERS,
  leads = [LEAD],
  summary = SUMMARY,
  preps = [],
  me,
  fail = false,
}: Backend = {}) {
  if (fail) {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    return []
  }
  return mockApi({
    '/api/v1/auth/me': () => me,
    '/api/v1/runs': { items: runs, total: runs.length },
    '/api/v1/lead-finder/leads/facets': { result: results, trigger: triggers },
    '/api/v1/lead-finder/leads': { items: leads, total: leads.length },
    '/api/v1/runs/summary': summary,
    '/api/v1/companies': { items: [], total: 13918, leads_shown: false },
    '/api/v1/hubspot/syncs': [
      {
        id: 1,
        status: 'done',
        mode: 'changes',
        started_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
        finished_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
      },
    ],
    '/api/v1/companies/preps/today': preps,
  })
}

const leadFinder = () => screen.getByRole('region', { name: 'Lead Finder' })
const companies = () => screen.getByRole('region', { name: 'Companies' })
const cost = () => screen.getByRole('region', { name: 'Runs and cost' })

describe('the greeting on Home', () => {
  it('greets by first name and says what the last run did', async () => {
    stubBackend({
      me: Response.json({
        auth_required: true,
        user: {
          id: 'u1',
          email: 'khair@example.test',
          username: 'khair',
          name: 'Al-khair M. Pama',
          role: 'admin',
          apps: [],
        },
        session: null,
      }),
    })
    renderWithProviders(<HomePage />)

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /^Good (morning|afternoon|evening), Al-khair$/,
      }),
    ).toBeInTheDocument()
    expect(
      await screen.findByText(
        /checked 4 companies in Perth and found 2 good leads and 3 to watch\.$/,
      ),
    ).toBeInTheDocument()
  })

  it('greets without a name where sign-in is off, and says when there are no runs', async () => {
    stubBackend({ runs: [] })
    renderWithProviders(<HomePage />)

    expect(
      screen.getByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening)$/ }),
    ).toBeInTheDocument()
    expect(await screen.findByText('No runs yet. Start one to find leads.')).toBeInTheDocument()
  })
})

describe('the Lead Finder card on Home', () => {
  it('counts the good leads and shows every result as a link to Results', async () => {
    stubBackend()
    renderWithProviders(<HomePage />)

    const count = await within(leadFinder()).findByRole('link', {
      name: '12 good leads: open them in Results',
    })
    expect(count).toHaveAttribute('href', '/results?result=pass&result=director_review')
    expect(
      within(leadFinder()).getByText('4 pass and 8 for the director, out of 42 found.'),
    ).toBeInTheDocument()
    expect(within(leadFinder()).getByRole('link', { name: 'Pass: 4 leads' })).toHaveAttribute(
      'href',
      '/results?result=pass',
    )
    expect(
      within(leadFinder()).getByRole('link', { name: 'Director review: 8 leads' }),
    ).toHaveAttribute('href', '/results?result=director_review')
    // A result with no leads is left out, of the legend and of the bar.
    expect(within(leadFinder()).queryByRole('link', { name: /^Drop/ })).toBeNull()
    expect(
      within(leadFinder()).getByRole('img', {
        name: 'All 42 leads by result: Pass 4, Director review 8, Watch 30.',
      }),
    ).toBeInTheDocument()
  })

  it('lists the four signs seen most, biggest first, each a link to Results', async () => {
    stubBackend()
    renderWithProviders(<HomePage />)

    const signs = within(
      await within(leadFinder()).findByRole('region', { name: 'Signs seen most' }),
    )
    const links = signs.getAllByRole('link')
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      'Merger or acquisition: 15 leads',
      'Big new contract: 9 leads',
      'Hiring push: 8 leads',
      'Restructure: 4 leads',
    ])
    expect(links[0]).toHaveAttribute('href', '/results?trigger=merger')
    expect(signs.getByText('across 42 leads')).toBeInTheDocument()
  })

  it('says which leads to start with: the best new good leads, with why now', async () => {
    const calls = stubBackend()
    renderWithProviders(<HomePage />)

    const start = within(
      await within(leadFinder()).findByRole('region', { name: 'Start with these' }),
    )
    const lead = await start.findByRole('link', { name: /KBR/ })
    expect(lead).toHaveAttribute('href', `/leads/${LEAD.id}`)
    expect(within(lead).getByText('Merger or acquisition, 3 Nov 2026')).toBeInTheDocument()
    expect(within(lead).getByLabelText('Score 76')).toBeInTheDocument()

    const asked = calls.find((call) => call.path === '/api/v1/lead-finder/leads')
    const query = new URLSearchParams(asked?.search)
    expect(query.getAll('result')).toEqual(['pass', 'director_review'])
    expect(query.getAll('status')).toEqual(['new'])
    expect(query.get('sort')).toBe('score')
  })

  it('shows the last run and the one main button', async () => {
    stubBackend()
    renderWithProviders(<HomePage />)

    expect(await within(leadFinder()).findByRole('link', { name: '2 hours ago' })).toHaveAttribute(
      'href',
      `/runs/${RUN.id}`,
    )
    expect(within(leadFinder()).getByText('US$5.48')).toBeInTheDocument()
    expect(within(leadFinder()).getByRole('link', { name: 'Start a run' })).toHaveAttribute(
      'href',
      '/start',
    )
  })

  it('says so plainly when there are no leads yet', async () => {
    stubBackend({ runs: [], results: [], triggers: [], leads: [] })
    renderWithProviders(<HomePage />)

    expect(await within(leadFinder()).findByText('No leads yet.')).toBeInTheDocument()
    expect(
      await within(leadFinder()).findByText(/Every good lead has been looked at/),
    ).toBeInTheDocument()
    expect(within(leadFinder()).queryByRole('region', { name: 'Signs seen most' })).toBeNull()
  })

  it('keeps its links when the backend cannot be reached', async () => {
    stubBackend({ fail: true })
    renderWithProviders(<HomePage />)

    expect(
      await within(leadFinder()).findByText("Can't load the leads right now."),
    ).toBeInTheDocument()
    expect(
      await within(leadFinder()).findByText("Can't load the runs right now."),
    ).toBeInTheDocument()
    expect(within(leadFinder()).getByRole('link', { name: 'Start a run' })).toHaveAttribute(
      'href',
      '/start',
    )
    expect(within(leadFinder()).getByRole('link', { name: 'Open results' })).toHaveAttribute(
      'href',
      '/results',
    )
  })
})

function Where() {
  const location = useLocation()
  return <p>At {`${location.pathname}${location.search}`}</p>
}

describe('the Companies card on Home', () => {
  it('counts the companies and says how fresh the HubSpot copy is', async () => {
    stubBackend()
    renderWithProviders(<HomePage />)

    expect(await within(companies()).findByText('13,918')).toBeInTheDocument()
    expect(within(companies()).getByText(/clients and prospects/)).toBeInTheDocument()
    expect(
      await within(companies()).findByText(/Copied from HubSpot 3 hours ago\./),
    ).toBeInTheDocument()
    expect(within(companies()).getByText('No calls prepped today.')).toBeInTheDocument()
  })

  it('opens Companies with the name typed in the box', async () => {
    stubBackend()
    const { user } = renderWithProviders(
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/companies" element={<Where />} />
      </Routes>,
    )

    const box = within(companies()).getByRole('searchbox', {
      name: 'Find a company and prep a call',
    })
    await user.type(box, 'Culture Amp{Enter}')
    expect(await screen.findByText('At /companies?q=Culture+Amp')).toBeInTheDocument()
  })

  it('lists the calls prepped today, each opening its company', async () => {
    stubBackend({
      preps: [
        {
          id: 'p1',
          company_key: 'hs-42',
          company_name: 'Culture Amp',
          person_name: 'Jo Smith',
          kind: 'person',
          status: 'ready',
          created_at: new Date().toISOString(),
        },
      ],
    })
    renderWithProviders(<HomePage />)

    const prepped = within(
      await within(companies()).findByRole('region', { name: 'Prepped today' }),
    )
    expect(prepped.getByRole('link', { name: 'Jo Smith, Culture Amp' })).toHaveAttribute(
      'href',
      '/companies?company=hs-42',
    )
  })
})

describe('Runs and cost on Home', () => {
  it('shows the spend over 30 days and a bar for each day with a run', async () => {
    stubBackend()
    renderWithProviders(<HomePage />)

    expect(await within(cost()).findByText('US$42.81')).toBeInTheDocument()
    expect(within(cost()).getByText('8 runs since 13 Oct. Today US$8.42.')).toBeInTheDocument()
    const bars = within(within(cost()).getByRole('list', { name: 'Spend on each day with a run' }))
    expect(bars.getAllByRole('listitem')).toHaveLength(3)
    expect(bars.getByText('Today: 2 runs, US$8.42.')).toBeInTheDocument()
    expect(
      within(cost()).getByRole('link', { name: 'Open Runs and cost in Admin' }),
    ).toHaveAttribute('href', '/admin/runs')
  })

  it('says so when there were no runs', async () => {
    stubBackend({ summary: { since: '2026-10-13', total_cost_usd: '0', total_runs: 0, days: [] } })
    renderWithProviders(<HomePage />)

    expect(await within(cost()).findByText('No runs in the last 30 days.')).toBeInTheDocument()
  })
})

describe('the projects still to be developed on Home', () => {
  it('gives each project in the queue its own card, and lists the rest under Later', () => {
    stubBackend()
    renderWithProviders(<HomePage />)

    const section = within(screen.getByRole('region', { name: 'To be developed' }))
    const queued = PLANNED.filter((project) => project.when)
    expect(queued.length).toBeGreaterThan(0)
    for (const project of queued) {
      const heading = section.getByRole('heading', { level: 3, name: project.name })
      expect(within(heading).getByRole('link')).toHaveAttribute('href', project.to)
    }
    const later = section.getByText('Later').parentElement as HTMLElement
    for (const project of PLANNED.filter((item) => !item.when)) {
      expect(within(later).getByRole('link', { name: project.name })).toHaveAttribute(
        'href',
        project.to,
      )
    }
  })
})
