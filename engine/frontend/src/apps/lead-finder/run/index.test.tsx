import { act, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { Run, RunEvent } from '@/api/types'
import { FakeEventSource } from '@/test/fake-event-source'
import { renderWithProviders } from '@/test/render'
import RunPage from './index'
import RunsPage from './list'

const RUN_ID = '0f3c9a2e-1111-2222-3333-444444444444'
const COUNTS = {
  slices: 0,
  slices_done: 0,
  slices_failed: 0,
  candidates: 0,
  unique: 0,
  chosen: 0,
  researched: 0,
  skipped: 0,
  failed: 0,
  by_result: {},
  resumes: 0,
  goal: null,
  good: 0,
  by_source: {},
  target: null,
  sweeps: 0,
  sweeps_done: 0,
  topped_up: 0,
}

function run(changes: Partial<Run> = {}): Run {
  return {
    id: RUN_ID,
    app: 'lead_finder',
    mode: 'company',
    status: 'running',
    params: {},
    caps: {
      run_cap_usd: '20.00',
      max_companies: 20,
      company_cap_usd: '2.50',
      discovery_cap_usd: '8.00',
    },
    rules_version: 'r1',
    prompt_versions: 'p1',
    cost_usd: '0.000000',
    web_searches: 0,
    claude_requests: 0,
    counts: COUNTS,
    stop_reason: null,
    error: null,
    error_id: null,
    schedule_id: null,
    waiting_ahead: null,
    cancel_requested_at: null,
    created_at: '2026-10-26T04:00:00Z',
    started_at: '2026-10-26T04:00:01Z',
    finished_at: null,
    goal_leads: null,
    good_leads: 0,
    leads_by_source: { web: 0, property_daily: 0, arealytics: 0 },
    ...changes,
  }
}

function event(seq: number, type: RunEvent['type'], data: Record<string, unknown>): RunEvent {
  return { seq, type, created_at: '2026-10-26T04:00:00Z', data } as unknown as RunEvent
}

interface Seen {
  posts: string[]
  gets: string[]
}

function mockApi(
  current: () => Run,
  page: Run[] = [current()],
  extra: Record<string, unknown> = {},
): Seen {
  const seen: Seen = { posts: [], gets: [] }
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request) => {
      const path = new URL(request.url).pathname
      if (request.method !== 'POST') {
        seen.gets.push(request.url)
      }
      if (request.method === 'POST') {
        seen.posts.push(path)
        if (path.endsWith('/cancel')) {
          return Promise.resolve(
            Response.json(run({ cancel_requested_at: '2026-10-26T04:01:00Z' })),
          )
        }
        return Promise.resolve(Response.json(run({ status: 'queued' })))
      }
      if (path === `/api/v1/runs/${RUN_ID}`) {
        return Promise.resolve(Response.json(current()))
      }
      if (path === '/api/v1/runs') {
        return Promise.resolve(Response.json({ total: page.length, items: page }))
      }
      if (path in extra) {
        return Promise.resolve(Response.json(extra[path]))
      }
      return Promise.resolve(Response.json({ title: 'Not found', status: 404 }, { status: 404 }))
    }),
  )
  return seen
}

function renderRun() {
  return renderWithProviders(
    <Routes>
      <Route path="/runs/:runId" element={<RunPage />} />
      <Route path="/leads/:leadId" element={<p>The lead card</p>} />
    </Routes>,
    { route: `/runs/${RUN_ID}` },
  )
}

