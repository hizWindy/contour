/**
 * Admin, Runs and cost (PLAN-V13 T1-8): the stat tabs drive the chart, the numbers match the API,
 * the chart works by keyboard, and the newest runs show in a compact table. The clock is
 * Wednesday 11 Nov 2026, 9:00 am in Melbourne.
 */
import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LeadFinderRound, Run, RunSummary } from '@/api/types'
import { mockApi } from '@/test/mock-api'
import { renderWithProviders } from '@/test/render'
import AdminRunsTab from './runs'
import { barValue, daysOf, dayLine, statsOf } from './runs-stats'

const NOW = new Date('2026-11-10T22:00:00Z') // Wed 11 Nov, 9:00 am in Melbourne

const SUMMARY: RunSummary = {
  since: '2026-10-02',
  days: [
    { date: '2026-10-30', cost_usd: '20.00', runs: 1 },
    { date: '2026-11-09', cost_usd: '40.00', runs: 1 },
    { date: '2026-11-10', cost_usd: '30.00', runs: 2 },
  ],
  total_cost_usd: '90.00',
  total_runs: 4,
}

function run(id: string, createdAt: string, cost: string, pass: number, cities: string[]): Run {
  return {
    id,
    app: 'lead_finder',
    mode: 'discovery',
    status: 'done',
    params: { cities },
    caps: {
      run_cap_usd: '150',
      max_companies: 100,
      company_cap_usd: '2.5',
      discovery_cap_usd: '60',
    },
    rules_version: 'v',
    prompt_versions: 'p',
    cost_usd: cost,
    web_searches: 3,
    claude_requests: 4,
    counts: {
      slices: 1,
      slices_done: 1,
      slices_failed: 0,
      candidates: 3,
      chosen: 3,
      researched: 3,
      failed: 0,
      skipped: 0,
      by_result: { pass, director_review: 0, watch: 1, drop: 0 },
      resumes: 0,
    } as unknown as Run['counts'],
    stop_reason: null,
    error: null,
    error_id: null,
    schedule_id: '5d1b7c44-0000-4000-8000-000000000010',
    cancel_requested_at: null,
    created_at: createdAt,
    started_at: createdAt,
    finished_at: createdAt,
  }
}

const RUNS: Run[] = [
  run('11111111-2222-3333-4444-000000000002', '2026-11-09T22:00:00Z', '30.00', 6, ['Adelaide']),
  run('11111111-2222-3333-4444-000000000001', '2026-11-08T21:00:00Z', '40.00', 8, ['Melbourne']),
]

const ROUND = {
  enabled: true,
  round: {
    started_at: '2026-11-08T20:00:00Z', // Mon 9 Nov, 7:00 am
    next_round_at: '2026-11-22T20:00:00Z',
    runs: 2,
    good_leads: 14,
    goal: 100,
    spent_usd: '70.00',
    left_usd: '80.00',
  },
} as unknown as LeadFinderRound

function answer() {
  return mockApi({
    '/api/v1/runs/summary': SUMMARY,
    '/api/v1/runs': { total: RUNS.length, items: RUNS },
    '/api/v1/schedules/lead-finder': ROUND,
    '/api/v1/lead-finder/leads/reject-reasons': { days: 90, total: 0, reasons: [] },
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('the stats (pure)', () => {
  it('match the API: the round, the month and the cost per good lead', () => {
    const days = daysOf(SUMMARY, RUNS, '2026-10-02', '2026-11-11')
    const [round, month, perGood] = statsOf(ROUND, days, '2026-11-11')
    expect(round).toMatchObject({ value: '70.00', from: '2026-11-09' })
    expect(round?.detail).toBe('14 good leads of 100, 2 city runs')
    expect(month).toMatchObject({
      value: '70.00',
      from: '2026-11-01',
      detail: '3 runs, 14 good leads',
    })
    expect(perGood?.value).toBe('5') // US$70 over 14 good leads
    const tenth = days.find((day) => day.date === '2026-11-10')
    expect(tenth).toMatchObject({ cost: 30, runs: 2, good: 6 })
    expect(tenth ? barValue(tenth, 'per-good') : null).toBe(5)
    expect(tenth ? dayLine(tenth, 'per-good') : '').toBe(
      'Tue 10 Nov: US$5.00 a good lead (6 good leads, US$30.00).',
    )
  })

  it('shows the last two weeks for this round while the round is off', () => {
    const days = daysOf(SUMMARY, [], '2026-10-02', '2026-11-11')
    const [round] = statsOf({ ...ROUND, enabled: false }, days, '2026-11-11')
    expect(round?.from).toBe('2026-10-29')
  })
})

describe('Admin, Runs and cost', () => {
  it('opens on this round, and a stat tab drives the chart', async () => {
    answer()
    const { user } = renderWithProviders(<AdminRunsTab />)
    const tabs = await screen.findByRole('tablist', { name: 'What to show' })
    const round = within(tabs).getByRole('tab', { name: /This round/ })
    expect(round).toHaveAttribute('aria-selected', 'true')
    expect(round).toHaveTextContent('US$70.00')
    expect(round.querySelector('[data-slot=tab-indicator]')).not.toBeNull()
    // This round runs from Monday, and today is lit.
    expect(screen.getByText('Today, Wed 11 Nov: 0 runs, US$0.00.')).toBeInTheDocument()

    const perGood = within(tabs).getByRole('tab', { name: /Cost per good lead/ })
    await user.click(perGood)
    expect(perGood).toHaveAttribute('aria-selected', 'true')
    expect(perGood).toHaveTextContent('US$5.00')
    expect(screen.getByText('Today, Wed 11 Nov: US$0.00, no good lead.')).toBeInTheDocument()
  })

  it('moves between the tabs and along the days by keyboard', async () => {
    answer()
    const { user } = renderWithProviders(<AdminRunsTab />)
    const tabs = await screen.findByRole('tablist', { name: 'What to show' })
    within(tabs)
      .getByRole('tab', { name: /This round/ })
      .focus()
    await user.keyboard('{ArrowRight}')
    const month = within(tabs).getByRole('tab', { name: /^This month/ })
    expect(month).toHaveAttribute('aria-selected', 'true')
    expect(month).toHaveFocus()

    screen.getByRole('group', { name: /^Spend by day/ }).focus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByText('Tue 10 Nov: 2 runs, US$30.00.')).toBeInTheDocument()
    await user.keyboard('{Home}')
    expect(screen.getByText('Sun 1 Nov: 0 runs, US$0.00.')).toBeInTheDocument()
  })

  it('has the same numbers as a table, and the newest runs in a compact table', async () => {
    answer()
    const { user } = renderWithProviders(<AdminRunsTab />)
    await screen.findByRole('tablist', { name: 'What to show' })
    await user.click(screen.getByText('Show the numbers'))
    const days = screen.getByRole('table', { name: 'Spend by day, as a table' })
    expect(within(days).getByRole('row', { name: /Tue 10 Nov/ })).toHaveTextContent('US$30.00')

    const runs = screen.getByRole('table', { name: 'The newest runs' })
    const rows = within(runs).getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('Adelaide')
    expect(rows[0]).toHaveTextContent('US$30.00')
    expect(rows[0]).toHaveTextContent('Automatic')
    expect(within(runs).getByRole('link', { name: 'Melbourne' })).toHaveAttribute(
      'href',
      '/runs/11111111-2222-3333-4444-000000000001',
    )
  })
})
