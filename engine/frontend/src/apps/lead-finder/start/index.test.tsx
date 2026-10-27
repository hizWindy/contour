import { screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { RunEstimate } from '@/api/types'
import { renderWithProviders } from '@/test/render'
import { asPhone } from '@/test/screen'
import StartPage from './index'
import { OPTIONS } from './test-options'

const RUN_ID = '0f3c9a2e-1111-2222-3333-444444444444'

function estimate(changes: Partial<RunEstimate> = {}): RunEstimate {
  return {
    valid: true,
    errors: [],
    blocked: null,
    warnings: [],
    slices: 1,
    companies_expected: 10,
    cost_usd_low: '4.40',
    cost_usd_high: '25.60',
    cap_usd: '20.00',
    daily_left_usd: '50.00',
    basis: 'Defaults: no past runs yet',
    over_cap: true,
    ...changes,
  }
}

interface Api {
  estimates: unknown[]
  starts: Request[]
}

/** The API the page talks to. `answer` decides the estimate for a body. */
function mockApi(answer: (body: { mode: string; params: Record<string, unknown> }) => RunEstimate) {
  const seen: Api = { estimates: [], starts: [] }
  const fetchMock = vi.fn(async (request: Request) => {
    const path = new URL(request.url).pathname
    if (path === '/api/v1/lead-finder/run-options') {
      return Response.json(OPTIONS)
    }
    if (path === '/api/v1/runs/estimate') {
      const body = (await request.json()) as { mode: string; params: Record<string, unknown> }
      seen.estimates.push(body)
      return Response.json(answer(body))
    }
    if (path === '/api/v1/runs' && request.method === 'POST') {
      seen.starts.push(request)
      return Response.json({ id: RUN_ID, status: 'queued' }, { status: 201 })
    }
    return Response.json({ title: 'Not found', status: 404 }, { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return seen
}

function renderStart() {
  return renderWithProviders(
    <Routes>
      <Route path="/start" element={<StartPage />} />
      <Route path="/runs/:runId" element={<p>The run page</p>} />
    </Routes>,
    { route: '/start' },
  )
}

describe('the Start page', () => {
  it('shows the cost of the default choice once the choices settle', async () => {
    const seen = mockApi(() => estimate())
    renderStart()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Start a run' }),
    ).toBeInTheDocument()
    const cost = await screen.findByRole('complementary', { name: 'Cost' })
    await within(cost).findByText('about US$4.40')
    expect(within(cost).getByText('US$25.60')).toBeInTheDocument()
    expect(seen.estimates).toEqual([
      {
        app: 'lead_finder',
        mode: 'discovery',
        params: { cities: ['Melbourne'], triggers: ['lease_ending'], since_days: 30, area: {} },
      },
    ])
    expect(screen.getByRole('button', { name: 'Start run' })).toBeEnabled()
  })

  it('narrows a city to its CBD and asks for a new estimate', async () => {
    const seen = mockApi(() => estimate())
    const { user } = renderStart()
    await screen.findByRole('radiogroup', { name: 'Part of Melbourne' })

    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Part of Melbourne' })).getByText('CBD'),
    )

    await waitFor(() => {
      expect(seen.estimates.at(-1)).toMatchObject({ params: { area: { Melbourne: 'cbd' } } })
    })
  })

  it('keeps the watchlist off until Levi says yes, and says why', async () => {
    const blocked = { code: 'hubspot_names_not_approved', message: "Waits for Levi's OK." }
    mockApi((body) => (body.mode === 'watchlist' ? estimate({ blocked }) : estimate()))
    const { user } = renderStart()
    await screen.findByRole('button', { name: 'Start run' })

    await user.click(screen.getByRole('radio', { name: 'HubSpot watchlist' }))

    expect(await screen.findByText("Waits for Levi's OK.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start run' })).toBeDisabled()
  })

  it('shows a refused name beside its field and keeps Start off', async () => {
    mockApi((body) =>
      body.mode === 'company'
        ? estimate({
            valid: false,
            errors: [{ field: 'body.params.companies.0.name', message: 'Use 2 to 80 characters' }],
          })
        : estimate(),
    )
    const { user } = renderStart()
    await screen.findByRole('button', { name: 'Start run' })
    await user.click(screen.getByRole('radio', { name: 'Companies by name' }))
    await user.type(screen.getByLabelText('Name'), 'X')

    expect(await screen.findByText('Use 2 to 80 characters')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Start run' })).toBeDisabled()
  })

  it('keeps the cost and the Start button in a bar at the bottom of a phone screen', async () => {
    asPhone()
    const seen = mockApi(() => estimate())
    const { user } = renderStart()

    const bar = await screen.findByRole('button', { name: 'Start run' })
    // One Start button, in the bar. The cost card above no longer has its own.
    expect(screen.getAllByRole('button', { name: 'Start run' })).toHaveLength(1)
    const barBox = bar.closest('[data-slot=start-bar]') as HTMLElement
    expect(barBox).toHaveClass('sticky', 'bottom-0')
    expect(await within(barBox).findByText('about US$4.40')).toBeInTheDocument()
    expect(
      within(barBox).getByText(/Run limit US\$20\.00\. Left today US\$50\.00\./),
    ).toBeInTheDocument()

    await waitFor(() => {
      expect(bar).toBeEnabled()
    })
    await user.click(bar)
    expect(await screen.findByText('The run page')).toBeInTheDocument()
    expect(seen.starts).toHaveLength(1)
  })

  it('has no bar on a laptop: the Start button is in the cost card', async () => {
    mockApi(() => estimate())
    renderStart()
    const cost = await screen.findByRole('complementary', { name: 'Cost' })
    expect(within(cost).getByRole('button', { name: 'Start run' })).toBeInTheDocument()
    expect(document.querySelector('[data-slot=start-bar]')).toBeNull()
  })

  it('starts the run with an Idempotency-Key and opens its page', async () => {
    const seen = mockApi(() => estimate())
    const { user } = renderStart()
    const start = await screen.findByRole('button', { name: 'Start run' })
    await waitFor(() => {
      expect(start).toBeEnabled()
    })

    await user.click(start)

    expect(await screen.findByText('The run page')).toBeInTheDocument()
    expect(seen.starts).toHaveLength(1)
    expect(seen.starts[0]?.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/)
  })
})