describe('the run page', () => {
  it('shows the live counters, results so far, cost against the cap and the feed', async () => {
    mockApi(() => run())
    renderRun()
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Run 0f3c9a2e' }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(FakeEventSource.instances.length).toBeGreaterThan(0)
    })
    const source = FakeEventSource.last()
    act(() => {
      source.emitOpen()
      source.emitMessage(event(1, 'plan_ready', { slices: 0, companies: 2, labels: [] }))
      source.emitMessage(event(2, 'company_started', { name: 'Acme Software' }))
      source.emitMessage(
        event(3, 'company_done', {
          name: 'Acme Software',
          lead_id: '99999999-2222-3333-4444-555555555555',
          result: 'pass',
          score: 78,
          cost_usd: '0.40',
          hubspot_status: 'new',
        }),
      )
      source.emitMessage(
        event(4, 'progress', {
          cost_usd: '0.400000',
          web_searches: 6,
          claude_requests: 4,
          counts: { ...COUNTS, researched: 1, by_result: { pass: 1 } },
        }),
      )
    })

    expect(await screen.findByText('1 of 2 companies')).toBeInTheDocument()
    const results = screen.getByRole('list', { name: 'Results so far' })
    expect(within(results).getByText('Pass')).toBeInTheDocument()
    const feed = screen.getByRole('list', { name: 'Run events' })
    expect(within(feed).getAllByRole('listitem').length).toBeGreaterThan(0)
    expect(screen.getByText(/4 Claude requests/)).toBeInTheDocument()
    expect(screen.getByText('Live')).toBeInTheDocument()
  })

  it('says why it is reconnecting while a deploy hands the runs to the new backend', async () => {
    let restarting = false // the old backend stops: the stream breaks, the next ask is a 503
    vi.stubGlobal(
      'fetch',
      vi.fn((request: Request) => {
        if (new URL(request.url).pathname === `/api/v1/runs/${RUN_ID}`) {
          return Promise.resolve(
            !restarting
              ? Response.json(run())
              : Response.json(
                  {
                    title: 'Runs are restarting',
                    detail: 'The backend was just restarted (a deploy).',
                    status: 503,
                    code: 'runs_not_ready',
                  },
                  { status: 503 },
                ),
          )
        }
        return Promise.resolve(Response.json({ title: 'Not found', status: 404 }, { status: 404 }))
      }),
    )
    renderRun()
    await waitFor(() => {
      expect(FakeEventSource.instances.length).toBeGreaterThan(0)
    })
    act(() => {
      FakeEventSource.last().emitOpen()
    })
    expect(await screen.findByText('Live')).toBeInTheDocument()
    restarting = true
    act(() => {
      FakeEventSource.last().emitError()
    })
    expect(
      await screen.findByText('Reconnecting. Runs are restarting.', {}, { timeout: 4000 }),
    ).toBeInTheDocument()
  })

  it('stops a run and says so until it has stopped', async () => {
    const seen = mockApi(() => run())
    const { user } = renderRun()
    const stop = await screen.findByRole('button', { name: 'Stop' })
    await user.click(stop)
    expect(await screen.findByRole('button', { name: 'Stopping.' })).toBeDisabled()
    expect(seen.posts).toEqual([`/api/v1/runs/${RUN_ID}/cancel`])
  })

  it('offers Resume for an interrupted run, with no Stop', async () => {
    const seen = mockApi(() =>
      run({ status: 'interrupted', stop_reason: 'The backend stopped while this run was going' }),
    )
    const { user } = renderRun()
    const resume = await screen.findByRole('button', { name: 'Resume' })
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
    expect(screen.getByText(/Stopped early: The backend stopped/)).toBeInTheDocument()
    await user.click(resume)
    await waitFor(() => {
      expect(seen.posts).toEqual([`/api/v1/runs/${RUN_ID}/resume`])
    })
  })

  it('after Resume, opens the stream again and drops the old error', async () => {
    // A run that failed, read to its end: the stream closed for good, and the page shows why.
    let resumed = false
    const failed = run({
      status: 'failed',
      stop_reason: 'Claude refused the request',
      error: 'Claude refused the request. Something we send is not accepted.',
    })
    mockApi(() => (resumed ? run({ status: 'running' }) : failed))
    const { user } = renderRun()
    const first = await waitFor(() => FakeEventSource.last())
    act(() => {
      first.emitMessage(
        event(1, 'run_started', { mode: 'discovery', caps: {}, rules_version: 'x' }),
      )
      first.emitMessage(event(2, 'run_finished', { status: 'failed', stop_reason: null }))
      first.emitError({ closed: true })
    })
    const resume = await screen.findByRole('button', { name: 'Resume' })
    expect(await screen.findAllByText(/Something we send is not accepted/)).not.toHaveLength(0)

    resumed = true
    await user.click(resume)
    await waitFor(() => {
      expect(FakeEventSource.instances.length).toBeGreaterThan(1)
    })
    const second = FakeEventSource.last()
    expect(second.url).toContain('after=2') // only the events after the last one read
    act(() => {
      second.emitMessage(event(3, 'run_resumed', { from_status: 'failed' }))
    })
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Something we send is not accepted/)).not.toBeInTheDocument()
  })

  it('shows a failed run in plain words with its error id', async () => {
    mockApi(() =>
      run({
        status: 'failed',
        stop_reason: 'No Claude API key',
        error: 'No Claude API key. Add ANTHROPIC_API_KEY to engine/.env.',
        error_id: 'abc123def456',
      }),
    )
    renderRun()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('No Claude API key')
    expect(alert).toHaveTextContent('Error id abc123def456')
  })
})

