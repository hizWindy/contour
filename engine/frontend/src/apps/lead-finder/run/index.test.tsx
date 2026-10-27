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
    cancel_requested_at: null,
    created_at: '2026-10-26T04:00:00Z',
    started_at: '2026-10-26T04:00:01Z',
    finished_at: null,
    ...changes,
  }
}

function event(seq: number, type: RunEvent['type'], data: Record<string, unknown>): RunEvent {
  return { seq, type, created_at: '2026-10-26T04:00:00Z', data } as unknown as RunEvent
}

interface Seen {
  posts: string[]
}

function mockApi(current: () => Run, page: Run[] = [current()]): Seen {
  const seen: Seen = { posts: [] }
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request) => {
      const path = new URL(request.url).pathname
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
      return Promise.resolve(Response.json({ title: 'Not found', status: 404 }, { status: 404 }))
    }),
  )
  return seen
}

function renderRun() {
  return renderWithProviders(
    <Routes>
      <Route path="/runs/:runId" element={<RunPage />} />
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

  it('says so when there is no run yet', async () => {
    mockApi(() => run(), [])
    renderWithProviders(<RunsPage />)
    expect(await screen.findByRole('heading', { name: 'No runs yet.' })).toBeInTheDocument()
  })
})
