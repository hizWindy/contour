/**
 * The website side of PLAN-V9: good leads and their cost (D2), the review page (C3), the reject
 * reasons (D1), the People tab and the menu for a person without the Lead Finder tick (E1).
 */
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SignIn } from '@/api/hooks/auth'
import { renderWithProviders } from '@/test/render'
import { visibleModules } from '@/shell/visible-modules'
import { LEAD_FINDER } from './module'
import { costPerGoodLead, goodLeads } from './good-leads-data'
import AdminPeopleTab from './admin/people'
import AdminRunsTab from './admin/runs'
import { RunsTable } from './run/runs-table'
import ResultsPage from './results'

interface Call {
  method: string
  path: string
  search: string
  body: unknown
}
type Answer = (call: Call) => Response | undefined

function mockApi(answers: Record<string, unknown>): Call[] {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const url = new URL(request.url)
      const text = request.method === 'GET' ? '' : await request.text()
      const body: unknown = text ? JSON.parse(text) : null
      const call = { method: request.method, path: url.pathname, search: url.search, body }
      calls.push(call)
      const answer = answers[`${request.method} ${url.pathname}`] ?? answers[url.pathname]
      if (typeof answer === 'function') {
        const response = (answer as Answer)(call)
        if (response) return response
      } else if (answer !== undefined) {
        return Response.json(answer)
      }
      return Response.json({ title: 'Not found', status: 404 }, { status: 404 })
    }),
  )
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const RUN_ID = '11111111-2222-3333-4444-555555555555'

function run(byResult: Record<string, number>, cost = '3.60') {
  return {
    id: RUN_ID,
    app: 'lead_finder',
    mode: 'discovery',
    status: 'done',
    params: { cities: ['Melbourne'] },
    caps: { run_cap_usd: '20', max_companies: 20, company_cap_usd: '2.5', discovery_cap_usd: '8' },
    rules_version: 'v',
    prompt_versions: 'p',
    cost_usd: cost,
    web_searches: 3,
    claude_requests: 4,
    counts: {
      slices: 6,
      slices_done: 6,
      slices_failed: 0,
      candidates: 3,
      unique: 3,
      chosen: 3,
      researched: 3,
      skipped: 0,
      failed: 0,
      by_result: byResult,
      resumes: 0,
    },
    stop_reason: null,
    error: null,
    error_id: null,
    schedule_id: null,
    cancel_requested_at: null,
    created_at: '2026-11-09T09:00:00Z',
    started_at: '2026-11-09T09:00:00Z',
    finished_at: '2026-11-09T09:20:00Z',
  }
}

// --- D2: good leads and the cost of each -----------------------------------------------------

describe('good leads (PLAN-V9 D2)', () => {
  it('counts a Pass and a Director review, and shares the cost over them', () => {
    expect(goodLeads({ by_result: { pass: 1, director_review: 2, watch: 4 } })).toBe(3)
    expect(costPerGoodLead('3.60', 3)).toBe('1.2')
    expect(costPerGoodLead('3.60', 0)).toBeNull()
  })

  it('the Runs list says "no good leads yet" for a run with none, and the cost of each for 3', async () => {
    mockApi({
      '/api/v1/runs/summary': { since: '2026-10-10', days: [], total_cost_usd: '0', total_runs: 0 },
      '/api/v1/lead-finder/leads/reject-reasons': { days: 90, total: 0, reasons: [] },
      '/api/v1/runs': {
        total: 2,
        items: [
          run({ pass: 1, director_review: 2, watch: 4 }),
          { ...run({ watch: 2 }, '1.00'), id: '22222222-2222-3333-4444-555555555555' },
        ],
      },
    })
    // The full list is the Runs page's (Admin shows the newest runs, PLAN-V13 T1-8).
    renderWithProviders(<RunsTable />)
    const table = await screen.findByRole('table', { name: 'Runs' })
    await within(table).findByText('no good leads yet')
    expect(within(table).getByText('US$1.20')).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Good leads' })).toBeInTheDocument()
  })
})

// --- D1: the reasons, counted ------------------------------------------------------------------

describe('reject reasons (PLAN-V9 D1)', () => {
  it('the Runs tab counts the rejected leads by reason over 90 days', async () => {
    mockApi({
      '/api/v1/runs/summary': { since: '2026-10-10', days: [], total_cost_usd: '0', total_runs: 0 },
      '/api/v1/runs': { total: 0, items: [] },
      '/api/v1/lead-finder/leads/reject-reasons': {
        days: 90,
        total: 3,
        reasons: [
          { reason: 'too_small', label: 'Too small', count: 2 },
          { reason: 'bad_timing', label: 'Bad timing', count: 1 },
          { reason: 'other', label: 'Other', count: 0 },
        ],
      },
    })
    renderWithProviders(<AdminRunsTab />)
    expect(await screen.findByText(/3 rejected in the last 90 days/)).toBeInTheDocument()
    const reasons = screen.getByLabelText('Rejected leads by reason')
    expect(within(reasons).getByText('Too small')).toBeInTheDocument()
    expect(within(reasons).getByText('2')).toBeInTheDocument()
  })
})