describe('the run list', () => {
  it('shows what a finished run looked for, its companies and where the money went', async () => {
    const finished = run({
      mode: 'discovery',
      status: 'done',
      params: { cities: ['Melbourne', 'Perth'], triggers: ['lease_ending'], since_days: 30 },
      cost_usd: '0.900000',
      claude_requests: 3,
      finished_at: '2026-10-26T04:13:29Z',
      counts: {
        ...COUNTS,
        slices: 2,
        slices_done: 2,
        candidates: 3,
        unique: 2,
        chosen: 2,
        researched: 2,
        by_result: { director_review: 1, watch: 1 },
      },
    })
    const lead = (id: string, company: string, result: string, score: number, cost: string) => ({
      id,
      company,
      result,
      score,
      city: 'Perth',
      cost_usd: cost,
      tier: result === 'watch' ? 'C' : 'B',
      confidence: 'medium',
      excluded: null,
      has_property: false,
    })
    mockApi(() => finished, [finished], {
      '/api/v1/lead-finder/leads': {
        total: 2,
        items: [
          lead('11111111-2222-3333-4444-555555555555', 'KBR', 'director_review', 76, '0.36'),
          lead('22222222-2222-3333-4444-555555555555', 'UGL', 'watch', 68, '0.30'),
        ],
      },
      '/api/v1/searches': {
        total: 3,
        items: [
          { step: 'discover:lease_ending:Melbourne', cost_usd: '0.24' },
          { step: 'search:property', cost_usd: '0.40' },
          { step: 'extract', cost_usd: '0.26' },
        ],
      },
      '/api/v1/lead-finder/run-options': {
        triggers: [{ id: 'lease_ending', label: 'Lease ending in 1 to 3 years' }],
      },
    })
    const { user } = renderRun()

    const companies = await screen.findByRole('table', { name: 'Ranked leads' })
    expect(await within(companies).findByText('KBR')).toBeInTheDocument()
    expect(
      within(screen.getByRole('table', { name: 'Watch' })).getByText('UGL'),
    ).toBeInTheDocument()

    const money = await screen.findByLabelText('Where the money went')
    expect(within(money).getByText(/Finding companies \(1 request\)/)).toBeInTheDocument()
    expect(within(money).getByText('US$0.24')).toBeInTheDocument()
    expect(within(money).getByText('US$0.66')).toBeInTheDocument()
    expect(within(money).getByText('US$0.33')).toBeInTheDocument()

    const setup = screen.getByLabelText('What the run was asked to do')
    expect(within(setup).getByText('Melbourne, Perth')).toBeInTheDocument()
    expect(await within(setup).findByText('Lease ending in 1 to 3 years')).toBeInTheDocument()
    expect(
      within(screen.getByLabelText('When it ran')).getByText('13 min 28 s'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        '2 searches of 2, 3 finds, 2 companies after merging, 2 chosen to research.',
      ),
    ).toBeInTheDocument()

    await user.click(within(companies).getByRole('button', { name: 'KBR' }))
    expect(await screen.findByText('The lead card')).toBeInTheDocument()
  })

  it('lists the runs and opens one', async () => {
    mockApi(() =>
      run({ status: 'done', cost_usd: '3.210000', counts: { ...COUNTS, researched: 5 } }),
    )
    const { user } = renderWithProviders(
      <Routes>
        <Route path="/runs" element={<RunsPage />} />
        <Route path="/runs/:runId" element={<p>Opened</p>} />
      </Routes>,
      { route: '/runs' },
    )
    const table = await screen.findByRole('table', { name: 'Runs' })
    expect(await within(table).findByText('US$3.21')).toBeInTheDocument()
    expect(within(table).getByText('Companies by name')).toBeInTheDocument()
    await user.click(within(table).getByText('0f3c9a2e'))
    expect(await screen.findByText('Opened')).toBeInTheDocument()
  })

  it('marks the runs a schedule started, and only those', async () => {
    const byPerson = run({ id: '0f3c9a2e-0000-4000-8000-000000000001', status: 'done' })
    const bySchedule = run({
      id: '5d1b7c44-0000-4000-8000-000000000002',
      status: 'done',
      schedule_id: '9a36e57c-67b7-4721-9dfc-7c02f1a0b111',
    })
    mockApi(() => byPerson, [bySchedule, byPerson])
    renderWithProviders(<RunsPage />)

    const table = await screen.findByRole('table', { name: 'Runs' })
    expect(await within(table).findByText('5d1b7c44')).toBeInTheDocument()
    const marks = within(table).getAllByText('Scheduled')
    expect(marks).toHaveLength(1)
    const rows = within(table).getAllByRole('row')
    expect(within(rows[1]).getByText('Scheduled')).toBeInTheDocument() // the scheduled run, first
    expect(within(rows[2]).queryByText('Scheduled')).not.toBeInTheDocument()
  })

  it('says so when there is no run yet', async () => {
    mockApi(() => run(), [])
    renderWithProviders(<RunsPage />)
    expect(await screen.findByRole('heading', { name: 'No runs yet.' })).toBeInTheDocument()
  })
})

