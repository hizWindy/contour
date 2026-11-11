import { screen, within } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { mockApi, TEST_RUN_ID, type Call } from '@/test/mock-api'
import { renderWithProviders } from '@/test/render'
import TestSetView from './view'

describe('Test set', () => {
  it('lists past runs with their scores, shows the report and runs it after asking', async () => {
    const calls = mockApi({
      '/api/v1/lead-finder/tests': {
        total: 1,
        items: [
          {
            run_id: TEST_RUN_ID,
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
      [`/api/v1/lead-finder/tests/${TEST_RUN_ID}`]: {
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
        call.method === 'POST' ? Response.json({ id: TEST_RUN_ID }, { status: 201 }) : undefined,
    })
    const { user } = renderWithProviders(
      <Routes>
        <Route path="/" element={<TestSetView />} />
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
