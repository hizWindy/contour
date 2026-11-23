import { screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { RunEstimate, RunOptions } from '@/api/types'
import { renderWithProviders } from '@/test/render'
import { asPhone } from '@/test/screen'
import StartPage from './index'
import { OPTIONS, PROPERTY_DAILY_OFF } from './test-options'

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
    target_companies: null,
    target_cost_usd_low: null,
    target_cost_usd_high: null,
    target_note: null,
    ...changes,
  }
}

interface Api {
  estimates: unknown[]
  starts: Request[]
}

/** The API the page talks to. `answer` decides the estimate for a body. */
function mockApi(
  answer: (body: { mode: string; params: Record<string, unknown> }) => RunEstimate,
  options: RunOptions = OPTIONS,
) {
  const seen: Api = { estimates: [], starts: [] }
  const fetchMock = vi.fn(async (request: Request) => {
    const path = new URL(request.url).pathname
    if (path === '/api/v1/lead-finder/run-options') {
      return Response.json(options)
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
        params: {
          cities: ['Melbourne'],
          triggers: ['lease_ending'],
          since_days: 90,
          area: {},
          target_companies: 50,
        },
      },
    ])
    expect(screen.getByRole('button', { name: 'Start run' })).toBeEnabled()
  })

  it('offers 7 days, 30 days, 90 days and 6 months, in a control that hugs its labels (PLAN-V21 T3-2)', async () => {
    const seen = mockApi(() => estimate())
    const { user } = renderStart()
    const since = await screen.findByRole('radiogroup', { name: 'How far back' })
    expect(
      within(since)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['7 days', '30 days', '90 days', '6 months'])
    expect(within(since).getByRole('radio', { name: '90 days' })).toBeChecked()
    // The vertical Field stretches each direct child, so the control sits in a wrapper of its own
    // and keeps its own width (it once spread across the card).
    expect(since.parentElement).toHaveAttribute('data-slot', 'since-days')
    expect(since.parentElement?.parentElement).toHaveAttribute('data-slot', 'field')
    expect(since).not.toHaveClass('w-full')

    await user.click(within(since).getByRole('radio', { name: '6 months' }))
    await waitFor(() => {
      expect(seen.estimates.at(-1)).toMatchObject({ params: { since_days: 180 } })
    })
  })

  it('opens on Find new leads, with no kind of run to pick (PLAN-V27 choice 1)', async () => {
    const seen = mockApi(() => estimate())
    renderStart()
    expect(
      await screen.findByText(
        'Find new leads: search the news for companies with a sign of an office change. Companies already in HubSpot are left out.',
      ),
    ).toBeInTheDocument()
    expect(await screen.findByRole('group', { name: 'Where to look' })).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'Kind of run' })).toBeNull()
    expect(screen.queryByText('Old offices (lease and tenure)')).toBeNull()
    expect(screen.queryByText('HubSpot watchlist')).toBeNull()
    expect(screen.queryByText('Companies by name')).toBeNull()
    await waitFor(() => {
      expect(seen.estimates.at(-1)).toMatchObject({ mode: 'discovery' })
    })
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

  it('keeps the cost and the Start button in a bar at the bottom of a phone screen', async () => {
    asPhone()
    const seen = mockApi(() => estimate())
    const { user } = renderStart()

    const bar = await screen.findByRole('button', { name: 'Start run' })
    // One Start button, in the bar. The cost card above no longer has its own.
    expect(screen.getAllByRole('button', { name: 'Start run' })).toHaveLength(1)
    const barBox = bar.closest('[data-slot=start-bar]') as HTMLElement
    expect(barBox).toHaveClass('sticky', 'bottom-0')
    // A field the keyboard lands on scrolls above the bar (WCAG 2.4.11).
    expect(document.documentElement.style.scrollPaddingBottom).toBe('7rem')
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
    // The bar went with the page, and so did its room.
    expect(document.documentElement.style.scrollPaddingBottom).toBe('')
  })

  it('has no bar on a laptop: the Start button is in the cost card', async () => {
    mockApi(() => estimate())
    renderStart()
    const cost = await screen.findByRole('complementary', { name: 'Cost' })
    expect(within(cost).getByRole('button', { name: 'Start run' })).toBeInTheDocument()
    expect(document.querySelector('[data-slot=start-bar]')).toBeNull()
    expect(document.documentElement.style.scrollPaddingBottom).toBe('')
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

describe('Find new leads across Australia (PLAN-V16 T3-2)', () => {
  it('shows the cities in four groups, with All of Australia first', async () => {
    mockApi(() => estimate())
    renderStart()
    const all = await screen.findByRole('group', { name: 'All of Australia' })
    const groups = ['Priority', 'Secondary', 'Capitals', 'Regional'].map((name) =>
      screen.getByRole('group', { name }),
    )
    // All of Australia comes before the four groups on the page.
    for (const group of groups) {
      expect(all.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expect(within(groups[0]).getByRole('button', { name: 'Melbourne' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(groups[2]).getByRole('button', { name: 'Darwin' })).toBeInTheDocument()
    expect(within(groups[3]).getByRole('button', { name: 'Geelong' })).toBeInTheDocument()
  })

  it('picking All of Australia clears the cities and sends Australia alone', async () => {
    const seen = mockApi(() => estimate())
    const { user } = renderStart()
    const all = await screen.findByRole('group', { name: 'All of Australia' })

    await user.click(within(all).getByRole('button', { name: 'All of Australia' }))

    expect(within(all).getByRole('button', { name: 'All of Australia' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Melbourne' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.queryByRole('radiogroup', { name: 'Part of Melbourne' })).toBeNull()
    await waitFor(() => {
      expect(seen.estimates.at(-1)).toMatchObject({ params: { cities: ['Australia'], area: {} } })
    })

    // A city picked after it takes its place.
    await user.click(screen.getByRole('button', { name: 'Geelong' }))
    expect(within(all).getByRole('button', { name: 'All of Australia' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await waitFor(() => {
      expect(seen.estimates.at(-1)).toMatchObject({ params: { cities: ['Geelong'] } })
    })
  })

  it('does not ask how many leads: a run researches every company it chooses', async () => {
    const seen = mockApi(() => estimate())
    renderStart()

    await screen.findByRole('group', { name: 'Where to look' })
    expect(screen.queryByLabelText('How many leads')).toBeNull()
    expect(screen.queryByText(/Tier A or B\. The run stops/)).toBeNull()
    await waitFor(() => {
      expect(seen.estimates.length).toBeGreaterThan(0)
    })
    const sent = seen.estimates.at(-1) as { params: Record<string, unknown> }
    expect(sent.params).not.toHaveProperty('goal_leads')
  })

  it('greys out a tool that is not ready and says why', async () => {
    const seen = mockApi(() => estimate())
    const { user } = renderStart()
    const look = await screen.findByRole('group', { name: 'Where to look' })

    const daily = within(look).getByRole('checkbox', { name: 'Property Daily' })
    expect(daily).toBeDisabled()
    expect(daily).not.toBeChecked()
    expect(daily).toHaveAccessibleDescription(PROPERTY_DAILY_OFF)
    expect(within(look).getByRole('checkbox', { name: 'The web' })).toBeChecked()
    expect(within(look).getByRole('checkbox', { name: 'Arealytics' })).toBeChecked()

    // The ready ones are the server's default, so they stay out of the body until changed.
    await waitFor(() => {
      expect(seen.estimates.at(-1)).not.toHaveProperty('params.sources')
    })
    await user.click(within(look).getByRole('checkbox', { name: 'Arealytics' }))
    await waitFor(() => {
      expect(seen.estimates.at(-1)).toMatchObject({ params: { sources: ['web'] } })
    })
  })
})

describe('How many companies (PLAN-V21 T3-3)', () => {
  /** A discovery estimate with the cost of its target, as the backend gives it. */
  function withTarget(body: { params: Record<string, unknown> }): RunEstimate {
    const target =
      typeof body.params.target_companies === 'number' ? body.params.target_companies : 50
    return estimate({
      companies_expected: target,
      target_companies: target,
      target_cost_usd_low: '22.40',
      target_cost_usd_high: '27.10',
    })
  }

  it('sits under the signs, with the presets, a number field and the cost of that many', async () => {
    const seen = mockApi(withTarget)
    const { user } = renderStart()
    const presets = await screen.findByRole('radiogroup', { name: 'Suggested numbers' })
    expect(
      within(presets)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['25', '50', '70'])
    expect(within(presets).getByRole('radio', { name: '50' })).toBeChecked()
    const field = screen.getByLabelText('Companies to research')
    expect(field).toHaveValue('50')
    expect(
      await screen.findByText('About US$22.40 to US$27.10 for 50 companies.'),
    ).toBeInTheDocument()
    const signs = screen.getByText('Signs of an office change')
    const many = screen.getByText('How many companies')
    const sources = screen.getByText('Sources')
    expect(signs.compareDocumentPosition(many) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(many.compareDocumentPosition(sources) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await user.click(within(presets).getByRole('radio', { name: '25' }))
    expect(field).toHaveValue('25')
    await waitFor(() => {
      expect(seen.estimates.at(-1)).toMatchObject({ params: { target_companies: 25 } })
    })

    await user.clear(field)
    await user.type(field, '40 companies')
    await waitFor(() => {
      expect(seen.estimates.at(-1)).toMatchObject({ params: { target_companies: 40 } })
    })
    expect(within(presets).queryByRole('radio', { checked: true })).toBeNull()
  })

  it("shows the estimate's sentence when the target does not fit the money limits", async () => {
    const note = 'At about US$0.40 a company, 70 companies may cost more than the run limit.'
    mockApi((body) => ({ ...withTarget(body), target_note: note }))
    renderStart()
    expect(await screen.findByText(note)).toBeInTheDocument()
  })

  it('starts the run with the target, and offers no top up (PLAN-V27 choice 5)', async () => {
    const seen = mockApi(withTarget)
    const { user } = renderStart()
    const presets = await screen.findByRole('radiogroup', { name: 'Suggested numbers' })
    await user.click(within(presets).getByRole('radio', { name: '70' }))
    expect(screen.queryByRole('switch', { name: 'Top up from the HubSpot watchlist' })).toBeNull()

    const start = screen.getByRole('button', { name: 'Start run' })
    await waitFor(() => {
      expect(seen.estimates.at(-1)).toMatchObject({ params: { target_companies: 70 } })
      expect(start).toBeEnabled()
    })
    await user.click(start)
    expect(await screen.findByText('The run page')).toBeInTheDocument()
    const sent = (await seen.starts[0]?.json()) as { params: Record<string, unknown> }
    expect(sent.params).toMatchObject({ target_companies: 70 })
    expect(sent.params).not.toHaveProperty('top_up')
  })

  it('aims for a lower "Most companies to research" and says so, keeping the form valid', async () => {
    const seen = mockApi(withTarget)
    const { user } = renderStart()
    await screen.findByLabelText('Companies to research')
    await user.click(screen.getByRole('button', { name: 'Lower the limits for this run' }))
    await user.type(screen.getByLabelText('Most companies to research'), '30')

    expect(
      await screen.findByText('The run aims for 30, the most companies its limits below allow.'),
    ).toBeInTheDocument()
    // The typed target stays, so raising the limit again brings it back.
    expect(screen.getByLabelText('Companies to research')).toHaveValue('50')
    await waitFor(() => {
      expect(seen.estimates.at(-1)).toMatchObject({
        params: { target_companies: 30, caps: { max_companies: 30 } },
      })
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says why beside the field and keeps Start off when the number cannot be read', async () => {
    mockApi(withTarget)
    const { user } = renderStart()
    const field = await screen.findByLabelText('Companies to research')
    await user.clear(field)
    await user.type(field, 'lots')

    expect(await screen.findByText('Type a whole number, like 50.')).toBeInTheDocument()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Fix the choices marked in red first.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start run' })).toBeDisabled()
  })
})

describe('a company limit that leaves one preset (PLAN-V21 T3-3)', () => {
  it('shows the number field alone, since one preset would only repeat it', async () => {
    mockApi(() => estimate(), {
      ...OPTIONS,
      target_companies: { default: 20, min: 5, max: 20, presets: [20] },
    })
    renderStart()
    const field = await screen.findByLabelText('Companies to research')
    expect(field).toHaveValue('20')
    expect(screen.queryByRole('radiogroup', { name: 'Suggested numbers' })).toBeNull()
    expect(screen.getByText(/From 5 to 20\./)).toBeInTheDocument()
  })
})