// --- C3: the review page -------------------------------------------------------------------------

const LEAD_ROW = {
  id: '99999999-2222-3333-4444-555555555555',
  company: 'Sample Energy',
  result: 'pass',
  score: 80,
  score_checked: 90,
  band: 'research_first',
  city: 'Melbourne',
  suburb: null,
  industry: 'Energy',
  staff_in_city: 120,
  office_m2: 1200,
  trigger_id: 'hot_industry_growth',
  trigger_label: 'Growing because its industry is booming',
  trigger_date: '2026-10-01',
  hubspot_status: 'new',
  hubspot_owner: null,
  status: 'new',
  origin: 'web',
  is_test: false,
  useful: null,
  note: null,
  cost_usd: '0.40',
  web_searches: 3,
  created_at: '2026-11-09T09:10:00Z',
  updated_at: '2026-11-09T09:10:00Z',
  run_id: RUN_ID,
  contact_role: null,
}

function reviewApi(writeEnabled: boolean): Call[] {
  return mockApi({
    '/api/v1/lead-finder/leads': { total: 1, items: [LEAD_ROW] },
    '/api/v1/lead-finder/leads/facets': {
      result: [{ value: 'pass', count: 1 }],
      city: [{ value: 'Melbourne', count: 1 }],
      trigger: [],
      industry: [],
      industry_group: [],
      hubspot_status: [{ value: 'new', count: 1 }],
      status: [{ value: 'new', count: 1 }],
      origin: [{ value: 'web', count: 1 }],
      runs: [],
      score: { min: 80, max: 80 },
      office_m2: { min: 1200, max: 1200 },
      created: { min: '2026-11-09', max: '2026-11-09' },
    },
    [`/api/v1/lead-finder/review/${RUN_ID}`]: {
      run_id: RUN_ID,
      cities: ['Melbourne'],
      status: 'done',
      scheduled: true,
      good_leads: 3,
      watch: 4,
      drop: 5,
      cost_usd: '3.60',
      cost_per_good_lead_usd: '1.20',
      hubspot_write_enabled: writeEnabled,
      hubspot_write_off: writeEnabled ? null : 'HubSpot writing is off',
    },
    'POST /api/v1/lead-finder/review/status': {
      done: 1,
      failed: 0,
      items: [{ lead_id: LEAD_ROW.id, company: 'Sample Energy', ok: true, problem: null }],
    },
    'POST /api/v1/lead-finder/review/send': {
      done: 0,
      failed: 1,
      items: [
        { lead_id: LEAD_ROW.id, company: 'Sample Energy', ok: false, problem: 'It answered 500.' },
      ],
    },
  })
}

describe('the review page (PLAN-V9 C3)', () => {
  it("shows the run's numbers, and greys out sending while HubSpot writing is off", async () => {
    reviewApi(false)
    const { user } = renderWithProviders(<ResultsPage />, { route: `/results?run_id=${RUN_ID}` })
    const bar = await screen.findByRole('region', { name: "Review this run's leads" })
    expect(
      await within(bar).findByText(/3 good leads \(Pass or Director review\)/),
    ).toBeInTheDocument()
    expect(within(bar).getByText('US$1.20')).toBeInTheDocument()
    const send = within(bar).getByRole('button', { name: 'Approve and send to HubSpot' })
    expect(send).toBeDisabled()
    expect(within(bar).getByText(/HubSpot writing is off/)).toBeInTheDocument()

    await user.click(await screen.findByRole('checkbox', { name: 'Tick Sample Energy' }))
    expect(within(bar).getByText('1 lead ticked')).toBeInTheDocument()
    expect(send).toBeDisabled() // still off: writing waits for HubSpot access
    expect(within(bar).getByRole('button', { name: 'Watch' })).toBeEnabled()
  })

  it('rejects the ticked leads with a reason, and says which failed when sending', async () => {
    const calls = reviewApi(true)
    const { user } = renderWithProviders(<ResultsPage />, { route: `/results?run_id=${RUN_ID}` })
    const bar = await screen.findByRole('region', { name: "Review this run's leads" })
    await user.click(await screen.findByRole('checkbox', { name: 'Tick every lead on this page' }))

    await user.click(within(bar).getByRole('button', { name: 'Reject' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reject 1 lead' })
    await user.click(within(dialog).getByRole('radio', { name: 'Wrong industry' }))
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }))
    await waitFor(() => {
      expect(calls.find((call) => call.path.endsWith('/review/status'))?.body).toEqual({
        lead_ids: [LEAD_ROW.id],
        status: 'rejected',
        reject_reason: 'wrong_industry',
        reject_note: null,
      })
    })

    await user.click(await screen.findByRole('checkbox', { name: 'Tick Sample Energy' }))
    await user.click(within(bar).getByRole('button', { name: 'Approve and send to HubSpot' }))
    expect(await screen.findByText('0 leads sent to HubSpot. 1 lead failed.')).toBeInTheDocument()
    expect(screen.getByText(/Sample Energy: It answered 500\./)).toBeInTheDocument()
  })

  it('shows no tick boxes on the plain results page', async () => {
    reviewApi(true)
    renderWithProviders(<ResultsPage />, { route: '/results' })
    await screen.findByText('Sample Energy')
    expect(screen.queryByRole('checkbox', { name: 'Tick Sample Energy' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: "Review this run's leads" }),
    ).not.toBeInTheDocument()
  })
})