// Only an automatic run, one a schedule started, has a goal to report against (PLAN-V20).
const AUTOMATIC = { schedule_id: '99999999-aaaa-bbbb-cccc-dddddddddddd' } as const

describe('the goal of good leads, for an automatic run (PLAN-V16 T3-3, PLAN-V20)', () => {
  const DONE = { ...AUTOMATIC, mode: 'discovery', finished_at: '2026-10-26T04:13:29Z' } as const

  it('a run a person started shows no goal, even one that was asked for 20 before PLAN-V20', async () => {
    mockApi(() =>
      run({
        mode: 'discovery',
        status: 'done',
        finished_at: '2026-10-26T04:13:29Z',
        goal_leads: 20,
        good_leads: 3,
      }),
    )
    renderRun()
    expect(await screen.findByText('Progress')).toBeInTheDocument()
    expect(screen.queryByText('good leads found')).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar', { name: 'Good leads found' })).toBeNull()
  })

  it('running: shows how many good leads it has found of its goal, live', async () => {
    mockApi(() => run({ ...AUTOMATIC, mode: 'discovery', goal_leads: 20 }))
    renderRun()
    await waitFor(() => {
      expect(FakeEventSource.instances.length).toBeGreaterThan(0)
    })
    act(() => {
      const source = FakeEventSource.last()
      source.emitOpen()
      source.emitMessage(
        event(1, 'progress', {
          cost_usd: '4.100000',
          web_searches: 40,
          claude_requests: 30,
          counts: {
            ...COUNTS,
            researched: 18,
            by_result: { pass: 9, director_review: 3, watch: 6 },
          },
        }),
      )
    })

    expect(await screen.findByText('12 of 20')).toBeInTheDocument()
    expect(screen.getByText('good leads found')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Good leads found' })).toHaveAttribute(
      'aria-valuetext',
      '12 of 20 good leads found',
    )
    expect(screen.queryByText('It met its goal.')).not.toBeInTheDocument()
  })

  it('met its goal: says so, from the backend count', async () => {
    mockApi(() => run({ ...DONE, status: 'done', goal_leads: 20, good_leads: 20 }))
    renderRun()
    expect(await screen.findByText('20 of 20')).toBeInTheDocument()
    expect(screen.getByText('It met its goal.')).toBeInTheDocument()
  })

  it('ended short: says why once, without the stop reason again', async () => {
    mockApi(() =>
      run({
        ...DONE,
        status: 'done',
        goal_leads: 20,
        good_leads: 12,
        stop_reason: 'Found 12 of 20 leads. It stopped at the run limit (US$20).',
      }),
    )
    renderRun()
    expect(await screen.findByText('12 of 20')).toBeInTheDocument()
    expect(screen.getByText('It stopped at the run limit (US$20).')).toBeInTheDocument()
    expect(screen.queryByText(/Stopped early/)).not.toBeInTheDocument()
    expect(screen.queryByText('It met its goal.')).not.toBeInTheDocument()
  })

  it('ended short with no reason from the backend: says so in plain words', async () => {
    mockApi(() => run({ ...DONE, status: 'cancelled', goal_leads: 20, good_leads: 3 }))
    renderRun()
    expect(await screen.findByText('3 of 20')).toBeInTheDocument()
    expect(screen.getByText('It was stopped before it found them all.')).toBeInTheDocument()
  })

  it('no goal: no goal line, the stop reason as before', async () => {
    mockApi(() =>
      run({
        mode: 'discovery',
        finished_at: '2026-10-26T04:13:29Z',
        status: 'done',
        goal_leads: null,
        stop_reason: 'The run reached its limit',
      }),
    )
    renderRun()
    expect(await screen.findByText(/Stopped early: The run reached its limit/)).toBeInTheDocument()
    expect(screen.queryByText('good leads found')).not.toBeInTheDocument()
  })

  it('says where the leads came from', async () => {
    mockApi(() =>
      run({
        ...DONE,
        status: 'done',
        goal_leads: 20,
        good_leads: 12,
        leads_by_source: { web: 9, property_daily: 2, arealytics: 1 },
      }),
    )
    renderRun()
    const sources = await screen.findByRole('list', { name: 'Where the leads came from' })
    expect(
      within(sources)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['The web 9', 'Property Daily 2', 'Arealytics 1'])
  })
})

