import { screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import AdminHubSpotTab from './hubspot'
import AdminMemoryTab from './memory'
import AdminRulesTab from './rules'
import AdminRunsTab from './runs'
import AdminSearchesTab from './searches'
import AdminSettingsTab from './settings'
import AdminTestsTab from './tests'

const RUN_ID = '0f3c9a2e-1111-2222-3333-444444444444'

interface Call {
  method: string
  path: string
  search: string
  body: unknown
}

type Answer = (call: Call) => Response | undefined

/** Answers by path; records every call. A path with no answer is a 404. */
function mockApi(answers: Record<string, unknown>): Call[] {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const url = new URL(request.url)
      const text = request.method === 'GET' ? '' : await request.text()
      let body: unknown = text
      try {
        body = text ? JSON.parse(text) : null
      } catch {
        body = text
      }
      const call = { method: request.method, path: url.pathname, search: url.search, body }
      calls.push(call)
      const answer = answers[url.pathname]
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

const SETTING = {
  key: 'run_cap_usd',
  label: 'Cap for one run (US$)',
  description: 'The most one run may cost.',
  type: 'decimal',
  min: '1.00',
  max: '50.00',
  choices: null,
  default: '20.00',
  value: '20.00',
  overridden: false,
  editable: true,
}

function settingsOut(changes: Record<string, unknown> = {}) {
  return {
    daily_left_usd: '48.50',
    fields: [
      { ...SETTING, ...changes },
      {
        key: 'hubspot_names_to_claude_ok',
        label: 'HubSpot names may go to Claude',
        description: 'The data approval from Levi.',
        type: 'bool',
        min: null,
        max: null,
        choices: null,
        default: false,
        value: false,
        overridden: false,
        editable: false,
      },
    ],
  }
}

describe('Admin, Settings', () => {
  it('saves only what changed, and shows the server refusing a value beside its field', async () => {
    const calls = mockApi({
      '/api/v1/settings': (call: Call) =>
        call.method === 'PATCH'
          ? Response.json(
              {
                title: "The settings aren't valid",
                status: 422,
                errors: [{ field: 'body.values.run_cap_usd', message: 'Must be at most 50.00.' }],
              },
              { status: 422 },
            )
          : Response.json(settingsOut()),
    })
    const { user } = renderWithProviders(<AdminSettingsTab />)
    const input = await screen.findByLabelText('Cap for one run (US$)')
    expect(screen.getByText('US$48.50')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()

    await user.clear(input)
    await user.type(input, '75')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Must be at most 50.00.')).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      values: { run_cap_usd: '75' },
    })
    // The approval from Levi is read only.
    expect(screen.getByText('HubSpot names may go to Claude')).toBeInTheDocument()
    expect(screen.queryByLabelText('HubSpot names may go to Claude')).not.toBeInTheDocument()
  })

  it('puts a changed setting back to its default', async () => {
    const calls = mockApi({
      '/api/v1/settings': settingsOut({ value: '15.00', overridden: true }),
      '/api/v1/settings/run_cap_usd': settingsOut(),
    })
    const { user } = renderWithProviders(<AdminSettingsTab />)
    await user.click(await screen.findByRole('button', { name: 'Use the default' }))
    await waitFor(() => {
      expect(calls.some((call) => call.method === 'DELETE')).toBe(true)
    })
  })
})

describe('Admin, Test set', () => {
  it('lists past runs with their scores, shows the report and runs it after asking', async () => {
    const calls = mockApi({
      '/api/v1/lead-finder/tests': {
        total: 1,
        items: [
          {
            run_id: RUN_ID,
            created_at: '2026-10-26T04:00:00Z',
            status: 'done',
            companies: 10,
            expected: 1,
            matched: 1,
            avg_cost_usd: '0.40',
            total_cost_usd: '4.00',
            rules_version: 'r1',
            prompt_versions: 'p1',
          },
        ],
      },
      [`/api/v1/lead-finder/tests/${RUN_ID}`]: {
        summary: {},
        items: [
          {
            name: 'Canva',
            city: 'Sydney',
            expected: ['director_review', 'watch', 'drop'],
            result: 'director_review',
            score: 40,
            unknown_facts: ['owner'],
            cost_usd: '0.40',
            ok: true,
            lead_id: 'x',
            note: null,
          },
        ],
      },
      '/api/v1/lead-finder/tests/run': (call: Call) =>
        call.method === 'POST' ? Response.json({ id: RUN_ID }, { status: 201 }) : undefined,
    })
    const { user } = renderWithProviders(
      <Routes>
        <Route path="/" element={<AdminTestsTab />} />
        <Route path="/runs/:runId" element={<p>The test run</p>} />
      </Routes>,
    )
    const runs = await screen.findByRole('table', { name: 'Test set runs' })
    expect(await within(runs).findByText('1 of 1')).toBeInTheDocument()
    const report = await screen.findByRole('table', { name: 'Test report' })
    expect(await within(report).findByText('Canva')).toBeInTheDocument()
    expect(within(report).getByText('Director review or Watch or Drop')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Run the test set' }))
    await user.click(await screen.findByRole('button', { name: 'Run it' }))
    expect(await screen.findByText('The test run')).toBeInTheDocument()
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1)
  })
})

describe('Admin, HubSpot', () => {
  it('shows the local copy, the watchlist and keeps Upload off until a file is chosen', async () => {
    mockApi({
      '/api/v1/hubspot/summary': {
        companies: 100,
        offices: 185,
        deals: 12,
        last_imported_at: '2026-10-25T01:00:00Z',
      },
      '/api/v1/lead-finder/watchlist': {
        total: 1,
        items: [
          {
            hubspot_id: '1',
            name: 'Synechron Australia',
            city: 'Melbourne',
            industry: 'Information Technology And Services',
            office_based: 'likely',
            linkedin_staff: 120,
            estimated_staff: 240,
            owner: null,
            last_dissolved: null,
            note: null,
          },
        ],
        director: [],
        staff_unknown: [],
        counts: {
          companies: 99,
          watch: 47,
          likely: 11,
          unlikely: 36,
          director: 15,
          open_deal: 7,
          dropped_small: 21,
          staff_unknown: 1,
          no_office: 10,
        },
      },
    })
    const { user } = renderWithProviders(<AdminHubSpotTab />)
    expect(await screen.findByText('Synechron Australia')).toBeInTheDocument()
    expect(screen.getByText(/47 to watch \(11 likely/)).toBeInTheDocument()
    // The export upload is the backup now, folded away until opened.
    expect(screen.queryByRole('button', { name: 'Upload' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Backup: upload an export' }))
    expect(await screen.findByText('100 companies, 185 offices, 12 deals.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled()
  })

  it('shows the connection, each permission and project, and starts a sync', async () => {
    const calls = mockApi({
      '/api/v1/hubspot/status': HUBSPOT_STATUS,
      '/api/v1/hubspot/writes': [],
      '/api/v1/hubspot/sync': (call: Call) =>
        call.method === 'POST'
          ? Response.json(
              {
                id: 1,
                mode: 'full',
                trigger: 'website',
                status: 'running',
                changed_since: null,
                companies_read: 0,
                deals_read: 0,
                owners_read: 0,
                companies_saved: 0,
                offices_saved: 0,
                deals_saved: 0,
                deals_skipped: 0,
                companies_removed: 0,
                deals_removed: 0,
                profiles_rebuilt: 0,
                error: null,
                warnings: [],
                started_at: '2026-11-04T01:00:00Z',
                finished_at: null,
              },
              { status: 202 },
            )
          : undefined,
    })
    const { user } = renderWithProviders(<AdminHubSpotTab />)
    expect(await screen.findByText('Yes, account 1234567')).toBeInTheDocument()
    expect(screen.getByText(/Off \(HUBSPOT_WRITE_ENABLED\)/)).toBeInTheDocument()
    const permissions = screen.getByRole('list', { name: 'Permissions' })
    expect(permissions).toHaveTextContent('Yes: Read companies')
    expect(permissions).toHaveTextContent('No: Add and update companies')
    expect(
      screen.getByText(
        'Lead Finder: reading ready. Sending waits for crm.objects.companies.write.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/No sync yet/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sync now' }))
    await waitFor(() => {
      expect(
        calls.some((call) => call.method === 'POST' && call.path === '/api/v1/hubspot/sync'),
      ).toBe(true)
    })
    expect(calls.find((call) => call.path === '/api/v1/hubspot/sync')?.search).toBe('?mode=auto')
    expect(JSON.stringify(calls)).not.toContain('pat-') // no key ever travels to the page
  })
})

const HUBSPOT_STATUS = {
  key_set: true,
  api_version: '2026-09',
  write_enabled: false,
  check: {
    key_set: true,
    connected: true,
    portal_id: 1234567,
    problem: null,
    checked_at: '2026-11-04T01:00:00Z',
    scopes: [
      {
        scope: 'crm.objects.companies.read',
        access: 'read',
        label: 'Read companies',
        state: 'yes',
        detail: null,
      },
      {
        scope: 'crm.objects.companies.write',
        access: 'write',
        label: 'Add and update companies, and add notes to them',
        state: 'no',
        detail: 'HubSpot said this permission is missing.',
      },
    ],
  },
  projects: [
    {
      app: 'lead_finder',
      title: 'Lead Finder',
      uses: 'Reads companies for the watchlist.',
      reading: 'ready',
      sending: 'waiting',
      waiting_for: ['crm.objects.companies.write'],
      summary: 'Lead Finder: reading ready. Sending waits for crm.objects.companies.write.',
    },
  ],
  running_sync: null,
  last_good_sync: null,
  recent_syncs: [],
  copy_counts: {
    companies: 0,
    offices: 0,
    deals: 0,
    owners: 0,
    last_imported_at: null,
    companies_by_source: { export: 0, api: 0 },
  },
}

const RULES_V2 = {
  version: 'abc123',
  criteria: {
    cities: { pass: ['Melbourne'], director_review: ['Sydney'], other_cities: 'director_review' },
    size: {
      staff_min: 100,
      staff_hint_min: 75,
      staff_floor: 50,
      growth_signs: ['fast_growth', 'new_to_australia'],
      staff_max: 600,
      staff_counted_in: 'city',
      linkedin_staff_multiplier: 2,
      office_m2_min: 1000,
      office_m2_max: 6000,
      director_band_m2: [800, 1000],
      grow_into_range_months: 24,
      staff_sources: ['hubspot', 'headcount_tool', 'linkedin', 'web_research'],
    },
    data_sources: {
      company_details: ['headcount_tool', 'web_research'],
      office_cities: ['headcount_tool', 'web_research'],
      decision_makers: ['headcount_tool', 'web_research'],
    },
    conflicts: { staff_gap_ratio: 2 },
    score: {
      parts: {
        trigger: { label: 'Business or property trigger', points: 25 },
        size: { label: 'Project size', points: 20 },
      },
      bands: { research_first: 75, investigate: 50 },
      band_basis: 'scaled',
    },
    office_age: {
      due_years: 5,
      recent_move_years: 3,
      just_moved_months: 12,
      tenure_years: 8,
      tenure_sign: 'long_tenure',
    },
    stages: { pass: 'Active prospect', watch: 'Target account' },
    triggers: {
      main: [],
      other: [],
      weak: [],
      recent_months: 12,
      window_years: 3,
      best_window_years: [1, 3],
    },
    rivals: {
      enabled: true,
      tiers: ['tier_1', 'tier_2'],
      per_lead: 5,
      per_run: 5,
      max_searches: 2,
      sign: 'rival_growth',
    },
    never_suggest: {
      already_sent: true,
      open_deal: true,
      dissolved_deal_wait_months: 12,
      do_not_contact: true,
    },
    tbc: [],
    source_domains: { blocked: ['propertydaily.com.au'] },
  },
  watchlist: { tbc: [] },
}

describe('Admin, Rules', () => {
  it('lists what is still to be confirmed with Levi', async () => {
    mockApi({
      '/api/v1/lead-finder/rules': {
        version: 'abc123',
        criteria: {
          cities: { pass: ['Melbourne'], director_review: ['Sydney'], other_cities: 'drop' },
          size: {
            staff_min: 100,
            staff_hint_min: 75,
            staff_floor: 50,
            growth_signs: ['fast_growth', 'new_to_australia'],
            staff_max: 600,
            staff_counted_in: 'city',
            linkedin_staff_multiplier: 2,
            office_m2_min: 1000,
            office_m2_max: 6000,
            director_band_m2: [800, 1000],
            grow_into_range_months: 24,
            staff_sources: ['hubspot', 'headcount_tool', 'linkedin', 'web_research'],
          },
          data_sources: {
            company_details: ['headcount_tool', 'web_research'],
            office_cities: ['headcount_tool', 'web_research'],
            decision_makers: ['headcount_tool', 'web_research'],
          },
          conflicts: { staff_gap_ratio: 2 },
          score: {
            parts: {
              trigger: { label: 'Business or property trigger', points: 25 },
              size: { label: 'Project size', points: 20 },
            },
            bands: { research_first: 75, investigate: 50 },
            band_basis: 'scaled',
          },
          office_age: {
            due_years: 5,
            recent_move_years: 3,
            just_moved_months: 12,
            tenure_years: 8,
            tenure_sign: 'long_tenure',
          },
          stages: { pass: 'Active prospect', watch: 'Target account' },
          triggers: {
            main: [{ id: 'lease_ending', label: 'Lease ending in 1 to 3 years' }],
            other: [],
            weak: [],
            recent_months: 12,
            window_years: 3,
            best_window_years: [1, 3],
          },
          rivals: {
            enabled: true,
            tiers: ['tier_1', 'tier_2'],
            per_lead: 5,
            per_run: 5,
            max_searches: 2,
            sign: 'rival_growth',
          },
          never_suggest: {
            already_sent: true,
            open_deal: true,
            dissolved_deal_wait_months: 12,
            do_not_contact: true,
          },
          tbc: [{ key: 'size.m2_per_staff', note: 'Is 10 m² per person right?' }],
          source_domains: { blocked: ['propertydaily.com.au'] },
        },
        watchlist: { tbc: [] },
      },
    })
    renderWithProviders(<AdminRulesTab />)
    expect(await screen.findByText('size.m2_per_staff')).toBeInTheDocument()
    expect(screen.getByText('Is 10 m² per person right?')).toBeInTheDocument()
    expect(screen.getByText('TBC')).toBeInTheDocument()
    expect(screen.getByText(/propertydaily\.com\.au/)).toBeInTheDocument()
  })

  it('shows the version 2 rules: the staff hint, the six parts, the bands and the stages', async () => {
    mockApi({
      '/api/v1/lead-finder/rules': RULES_V2,
    })
    renderWithProviders(<AdminRulesTab />)
    expect(await screen.findByText(/75\s*\+ fits; 50 to 74 is a Watch/)).toBeInTheDocument()
    expect(screen.getByText(/under 50 is a Drop, too small/)).toBeInTheDocument()
    expect(screen.getByText(/up to 5 of its rivals in the same city/)).toBeInTheDocument()
    expect(screen.getByText('Business or property trigger: 25 points')).toBeInTheDocument()
    expect(
      screen.getByText(/75 to 100 research first, 50 to 74 investigate, under 50 nurture/),
    ).toBeInTheDocument()
    expect(screen.getByText(/scaled to the points checked/)).toBeInTheDocument()
    expect(screen.getByText('Pass: Active prospect')).toBeInTheDocument()
    expect(screen.getByText('Watch: Target account')).toBeInTheDocument()
    expect(screen.getByText(/More than 5 years at the same address is due/)).toBeInTheDocument()
    expect(screen.getByText(/One in the last 12 months makes a lead a Watch/)).toBeInTheDocument()
    expect(
      screen.getByText(/old office's sign \(8\+ years at the same address\) comes from the office/),
    ).toBeInTheDocument()
  })

  it('shows no Watch band for size once the hint and the floor are both 50 (PLAN-V11 B2)', async () => {
    mockApi({
      '/api/v1/lead-finder/rules': {
        ...RULES_V2,
        criteria: {
          ...RULES_V2.criteria,
          size: { ...RULES_V2.criteria.size, staff_min: 50, staff_hint_min: 50, staff_floor: 50 },
        },
      },
    })
    renderWithProviders(<AdminRulesTab />)
    expect(
      await screen.findByText(/50\s*\+ fits;\s*under 50 is a Drop, too small/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/is a Watch with a/)).not.toBeInTheDocument()
    expect(
      screen.getByText('The HubSpot watchlist lists companies with 50+ staff in the city.'),
    ).toBeInTheDocument()
  })

  it('shows which source is main for which data', async () => {
    mockApi({
      '/api/v1/lead-finder/rules': RULES_V2,
    })
    renderWithProviders(<AdminRulesTab />)
    expect(await screen.findByText('Where the data comes from')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Staff in the city: HubSpot, then Signal Hire, then LinkedIn (doubled), then the web research',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Company name, website and industry: Signal Hire, then the web research'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Decision makers: Signal Hire, then the web research'),
    ).toBeInTheDocument()
    expect(screen.getByText(/more than 2 times apart raise a flag/)).toBeInTheDocument()
  })
})

describe('Admin, Memory', () => {
  it('searches memory and shows the closest first', async () => {
    const calls = mockApi({
      '/api/v1/memory/search': [
        {
          id: 'm1',
          app: 'lead_finder',
          kind: 'source_note',
          content: "Acme's lease ends in 2028.",
          subject: 'Acme Software',
          url: 'https://www.afr.com/a',
          similarity: 0.83,
          source_date: '2026-10-01',
          created_at: '2026-10-02T00:00:00Z',
          meta: {},
        },
      ],
    })
    const { user } = renderWithProviders(<AdminMemoryTab />)
    await user.type(screen.getByLabelText('Search memory'), 'lease 2028')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText("Acme's lease ends in 2028.")).toBeInTheDocument()
    expect(screen.getByText('83% close')).toBeInTheDocument()
    expect(new URLSearchParams(calls.at(-1)?.search).get('q')).toBe('lease 2028')
  })
})

describe('Admin, Search log', () => {
  it('shows one run when asked, and what a request searched', async () => {
    const calls = mockApi({
      '/api/v1/searches': {
        total: 1,
        items: [
          {
            id: 's1',
            app: 'lead_finder',
            job_id: null,
            run_id: RUN_ID,
            subject: 'Acme Software',
            step: 'search:property',
            model: 'claude-opus-5-5',
            prompt_version: 'p1',
            queries: ['acme lease melbourne'],
            sources: [{ url: 'https://www.afr.com/a', title: 'Acme moves', page_age: null }],
            web_searches: 2,
            web_fetches: 1,
            input_tokens: 20000,
            output_tokens: 1000,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            cost_usd: '0.120000',
            stop_reason: 'end_turn',
            answer_ok: true,
            note: null,
            created_at: '2026-10-26T04:00:00Z',
          },
        ],
      },
    })
    const { user } = renderWithProviders(
      <Routes>
        <Route path="/admin/searches" element={<AdminSearchesTab />} />
      </Routes>,
      { route: `/admin/searches?run_id=${RUN_ID}` },
    )
    expect(await screen.findByText(/Showing the requests of run 0f3c9a2e/)).toBeInTheDocument()
    expect(calls[0]?.search).toContain(`run_id=${RUN_ID}`)
    await user.click(await screen.findByText('search:property'))
    // The details open in a side panel, so they never sit below a long table.
    const panel = await screen.findByRole('dialog', { name: 'search:property' })
    expect(within(panel).getByText('Acme Software')).toBeInTheDocument()
    expect(await within(panel).findByText('acme lease melbourne')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Acme moves/ })).toHaveAttribute(
      'rel',
      'noopener noreferrer nofollow',
    )
  })
})

describe('Admin, Runs and cost', () => {
  it('shows the total cost and the runs', async () => {
    mockApi({
      '/api/v1/runs/summary': {
        since: '2026-09-26',
        days: [{ date: '2026-10-26', cost_usd: '3.21', runs: 2 }],
        total_cost_usd: '3.21',
        total_runs: 2,
      },
      '/api/v1/runs': { total: 0, items: [] },
    })
    renderWithProviders(<AdminRunsTab />)
    expect(await screen.findByText(/across 2 runs since 2026-09-26/)).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'No runs yet.' })).toBeInTheDocument()
  })
})