// --- E1: the People tab and the menu ----------------------------------------------------------

const ADMIN = {
  id: 'aaaaaaaa-2222-3333-4444-555555555555',
  name: 'Al Khair',
  email: 'al@example.test',
  username: 'alkhair',
  role: 'admin',
  apps: [],
  active: true,
  created_at: '2026-11-05T00:00:00Z',
  last_signed_in_at: '2026-11-08T00:00:00Z',
}
const MARCUS = {
  ...ADMIN,
  id: 'bbbbbbbb-2222-3333-4444-555555555555',
  name: 'Marcus Lee',
  email: 'marcus@example.test',
  username: null,
  role: 'staff',
  apps: [],
  last_signed_in_at: null,
}

describe('the People tab (PLAN-V9 E1)', () => {
  it('ticks the Lead Finder for a person, and an Admin needs no tick', async () => {
    const calls = mockApi({
      '/api/v1/auth/me': { auth_required: false, user: null, session: null },
      'GET /api/v1/people': [ADMIN, MARCUS],
      [`PATCH /api/v1/people/${MARCUS.id}`]: { ...MARCUS, apps: ['lead_finder'] },
    })
    const { user } = renderWithProviders(<AdminPeopleTab />)
    await screen.findByRole('table', { name: 'People' })
    await user.click(screen.getByRole('button', { name: 'Edit Al Khair' }))
    const adminTick = within(await screen.findByRole('dialog')).getByRole('checkbox', {
      name: /Lead Finder/,
    })
    expect(adminTick).toBeChecked()
    expect(adminTick).toBeDisabled()
    await user.keyboard('{Escape}')
    await user.click(await screen.findByRole('button', { name: 'Edit Marcus Lee' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('checkbox', { name: /Lead Finder/ }),
    )
    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ apps: ['lead_finder'] })
    })
  })

  it('ticks the Companies page too, one tick per project (PLAN-V10 B1)', async () => {
    const calls = mockApi({
      '/api/v1/auth/me': { auth_required: false, user: null, session: null },
      'GET /api/v1/people': [ADMIN, { ...MARCUS, apps: ['lead_finder'] }],
      [`PATCH /api/v1/people/${MARCUS.id}`]: { ...MARCUS, apps: ['lead_finder', 'companies'] },
    })
    const { user } = renderWithProviders(<AdminPeopleTab />)
    await screen.findByRole('table', { name: 'People' })
    await user.click(screen.getByRole('button', { name: 'Edit Al Khair' }))
    const adminTick = within(await screen.findByRole('dialog')).getByRole('checkbox', {
      name: /Companies/,
    })
    expect(adminTick).toBeChecked()
    expect(adminTick).toBeDisabled()
    await user.keyboard('{Escape}')
    await user.click(await screen.findByRole('button', { name: 'Edit Marcus Lee' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('checkbox', { name: /Companies/ }),
    )
    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
        apps: ['lead_finder', 'companies'],
      })
    })
  })

  it('adds a person with the tick and a starting password', async () => {
    const calls = mockApi({
      '/api/v1/auth/me': { auth_required: false, user: null, session: null },
      'GET /api/v1/people': [ADMIN],
      'POST /api/v1/people': { ...MARCUS, apps: ['lead_finder'] },
    })
    const { user } = renderWithProviders(<AdminPeopleTab />)
    await screen.findByRole('table', { name: 'People' })
    await user.click(screen.getByRole('button', { name: 'Add a person' }))
    await screen.findByRole('dialog')
    await user.type(screen.getByLabelText('Name'), 'Marcus Lee')
    await user.type(screen.getByLabelText('Email'), 'marcus@example.test')
    await user.type(screen.getByLabelText('Starting password'), 'tulip harbour bicycle moonlight')
    await user.click(screen.getByRole('button', { name: 'Add the person' }))
    await waitFor(() => {
      expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
        name: 'Marcus Lee',
        email: 'marcus@example.test',
        role: 'staff',
        apps: ['lead_finder'],
        password: 'tulip harbour bicycle moonlight',
      })
    })
  })
})

describe('the menu for a person without the tick (PLAN-V9 E1)', () => {
  const signedIn = (role: 'admin' | 'staff', apps: string[]): SignIn => ({
    state: 'signed_in',
    user: { id: 'x', email: 'x@example.test', username: null, name: 'X', role, apps },
  })

  it('hides the Lead Finder from staff without the tick only', () => {
    expect(visibleModules(signedIn('staff', []), [LEAD_FINDER])).toEqual([])
    expect(visibleModules(signedIn('staff', ['lead_finder']), [LEAD_FINDER])).toEqual([LEAD_FINDER])
    expect(visibleModules(signedIn('admin', []), [LEAD_FINDER])).toEqual([LEAD_FINDER])
    expect(visibleModules({ state: 'off' }, [LEAD_FINDER])).toEqual([LEAD_FINDER])
  })
})