describe('the run leads, as Levi lists them (PLAN-V16 T3-3)', () => {
  const row = (id: string, company: string, tier: string, score: number, changes = {}) => ({
    id,
    company,
    tier,
    score,
    result: tier === 'C' ? 'watch' : tier === 'discard' ? 'drop' : 'pass',
    confidence: 'medium',
    excluded: null,
    has_property: false,
    city: 'Perth',
    cost_usd: '0.40',
    ...changes,
  })
  const EXCLUDED = {
    reason_id: 'law_firm',
    label: 'A law firm',
    evidence: 'Sample Legal is a law firm.',
    url: null,
    overridden_by: null,
    overridden_at: null,
  }

  it('ranks Tier A and B, then lists the excluded, the watch list and those under 40', async () => {
    const finished = run({ mode: 'discovery', status: 'done', finished_at: '2026-10-26T04:13:29Z' })
    mockApi(() => finished, [finished], {
      '/api/v1/lead-finder/leads': {
        total: 6,
        items: [
          row('11111111-2222-3333-4444-555555555555', 'Sample Energy', 'B', 61),
          row('22222222-2222-3333-4444-555555555555', 'Sample Logistics', 'A', 82),
          row('33333333-2222-3333-4444-555555555555', 'Sample Legal', 'discard', 0, {
            result: 'drop',
            excluded: EXCLUDED,
          }),
          row('44444444-2222-3333-4444-555555555555', 'Sample Insurance', 'C', 47),
          row('55555555-2222-3333-4444-555555555555', 'Sample Retail', 'discard', 22),
          row('66666666-2222-3333-4444-555555555555', 'Sample Defence', 'B', 70, {
            excluded: {
              ...EXCLUDED,
              overridden_by: 'Al-khair',
              overridden_at: '2026-11-15T01:00:00Z',
            },
          }),
        ],
      },
    })
    renderRun()

    const ranked = await screen.findByRole('table', { name: 'Ranked leads' })
    const names = within(ranked)
      .getAllByRole('row')
      .slice(1)
      .map((tableRow) => within(tableRow).getAllByRole('cell')[0]?.textContent)
    // Best first, and an overridden exclusion is judged like any lead.
    expect(names).toEqual(['Sample Logistics', 'Sample Defence', 'Sample Energy'])

    const excluded = screen.getByRole('table', { name: 'Excluded' })
    expect(within(excluded).getByText('Sample Legal')).toBeInTheDocument()
    expect(within(excluded).getByText('A law firm')).toBeInTheDocument()

    const watch = screen.getByRole('table', { name: 'Watch' })
    expect(within(watch).getByText('Sample Insurance')).toBeInTheDocument()

    // Every company the run researched is listed, so one that scored under 40 is not hidden
    // behind a count (PLAN-V20): a run of weak companies used to look empty.
    const under = screen.getByRole('table', { name: 'Scored under 40' })
    expect(within(under).getByText('Sample Retail')).toBeInTheDocument()
    expect(screen.queryByText(/not listed/)).not.toBeInTheDocument()
  })

  it('lists a run that has only weak companies, none left out', async () => {
    const finished = run({ mode: 'discovery', status: 'done', finished_at: '2026-10-26T04:13:29Z' })
    mockApi(() => finished, [finished], {
      '/api/v1/lead-finder/leads': {
        total: 3,
        items: [
          row('11111111-2222-3333-4444-555555555555', 'Alta', 'discard', 2, { result: 'watch' }),
          row('22222222-2222-3333-4444-555555555555', 'SEC', 'discard', 0, { result: 'watch' }),
          row('33333333-2222-3333-4444-555555555555', 'OpenAsset', 'discard', 0),
        ],
      },
    })
    renderRun()

    const under = await screen.findByRole('table', { name: 'Scored under 40' })
    expect(
      within(under)
        .getAllByRole('row')
        .slice(1)
        .map((tableRow) => within(tableRow).getAllByRole('cell')[0]?.textContent),
    ).toEqual(['Alta', 'SEC', 'OpenAsset'])
    expect(screen.getByText('Companies from this run')).toBeInTheDocument()
  })
})

