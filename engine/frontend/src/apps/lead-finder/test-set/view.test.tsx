import { screen, within } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { LeadResult, TestReport } from '@/api/types'
import { mockApi, TEST_RUN_ID, type Call } from '@/test/mock-api'
import { renderWithProviders } from '@/test/render'
import { buildGrid, changeWords, compared, resultOf, type TestItem, type TestSummary } from './grid'
import TestSetView from './view'

const RUN_B = '0f3c9a2e-2222-2222-3333-444444444444'
const RUN_C = '0f3c9a2e-3333-2222-3333-444444444444'

function summary(run_id: string, created_at: string, matched: number, total: string): TestSummary {
  return {
    run_id,
    created_at,
    status: 'done',
    companies: 2,
    expected: 2,
    matched,
    avg_cost_usd: '0.40',
    total_cost_usd: total,
    rules_version: 'r1',
    prompt_versions: 'p1',
  }
}

function item(
  name: string,
  result: TestItem['result'],
  score: number | null,
  extra: Partial<TestItem> = {},
): TestItem {
  return {
    name,
    city: 'Sydney',
    expected: ['director_review', 'watch'] as LeadResult[],
    result,
    score,
    unknown_facts: ['owner'],
    cost_usd: '0.40',
    ok: result === 'director_review' || result === 'watch',
    lead_id: 'x',
    note: null,
    ...extra,
  }
}

/** Three runs, newest first, as the API lists them. */
const RUNS = [
  summary(TEST_RUN_ID, '2026-11-03T04:00:00Z', 2, '4.10'),
  summary(RUN_B, '2026-10-27T04:00:00Z', 1, '4.40'),
  summary(RUN_C, '2026-10-20T04:00:00Z', 1, '3.90'),
]
const REPORTS = {
  [TEST_RUN_ID]: {
    summary: RUNS[0],
    items: [item('Canva', 'director_review', 40), item('Atlassian', 'watch', 55)],
  },
  [RUN_B]: {
    summary: RUNS[1],
    items: [item('Canva', 'director_review', 38), item('Atlassian', 'drop', 20)],
  },
  [RUN_C]: {
    summary: RUNS[2],
    items: [
      item('Canva', 'watch', 30),
      item('Atlassian', null, null, { note: 'The search failed', ok: null }),
    ],
  },
}
const ESTIMATE = {
  valid: true,
  errors: [],
  blocked: null,
  warnings: [],
  slices: 0,
  companies_expected: 10,
  cost_usd_low: '5.511650',
  cost_usd_high: '25.00',
  cap_usd: '20.00',
  daily_left_usd: '136.54',
  basis: 'US$0.55 a company',
  over_cap: true,
}

function answers(extra: Record<string, unknown> = {}) {
  return {
    '/api/v1/lead-finder/tests': { total: RUNS.length, items: RUNS },
    [`/api/v1/lead-finder/tests/${TEST_RUN_ID}`]: REPORTS[TEST_RUN_ID],
    [`/api/v1/lead-finder/tests/${RUN_B}`]: REPORTS[RUN_B],
    [`/api/v1/lead-finder/tests/${RUN_C}`]: REPORTS[RUN_C],
    '/api/v1/runs/estimate': ESTIMATE,
    ...extra,
  }
}

