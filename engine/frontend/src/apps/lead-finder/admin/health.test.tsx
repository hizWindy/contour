/**
 * Admin, Health (PLAN-V13 T1-6): one row per system, problems first, what to do next, "Check
 * again", and the API's last hour as a small table.
 */
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { EndpointTraffic, HealthDetails, SystemCheck } from '@/api/types'
import { mockApi } from '@/test/mock-api'
import { renderWithProviders } from '@/test/render'
import AdminHealthTab from './health'
import { sortChecks } from './health-states'

const AT = '2026-11-10T19:02:00Z' // 6:02 am in Melbourne

function check(id: SystemCheck['id'], name: string, extra: Partial<SystemCheck> = {}): SystemCheck {
  return {
    id,
    name,
    state: 'ok',
    sentence: 'Fine.',
    next_step: null,
    took_ms: 40,
    checked_at: AT,
    ...extra,
  }
}

function endpoint(path: string, extra: Partial<EndpointTraffic> = {}): EndpointTraffic {
  return {
    method: 'GET',
    path,
    requests: 10,
    errors: 0,
    unavailable: 0,
    refused: 0,
    average_ms: 20,
    slowest_ms: 80,
    last_error_at: null,
    last_error_status: null,
    ...extra,
  }
}

function details(extra: Partial<HealthDetails> = {}): HealthDetails {
  return {
    checked_at: AT,
    fresh_until: '2026-11-10T19:03:00Z',
    checks: [
      check('database', 'Database', { sentence: 'It answers. pgvector 0.8.1, migration 0014.' }),
      check('claude', 'Claude', { sentence: 'Key works.' }),
      check('hubspot', 'HubSpot', {
        state: 'problem',
        sentence: 'No sync has finished yet.',
        next_step: 'Start one on the HubSpot tab.',
        took_ms: 1830,
      }),
      check('email', 'Email', {
        state: 'off',
        sentence: 'Emails are written to the backend log, not sent.',
        next_step: 'To send them, set EMAIL_PROVIDER=resend.',
      }),
    ],
    schedules: [],
    api: {
      since: '2026-11-10T18:02:00Z',
      requests: 312,
      errors: 2,
      unavailable: 0,
      endpoints: [
        endpoint('/api/v1/runs/{run_id}', {
          errors: 2,
          requests: 40,
          last_error_at: AT,
          last_error_status: 500,
        }),
        endpoint('/api/v1/companies', { slowest_ms: 840 }),
        ...Array.from({ length: 8 }, (_, index) => endpoint(`/api/v1/other/${String(index)}`)),
      ],
    },
    ...extra,
  }
}

describe('Admin, Health', () => {
  it('lists problems first, then what is off, then what is fine', () => {
    expect(sortChecks(details().checks).map((item) => item.id)).toEqual([
      'hubspot',
      'email',
      'database',
      'claude',
    ])
  })

  it('shows each system with an icon and a word, the sentence, the time and what to do next', async () => {
    mockApi({ '/api/v1/health/details': details() })
    renderWithProviders(<AdminHealthTab />)
    const systems = await screen.findByRole('list', { name: 'Systems' })
    const rows = within(systems).getAllByRole('listitem')
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      'HubSpot: Problem',
      'Email: Off',
      'Database: OK',
      'Claude: OK',
    ])
    expect(within(rows[0]).getByText('No sync has finished yet.')).toBeInTheDocument()
    expect(within(rows[0]).getByText(/Next: Start one on the HubSpot tab\./)).toBeInTheDocument()
    expect(within(rows[0]).getByText('1.8 s')).toHaveAttribute('title', 'Checked at 6:02 am')
    expect(within(rows[2]).queryByText(/Next:/)).toBeNull()
    expect(screen.getByText('Checked at 6:02 am. 1 system needs you.')).toBeInTheDocument()
  })

  it('checks again on request, asking for a fresh look', async () => {
    const calls = mockApi({
      '/api/v1/health/details': (call: { search: string }) =>
        Response.json(
          call.search.includes('refresh=true')
            ? details({ checks: [check('database', 'Database', { sentence: 'Fresh.' })] })
            : details(),
        ),
    })
    const { user } = renderWithProviders(<AdminHealthTab />)
    await screen.findByRole('list', { name: 'Systems' })
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByText('Fresh.')).toBeInTheDocument()
    await waitFor(() => {
      expect(calls.filter((call) => call.search.includes('refresh=true'))).toHaveLength(1)
    })
  })

  it('shows the API as a small table, failed first, and the rest behind "Show all"', async () => {
    mockApi({ '/api/v1/health/details': details() })
    const { user } = renderWithProviders(<AdminHealthTab />)
    const table = await screen.findByRole('table', { name: 'API endpoints' })
    expect(screen.getByText(/^312 requests, 2 failed\. Failed first/)).toBeInTheDocument()
    expect(within(table).queryByRole('columnheader', { name: 'Not ready' })).toBeNull()
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(8)
    expect(rows[0]).toHaveTextContent('/api/v1/runs/{run_id}')
    expect(within(rows[0]).getByText('2').closest('td')).toHaveAttribute(
      'title',
      'The last answered 500 at 6:02 am',
    )
    await user.click(screen.getByRole('button', { name: 'Show all 10' }))
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(10)
  })

  it('counts "not ready" (503) apart: said plainly, never a failure', async () => {
    mockApi({
      '/api/v1/health/details': details({
        api: {
          since: '2026-11-10T18:02:00Z',
          requests: 312,
          errors: 0,
          unavailable: 5,
          endpoints: [
            endpoint('/api/v1/runs/{run_id}', { requests: 9, unavailable: 5 }),
            endpoint('/api/v1/companies'),
          ],
        },
      }),
    })
    renderWithProviders(<AdminHealthTab />)
    const table = await screen.findByRole('table', { name: 'API endpoints' })
    expect(
      screen.getByText(/^312 requests, none failed, 5 not ready \(503\)\./),
    ).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Not ready' })).toBeInTheDocument()
    const first = within(table).getAllByRole('row')[1]
    expect(
      within(first)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['GET /api/v1/runs/{run_id}', '9', '0', '5', '80 ms'])
  })

  it('says plainly when the checks are not open to this person', async () => {
    mockApi({
      '/api/v1/health/details': () =>
        Response.json(
          { title: 'Admins only', detail: 'Only an Admin can do this.', status: 403 },
          { status: 403 },
        ),
    })
    renderWithProviders(<AdminHealthTab />)
    expect(await screen.findByText('Only an Admin can do this.')).toBeInTheDocument()
  })
})
