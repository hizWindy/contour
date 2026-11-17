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
          top_up: true,
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

  it('shows "What to do" as four cards, each with its line, and the arrows only move the focus (PLAN-V21 T3-1)', async () => {
    const seen = mockApi(() => estimate())
    const { user } = renderStart()
    const kinds = await screen.findByRole('radiogroup', { name: 'Kind of run' })
    const cards = within(kinds).getAllByRole('radio')
    expect(cards).toHaveLength(4)
    expect(
      within(kinds).getByRole('radio', { name: 'Find new leads' }),
    ).toHaveAccessibleDescription('Search the news for companies with a sign of an office change.')
    expect(
      within(kinds).getByRole('radio', { name: 'Companies by name' }),
    ).toHaveAccessibleDescription('Research the companies you type in.')
    // Two columns from 640px, as long as the cards' own box has room for two.
    expect(kinds).toHaveClass('sm:@min-[30rem]:grid-cols-2')

    await screen.findByRole('group', { name: 'Where to look' })
    cards[0]?.focus()
    await user.keyboard('{ArrowRight}')
    expect(cards[1]).toHaveFocus()
    // The arrow moved the focus only: the form is still "Find new leads".
    expect(screen.getByRole('group', { name: 'Where to look' })).toBeInTheDocument()
    await user.keyboard(' ')
    expect(await screen.findByText('Which old offices')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Where to look' })).toBeNull()
    await waitFor(() => {
      expect(seen.estimates.length).toBeGreaterThan(0)
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

describe('Old offices (lease and tenure), PLAN-V11 C3', () => {
  const INDUSTRIES = [
    { value: 'Information Technology & Services', count: 25 },
    { value: 'Construction', count: 21 },
  ]

  /** Like `mockApi`, with Levi's OK on and the free watchlist preview answering. */
  function mockTenureApi() {
    const seen = {
      estimates: [] as { mode: string; params: Record<string, unknown> }[],
      starts: [] as { mode: string; params: Record<string, unknown> }[],
      previews: [] as URLSearchParams[],
    }
    const options = {
      ...OPTIONS,
      modes: OPTIONS.modes.map((mode) =>
        mode.mode === 'watchlist' ? { ...mode, approved: true } : mode,
      ),
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = new URL(request.url)
        if (url.pathname === '/api/v1/lead-finder/run-options') {
          return Response.json(options)
        }
        if (url.pathname === '/api/v1/lead-finder/watchlist') {
          seen.previews.push(url.searchParams)
          const picked = url.searchParams.getAll('industry').length > 0
          return Response.json({
            total: picked ? 25 : 333,
            items: [],
            director: [],
            staff_unknown: [],
            counts: {},
            industries: INDUSTRIES,
          })
        }
        if (url.pathname === '/api/v1/runs/estimate') {
          seen.estimates.push((await request.json()) as never)
          return Response.json(estimate())
        }
        if (url.pathname === '/api/v1/runs' && request.method === 'POST') {
          seen.starts.push((await request.json()) as never)
          return Response.json({ id: RUN_ID, status: 'queued' }, { status: 201 })
        }
        return Response.json({ title: 'Not found', status: 404 }, { status: 404 })
      }),
    )
    return seen
  }

  it('is the second choice, next to Find new leads', async () => {
    mockTenureApi()
    renderStart()
    const kinds = await screen.findByRole('radiogroup', { name: 'Kind of run' })
    const cards = within(kinds).getAllByRole('radio')
    expect(cards.map((card) => card.getAttribute('aria-labelledby'))).not.toContain(null)
    cards.forEach((card, index) => {
      expect(card).toHaveAccessibleName(
        [
          'Find new leads',
          'Old offices (lease and tenure)',
          'HubSpot watchlist',
          'Companies by name',
        ][index],
      )
    })
  })

  it('picks a city and industries, with the free count of its watchlist companies', async () => {
    const seen = mockTenureApi()
    const { user } = renderStart()
    await user.click(await screen.findByRole('radio', { name: 'Old offices (lease and tenure)' }))

    const city = await screen.findByRole('radiogroup', { name: 'City' })
    expect(within(city).getByRole('radio', { name: 'Melbourne' })).toBeChecked()
    await user.click(within(city).getByRole('radio', { name: 'Adelaide' }))
    expect(
      await screen.findByText(
        '333 watchlist companies in Adelaide. Counting them is free: nothing goes to Claude.',
      ),
    ).toBeInTheDocument()
    expect(seen.previews.some((query) => query.get('city') === 'Adelaide')).toBe(true)

    await user.click(screen.getByRole('button', { name: /Industries/ }))
    await user.click(await screen.findByRole('option', { name: /Information Technology/ }))
    expect(
      await screen.findByText(
        '25 watchlist companies in Adelaide in these industries. Counting them is free: nothing goes to Claude.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('How many companies')).toHaveValue('10')
    await waitFor(() => {
      expect(seen.estimates.at(-1)).toEqual({
        app: 'lead_finder',
        mode: 'watchlist',
        params: {
          watchlist: {
            focus: 'tenure',
            city: 'Adelaide',
            industries: ['Information Technology & Services'],
            limit: 10,
          },
        },
      })
    })
  })

  it('asks before it spends, then starts the watchlist run that asks the office questions', async () => {
    const seen = mockTenureApi()
    const { user } = renderStart()
    await user.click(await screen.findByRole('radio', { name: 'Old offices (lease and tenure)' }))
    await screen.findByText(/333 watchlist companies in Melbourne/)
    const start = screen.getByRole('button', { name: 'Start run' })
    await waitFor(() => {
      expect(start).toBeEnabled()
    })

    await user.click(start)
    const confirm = await screen.findByRole('alertdialog', { name: 'Start the old offices run?' })
    expect(
      within(confirm).getByText(
        'It researches 10 companies in Melbourne, the most staff first, and sends their names to Claude. It costs about US$4.40, and at most US$25.60. It stops at the run limit of US$20.00.',
      ),
    ).toBeInTheDocument()
    expect(seen.starts).toHaveLength(0) // nothing is spent until the second yes

    await user.click(within(confirm).getByRole('button', { name: 'Start run' }))
    expect(await screen.findByText('The run page')).toBeInTheDocument()
    expect(seen.starts).toEqual([
      {
        app: 'lead_finder',
        mode: 'watchlist',
        params: { watchlist: { focus: 'tenure', city: 'Melbourne', limit: 10 } },
      },
    ])
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

describe('How many companies and the top up (PLAN-V21 T3-3)', () => {
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

  it('starts the run with the target and the top up', async () => {
    const seen = mockApi(withTarget)
    const { user } = renderStart()
    const presets = await screen.findByRole('radiogroup', { name: 'Suggested numbers' })
    await user.click(within(presets).getByRole('radio', { name: '70' }))
    const topUp = screen.getByRole('switch', { name: 'Top up from the HubSpot watchlist' })
    expect(topUp).toBeChecked()
    expect(topUp).toHaveAccessibleDescription(
      'If the searches come up short of the number, the run adds companies from the HubSpot watchlist in the same places, most likely first.',
    )
    await user.click(topUp)
    expect(topUp).not.toBeChecked()

    const start = screen.getByRole('button', { name: 'Start run' })
    await waitFor(() => {
      expect(seen.estimates.at(-1)).toMatchObject({
        params: { target_companies: 70, top_up: false },
      })
      expect(start).toBeEnabled()
    })
    await user.click(start)
    expect(await screen.findByText('The run page')).toBeInTheDocument()
    const sent = (await seen.starts[0]?.json()) as { params: Record<string, unknown> }
    expect(sent.params).toMatchObject({ target_companies: 70, top_up: false })
  })

  it('greys the top up with the reason while HubSpot names may not go to Claude', async () => {
    const message = "Waits for Levi's OK to send HubSpot names to Claude."
    const seen = mockApi(withTarget, {
      ...OPTIONS,
      top_up: { default: true, allowed: false, message },
    })
    renderStart()
    const topUp = await screen.findByRole('switch', { name: 'Top up from the HubSpot watchlist' })
    expect(topUp).toBeDisabled()
    expect(topUp).not.toBeChecked()
    expect(topUp).toHaveAccessibleDescription(message)
    await waitFor(() => {
      expect(seen.estimates.at(-1)).toMatchObject({ params: { top_up: false } })
    })
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