describe('the sweeps and the top up (PLAN-V21 T3-4)', () => {
  const CAPS = {
    run_cap_usd: '30.00',
    max_companies: 70,
    company_cap_usd: '2.50',
    discovery_cap_usd: '8.00',
  }
  const started = event(1, 'run_started', { mode: 'discovery', caps: CAPS, rules_version: 'r1' })

  async function liveSource() {
    await waitFor(() => {
      expect(FakeEventSource.instances.length).toBeGreaterThan(0)
    })
    return FakeEventSource.last()
  }

  it('shows "Sweep 2 of 4: 31 of 50 companies" with a bar while the run searches', async () => {
    mockApi(() => run({ mode: 'discovery' }))
    renderRun()
    const source = await liveSource()
    act(() => {
      source.emitOpen()
      source.emitMessage(started)
      source.emitMessage(event(2, 'plan_ready', { slices: 8, companies: 0, labels: [] }))
      source.emitMessage(
        event(3, 'sweep_started', { sweep: 1, of: 4, label: "The signs' own searches" }),
      )
      source.emitMessage(event(4, 'merged', { candidates: 40, unique: 31 }))
      source.emitMessage(event(5, 'sweep_done', { sweep: 1, found: 40, companies: 31, target: 50 }))
      source.emitMessage(
        event(6, 'sweep_started', { sweep: 2, of: 4, label: "Levi's source groups" }),
      )
      // The backend's totals in the middle of a sweep: nothing chosen yet (it is set after the
      // last sweep), so the bar keeps the sweep (PLAN-V21 review, M1)
      source.emitMessage(
        event(7, 'progress', {
          cost_usd: '1.20',
          web_searches: 24,
          claude_requests: 8,
          counts: {
            ...COUNTS,
            slices: 16,
            slices_done: 8,
            candidates: 40,
            unique: 31,
            chosen: 0,
            sweeps: 4,
            sweeps_done: 1,
            target: 50,
          },
        }),
      )
    })

    expect(await screen.findByText('Sweep 2 of 4: 31 of 50 companies')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Progress' })).toHaveAttribute(
      'aria-valuenow',
      '62',
    )
    const feed = screen.getByRole('list', { name: 'Run events' })
    expect(
      within(feed).getByText('Sweep 1 done: 40 finds, 31 of 50 companies so far.'),
    ).toBeInTheDocument()
    expect(
      within(feed).getByText("Sweep 2 of 4 started: Levi's source groups."),
    ).toBeInTheDocument()
    // The run merges after every sweep, so the companies after merging grow with each one.
    expect(screen.getByText(/1 of 4 sweeps, .*31 companies after merging/)).toBeInTheDocument()

    act(() => {
      source.emitMessage(event(8, 'merged', { candidates: 52, unique: 44 }))
      source.emitMessage(event(9, 'sweep_done', { sweep: 2, found: 12, companies: 44, target: 50 }))
    })
    expect(await screen.findByText('Sweep 2 of 4: 44 of 50 companies')).toBeInTheDocument()
    expect(screen.getByText(/2 of 4 sweeps, .*44 companies after merging/)).toBeInTheDocument()
  })

  it("asks for every tier of the run's leads, so its Discards and excluded leads show", async () => {
    const seen = mockApi(() => run({ mode: 'discovery', status: 'done' }))
    renderRun()
    await waitFor(() => {
      expect(seen.gets.some((url) => url.includes('/api/v1/lead-finder/leads?'))).toBe(true)
    })
    const asked = seen.gets.find((url) => url.includes('/api/v1/lead-finder/leads?')) ?? ''
    expect(new URL(asked).searchParams.getAll('tier')).toEqual(['A', 'B', 'C', 'discard', 'none'])
  })

  it('marks the companies the top up added "From HubSpot", in the feed and in its tables', async () => {
    const lead = (id: string, company: string, origin: string) => ({
      id,
      company,
      origin,
      tier: 'B',
      score: 60,
      result: 'pass',
      confidence: 'medium',
      excluded: null,
      has_property: false,
      city: 'Perth',
      cost_usd: '0.40',
    })
    mockApi(() => run({ mode: 'discovery' }), undefined, {
      '/api/v1/lead-finder/leads': {
        total: 2,
        items: [
          lead('11111111-2222-3333-4444-555555555555', 'ABC Logistics', 'hubspot'),
          lead('22222222-2222-3333-4444-555555555555', 'Sample Software', 'web'),
        ],
      },
    })
    renderRun()
    const source = await liveSource()
    act(() => {
      source.emitOpen()
      source.emitMessage(started)
      source.emitMessage(event(2, 'sweep_started', { sweep: 4, of: 4, label: 'By area' }))
      source.emitMessage(event(3, 'sweep_done', { sweep: 4, found: 2, companies: 1, target: 2 }))
      source.emitMessage(event(4, 'topped_up', { count: 1, names: ['ABC Logistics'] }))
      source.emitMessage(event(5, 'company_started', { name: 'Sample Software', origin: 'web' }))
      source.emitMessage(event(6, 'company_started', { name: 'ABC Logistics', origin: 'hubspot' }))
      source.emitMessage(
        event(7, 'progress', {
          cost_usd: '1.00',
          web_searches: 32,
          claude_requests: 34,
          counts: {
            ...COUNTS,
            slices: 32,
            slices_done: 32,
            candidates: 2,
            unique: 1,
            chosen: 2,
            target: 2,
            sweeps: 4,
            sweeps_done: 4,
            topped_up: 1,
          },
        }),
      )
    })

    const feed = await screen.findByRole('list', { name: 'Run events' })
    expect(
      await within(feed).findByText(
        'Added 1 company from the HubSpot watchlist, as the searches came up short.',
      ),
    ).toBeInTheDocument()
    expect(within(feed).getByText('Researching ABC Logistics, from HubSpot')).toBeInTheDocument()
    expect(within(feed).getByText('Researching Sample Software')).toBeInTheDocument()
    // Once it has chosen its companies, the bar is the ones researched.
    expect(screen.getByText('0 of 2 companies')).toBeInTheDocument()
    expect(
      screen.getByText(/2 chosen to research, 1 of them from the HubSpot watchlist\./),
    ).toBeInTheDocument()

    const ranked = await screen.findByRole('table', { name: 'Ranked leads' })
    const rows = within(ranked).getAllByRole('row').slice(1)
    const marked = rows.find((tableRow) => within(tableRow).queryByText('ABC Logistics'))
    const plain = rows.find((tableRow) => within(tableRow).queryByText('Sample Software'))
    expect(marked && within(marked).getByText('From HubSpot')).toBeInTheDocument()
    expect(plain && within(plain).queryByText('From HubSpot')).toBeNull()
  })
})
