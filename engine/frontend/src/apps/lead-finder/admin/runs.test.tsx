import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { mockApi } from '@/test/mock-api'
import { renderWithProviders } from '@/test/render'
import AdminRunsTab from './runs'

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