describe('Test set', () => {
  it('shows the last run in one line, the run before it, and the grid of the last runs', async () => {
    mockApi(answers())
    renderWithProviders(<TestSetView />)
    expect(await screen.findByText('2 of 2 as expected, US$4.10, 3 Nov 2026')).toBeInTheDocument()
    expect(
      screen.getByText(/The run before: 1 of 2 as expected, US\$4\.40, 27 Oct 2026\. Better now\./),
    ).toBeInTheDocument()
    const grid = await screen.findByRole('table', { name: 'Test set grid' })
    // Oldest on the left
    const headers = within(grid)
      .getAllByRole('columnheader')
      .map((th) => th.textContent)
    expect(headers).toEqual([
      'Company',
      '20 Oct 20261 of 2',
      '27 Oct 20261 of 2',
      '3 Nov 20262 of 2',
    ])
    const canva = within(grid).getByRole('row', { name: /Canva/ })
    expect(await within(canva).findAllByText(/^(Watch|Director review)$/)).toHaveLength(3)
    const cells = canva.querySelectorAll('[data-result]')
    expect([...cells].map((c) => c.getAttribute('data-result'))).toEqual([
      'watch',
      'director_review',
      'director_review',
    ])
    // Changed from the run before: Watch to Director review on 27 Oct, not on 3 Nov
    expect([...cells].map((c) => c.getAttribute('data-changed'))).toEqual([null, 'true', null])
    expect(within(canva).getAllByRole('img', { name: 'Changed from the run before' })).toHaveLength(
      1,
    )
    // A failed company shows as failed, with an icon and a word
    const atlassian = within(grid).getByRole('row', { name: /Atlassian/ })
    expect(atlassian.querySelector('[data-result=failed]')).not.toBeNull()
    expect(within(atlassian).getByText('Failed')).toHaveClass('sr-only')
    expect(within(atlassian).getByText('Expected Director review or Watch')).toBeInTheDocument()
  })

  it('opens a company in a side panel with what each run said and what changed', async () => {
    mockApi(answers())
    const { user } = renderWithProviders(<TestSetView />)
    const grid = await screen.findByRole('table', { name: 'Test set grid' })
    await within(grid).findAllByText(/^(Watch|Director review)$/)
    await user.click(within(grid).getByRole('button', { name: /Atlassian/ }))
    const panel = await screen.findByRole('dialog', { name: 'Atlassian' })
    expect(within(panel).getByText(/Expected: Director review or Watch/)).toBeInTheDocument()
    const runs = within(panel).getAllByRole('listitem')
    expect(runs).toHaveLength(3)
    // Newest first in the panel
    expect(runs[0]).toHaveTextContent('3 Nov 2026')
    expect(runs[0]).toHaveTextContent('Changed: Drop to Watch')
    expect(runs[1]).toHaveTextContent('Changed: Failed to Drop')
    expect(runs[2]).toHaveTextContent('The search failed')
    expect(runs[2]).not.toHaveTextContent('Changed:')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Atlassian' })).not.toBeInTheDocument()
  })

  it('runs the test set after a cost confirm taken from the estimate', async () => {
    const calls = mockApi(
      answers({
        '/api/v1/lead-finder/tests/run': (call: Call) =>
          call.method === 'POST' ? Response.json({ id: TEST_RUN_ID }, { status: 201 }) : undefined,
      }),
    )
    const { user } = renderWithProviders(
      <Routes>
        <Route path="/" element={<TestSetView />} />
        <Route path="/runs/:runId" element={<p>The test run</p>} />
      </Routes>,
    )
    await user.click(await screen.findByRole('button', { name: 'Run the test set' }))
    expect(
      await screen.findByText(
        'It researches 10 companies with real searches, so it costs money: about US$5.51 (US$0.55 a company), and never more than US$20.00.',
      ),
    ).toBeInTheDocument()
    expect(calls.find((call) => call.path === '/api/v1/runs/estimate')?.body).toEqual({
      app: 'lead_finder',
      mode: 'testset',
      params: {},
    })
    await user.click(await screen.findByRole('button', { name: 'Run it' }))
    expect(await screen.findByText('The test run')).toBeInTheDocument()
    expect(
      calls.filter((call) => call.method === 'POST' && call.path.endsWith('/tests/run')),
    ).toHaveLength(1)
  })

  it('says so when the test set has never run', async () => {
    mockApi(answers({ '/api/v1/lead-finder/tests': { total: 0, items: [] } }))
    renderWithProviders(<TestSetView />)
    expect(
      await screen.findByRole('heading', { name: "The test set hasn't been run yet." }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('grid: builds the rows from the newest report, marks changes, and compares runs', () => {
    const reports = new Map(Object.entries(REPORTS))
    const grid = buildGrid(RUNS, reports)
    expect(grid.runs.map((run) => run.run_id)).toEqual([RUN_C, RUN_B, TEST_RUN_ID])
    expect(grid.rows.map((row) => row.name)).toEqual(['Canva', 'Atlassian'])
    expect(grid.rows[1]?.cells.map((cell) => [resultOf(cell.item), cell.changed])).toEqual([
      ['failed', false],
      ['drop', true],
      ['watch', true],
    ])
    // A report still loading leaves its column unknown, and the next column is not "changed"
    const partial = new Map<string, TestReport | undefined>(reports as never)
    partial.set(RUN_B, undefined)
    const sparse = buildGrid(RUNS, partial)
    expect(sparse.rows[0]?.cells.map((cell) => [resultOf(cell.item), cell.changed])).toEqual([
      ['watch', false],
      [null, false],
      ['director_review', true],
    ])
    expect(compared(RUNS[0], RUNS[1])).toBe('better')
    expect(compared(RUNS[1], RUNS[2])).toBe('same')
    expect(compared(RUNS[2], RUNS[0])).toBe('worse')
    const label = (r: string) => r
    expect(changeWords(item('a', 'watch', 30), item('a', 'watch', 35), label)).toBe(
      'Score 30 to 35',
    )
    expect(changeWords(item('a', 'watch', 30), item('a', 'watch', 30), label)).toBeNull()
    expect(changeWords(undefined, item('a', 'pass', 80), label)).toBe('New: pass')
    expect(changeWords(item('a', 'pass', 80), undefined, label)).toBe('Not in this run (was pass)')
  })
})
