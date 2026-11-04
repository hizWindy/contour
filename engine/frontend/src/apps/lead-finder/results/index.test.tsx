import { screen, waitFor, within } from '@testing-library/react'
import { Route, Routes, useLocation, useNavigate } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LeadFacets, LeadRow, MapPoint } from '@/api/types'
import { asPhone } from '@/test/screen'
import { renderWithProviders } from '@/test/render'
import { HOSTILE, LEAD_ID, makeLead } from '../lead/test-lead'
import ResultsPage from './index'

const OTHER_ID = '88888888-2222-3333-4444-555555555555'

function makeRow(changes: Partial<LeadRow> = {}): LeadRow {
  return {
    id: LEAD_ID,
    company: 'Acme Software',
    result: 'pass',
    stage: 'Active prospect',
    score: 51,
    score_checked: 77,
    band: 'investigate',
    city: 'Melbourne',
    suburb: 'Richmond',
    contact_role: 'Head of Property',
    cost_usd: '0.400000',
    created_at: '2026-10-26T04:00:00Z',
    form_failed: false,
    updated_at: '2026-10-26T04:00:00Z',
    hubspot_status: 'new',
    industry: 'Software',
    industry_group: 'Technology',
    is_test: false,
    note: null,
    office_m2: 2500,
    office_m2_estimated: false,
    origin: 'web',
    reason: 'City: Melbourne. Size: about 2,500 m².',
    run_id: null,
    staff_in_city: 250,
    status: 'new',
    trigger_date: '2028-03-01',
    trigger_id: 'lease_ending',
    trigger_ids: ['lease_ending'],
    trigger_label: 'Lease ending in 1 to 3 years',
    useful: null,
    web_searches: 6,
    ...changes,
  }
}

const ROWS: LeadRow[] = [
  makeRow(),
  makeRow({
    id: OTHER_ID,
    company: 'Basalt Mining',
    result: 'watch',
    stage: 'Target account',
    score: 41,
    score_checked: null,
    band: null,
    city: 'Perth',
    suburb: null,
    office_m2: 800,
    office_m2_estimated: true,
    trigger_label: null,
    trigger_date: null,
    hubspot_status: 'in_hubspot',
    status: 'watching',
    origin: 'hubspot',
  }),
]

const FACETS: LeadFacets = {
  result: [
    { value: 'pass', count: 1 },
    { value: 'watch', count: 1 },
  ],
  city: [
    { value: 'Melbourne', count: 1 },
    { value: 'Perth', count: 1 },
  ],
  trigger: [{ id: 'lease_ending', label: 'Lease ending in 1 to 3 years', count: 1 }],
  industry: [{ value: 'Software', count: 2 }],
  industry_group: [{ value: 'Technology', count: 2 }],
  hubspot_status: [
    { value: 'new', count: 1 },
    { value: 'in_hubspot', count: 1 },
  ],
  status: [
    { value: 'new', count: 1 },
    { value: 'watching', count: 1 },
  ],
  origin: [
    { value: 'hubspot', count: 1 },
    { value: 'web', count: 1 },
  ],
  runs: [],
  score: { min: 41, max: 78 },
  office_m2: { min: 800, max: 2500 },
  created: { min: '2026-10-26', max: '2026-10-26' },
}

const POINTS: MapPoint[] = [
  {
    id: LEAD_ID,
    name: 'Acme Software',
    result: 'pass',
    score: 78,
    city: 'Melbourne',
    suburb: 'Richmond',
    lat: -37.82,
    lng: 145.0,
  },
]

interface Backend {
  rows: LeadRow[]
  requests: URL[]
  mapTotal?: number
  exported?: Response
}

function mockApi(changes: Partial<Backend> = {}): Backend {
  const backend: Backend = { rows: ROWS, requests: [], ...changes }
  const respond = (url: URL): Response => {
    switch (url.pathname) {
      case '/api/v1/lead-finder/leads':
        return Response.json({ total: backend.rows.length, items: backend.rows })
      case '/api/v1/lead-finder/leads/facets':
        return Response.json(FACETS)
      case '/api/v1/lead-finder/leads/map':
        return Response.json({ total: backend.mapTotal ?? POINTS.length, items: POINTS })
      case '/api/v1/lead-finder/leads/export':
        return (
          backend.exported ??
          new Response('company,result\nAcme Software,pass\n', {
            headers: {
              'content-type': 'text/csv; charset=utf-8',
              'content-disposition': 'attachment; filename=leads-2026-10-26.csv',
            },
          })
        )
      case `/api/v1/lead-finder/leads/${LEAD_ID}`:
        return Response.json(makeLead())
      case `/api/v1/lead-finder/leads/${LEAD_ID}/similar`:
        return Response.json({ basis: 'none', note: null, deals: [], leads: [] })
    }
    return Response.json({ title: 'Not found', status: 404 }, { status: 404 })
  }
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request) => {
      const url = new URL(request.url)
      backend.requests.push(url)
      return Promise.resolve(respond(url))
    }),
  )
  return backend
}

/** The last request to one path, as its query. */
function lastQuery(backend: Backend, path: string): URLSearchParams {
  const found = backend.requests.filter((url) => url.pathname === `/api/v1/lead-finder${path}`)
  const last = found.at(-1)
  if (!last) {
    throw new Error(`No request to ${path}`)
  }
  return last.searchParams
}

function Address() {
  return <output aria-label="Address">{useLocation().search}</output>
}

function address(): URLSearchParams {
  return new URLSearchParams(screen.getByLabelText('Address').textContent)
}

function renderResults(search = '') {
  return renderWithProviders(
    <>
      <ResultsPage />
      <Address />
    </>,
    { route: `/results${search}` },
  )
}

afterEach(() => {
  window.localStorage.clear()
})

describe('the results page', () => {
  it('lists the leads with their result, place, sign and office, best first', async () => {
    const backend = mockApi()
    renderResults()

    const table = await screen.findByRole('table', { name: 'Leads' })
    await within(table).findByText('Basalt Mining')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('Acme Software')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Richmond, Melbourne')).toBeInTheDocument()
    expect(
      within(rows[0]).getByText('Lease ending in 1 to 3 years, 1 Mar 2028'),
    ).toBeInTheDocument()
    expect(within(rows[0]).getByText('2,500 m²')).toBeInTheDocument()
    // The score is the points earned out of the points the tool could check. A lead scored
    // under version 1 has no "checked", so it shows the points alone.
    expect(within(rows[0]).getByText('51 of 77')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Active prospect')).toBeInTheDocument()
    expect(within(rows[1]).getByText('41')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Target account')).toBeInTheDocument()
    expect(within(rows[1]).getByText('about 800 m²')).toBeInTheDocument()
    expect(within(rows[1]).getByText('None found')).toBeInTheDocument()

    const query = lastQuery(backend, '/leads')
    expect(query.get('sort')).toBe('score')
    expect(query.get('order')).toBe('desc')
    expect(query.get('limit')).toBe('50')
    expect(query.get('offset')).toBe('0')
    expect(
      within(table).getByRole('columnheader', { name: /Score/ }).getAttribute('aria-sort'),
    ).toBe('descending')
  })

  it('reads the filters and the sort from the address and sends them', async () => {
    const backend = mockApi()
    renderResults('?result=pass&city=Perth&sort=company&order=asc&page=2')
    await screen.findByRole('table', { name: 'Leads' })

    const query = lastQuery(backend, '/leads')
    expect(query.getAll('result')).toEqual(['pass'])
    expect(query.getAll('city')).toEqual(['Perth'])
    expect(query.get('sort')).toBe('company')
    expect(query.get('order')).toBe('asc')
    expect(query.get('offset')).toBe('50')
    await waitFor(() => {
      expect(lastQuery(backend, '/leads/facets').getAll('city')).toEqual(['Perth'])
    })
    expect(lastQuery(backend, '/leads/facets').has('sort')).toBe(false)
  })

  it('sorts by a column header and goes back to page 1', async () => {
    const backend = mockApi()
    const { user } = renderResults('?page=2')
    const table = await screen.findByRole('table', { name: 'Leads' })

    await user.click(within(table).getByRole('button', { name: 'Company' }))
    expect(address().get('sort')).toBe('company')
    expect(address().get('order')).toBe('asc')
    expect(address().has('page')).toBe(false)
    await waitFor(() => {
      expect(lastQuery(backend, '/leads').get('sort')).toBe('company')
    })

    await user.click(within(table).getByRole('button', { name: 'Company' }))
    expect(address().get('order')).toBe('desc')
  })

  it('filters from a pick list and by name, and clears the filters', async () => {
    const backend = mockApi()
    const { user } = renderResults('?page=3')
    await screen.findByRole('button', { name: 'Acme Software' })

    await user.click(screen.getByRole('button', { name: 'Filter by Result' }))
    await user.click(await screen.findByRole('option', { name: /^Watch/ }))
    expect(address().getAll('result')).toEqual(['watch'])
    expect(address().has('page')).toBe(false)
    await waitFor(() => {
      expect(lastQuery(backend, '/leads').getAll('result')).toEqual(['watch'])
    })
    await user.keyboard('{Escape}')

    await user.type(screen.getByRole('textbox', { name: 'Search company names' }), 'acme')
    // The search waits for a 300 ms pause in typing; a busy test machine adds to that.
    await waitFor(
      () => {
        expect(lastQuery(backend, '/leads').get('q')).toBe('acme')
      },
      { timeout: 3000 },
    )
    expect(address().get('q')).toBe('acme')

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(address().toString()).toBe('')
    expect(screen.getByRole('textbox', { name: 'Search company names' })).toHaveValue('')
  })

  it('marks where each company came from, and filters by it', async () => {
    const backend = mockApi()
    const { user } = renderResults()
    const table = await screen.findByRole('table', { name: 'Leads' })
    await within(table).findByText('Basalt Mining')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(within(rows[0]).getByText('Found')).toBeInTheDocument()
    expect(within(rows[1]).getByText('From HubSpot')).toBeInTheDocument()

    await user.hover(within(rows[1]).getByText('From HubSpot'))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'From the HubSpot watchlist: a company already in HubSpot, checked again.',
    )
    await user.unhover(within(rows[1]).getByText('From HubSpot'))

    await user.click(screen.getByRole('button', { name: 'Filter by Source' }))
    await user.click(await screen.findByRole('option', { name: /^From HubSpot/ }))
    expect(address().getAll('origin')).toEqual(['hubspot'])
    await waitFor(() => {
      expect(lastQuery(backend, '/leads').getAll('origin')).toEqual(['hubspot'])
    })
    expect(lastQuery(backend, '/leads/facets').getAll('origin')).toEqual(['hubspot'])
  })

  it('opens a lead in the side panel and closes it with Esc', async () => {
    mockApi()
    const { user } = renderResults()
    await user.click(await screen.findByRole('button', { name: 'Acme Software' }))
    const panel = await screen.findByRole('dialog', { name: 'Acme Software' })
    expect(await within(panel).findByText('Score 51 of 77 checked')).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'Open the full page' })).toHaveAttribute(
      'href',
      `/leads/${LEAD_ID}`,
    )
    expect(address().get('lead')).toBe(LEAD_ID)

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(address().has('lead')).toBe(false)
  })

  it('opens the full page with the panel dropped, so Back returns to the list as it was', async () => {
    mockApi()
    function GoBack() {
      const navigate = useNavigate()
      return (
        <button
          type="button"
          onClick={() => {
            void navigate(-1)
          }}
        >
          Browser back
        </button>
      )
    }
    const { user } = renderWithProviders(
      <>
        <Routes>
          <Route
            path="/results"
            element={
              <>
                <ResultsPage />
                <Address />
              </>
            }
          />
          <Route path="/leads/:leadId" element={<p>The full page</p>} />
        </Routes>
        <GoBack />
      </>,
      { route: `/results?city=Melbourne&lead=${LEAD_ID}` },
    )
    const panel = await screen.findByRole('dialog', { name: 'Acme Software' })

    await user.click(within(panel).getByRole('link', { name: 'Open the full page' }))
    expect(await screen.findByText('The full page')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Browser back' }))
    expect(await screen.findByRole('table', { name: 'Leads' })).toBeInTheDocument()
    expect(address().getAll('city')).toEqual(['Melbourne'])
    expect(address().has('lead')).toBe(false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('puts the filters behind one Filters button on a phone, and shows how many are set', async () => {
    asPhone()
    const backend = mockApi()
    const { user } = renderResults('?city=Melbourne')
    await screen.findByRole('button', { name: 'Acme Software' })

    // The bar is the name search and one button; the ten filters are not on the page yet.
    expect(screen.getByRole('textbox', { name: 'Search company names' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Filter by Result' })).not.toBeInTheDocument()
    const open = screen.getByRole('button', { name: /^Filters/ })
    expect(within(open).getByText('1')).toBeInTheDocument()

    await user.click(open)
    const sheet = await screen.findByRole('dialog', { name: 'Filters' })
    await user.click(within(sheet).getByRole('button', { name: 'Filter by Result' }))
    await user.click(await screen.findByRole('option', { name: /^Watch/ }))
    expect(address().getAll('result')).toEqual(['watch'])
    await waitFor(() => {
      expect(lastQuery(backend, '/leads').getAll('result')).toEqual(['watch'])
    })

    await user.keyboard('{Escape}')
    await user.click(within(sheet).getByRole('button', { name: 'Show the leads' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Filters' })).not.toBeInTheDocument()
    })
  })

  it('moves through the rows with J and K, and opens the active one with Enter', async () => {
    mockApi()
    const { user } = renderResults()
    const table = await screen.findByRole('table', { name: 'Leads' })
    await within(table).findByText('Basalt Mining')
    const row = (name: string) => within(table).getByText(name).closest('tr')

    await user.keyboard('j')
    expect(row('Acme Software')).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('j')
    expect(row('Basalt Mining')).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('k')
    expect(row('Acme Software')).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: 'Acme Software' })).toBeInTheDocument()
  })

  it('downloads the CSV of the leads that match, in the same order', async () => {
    const backend = mockApi()
    // jsdom has no object URLs. The stand-in goes away after the test (unstubGlobals).
    const created = vi.fn(() => 'blob:leads')
    class TestURL extends URL {
      static override createObjectURL = created
      static override revokeObjectURL = vi.fn()
    }
    vi.stubGlobal('URL', TestURL)
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this)
    })
    const { user } = renderResults('?city=Melbourne&sort=company&order=asc')
    await screen.findByRole('table', { name: 'Leads' })

    await user.click(screen.getByRole('button', { name: 'Download CSV' }))
    await waitFor(() => {
      expect(clicked).toHaveLength(1)
    })
    const query = lastQuery(backend, '/leads/export')
    expect(query.getAll('city')).toEqual(['Melbourne'])
    expect(query.get('sort')).toBe('company')
    expect(query.has('limit')).toBe(false)
    expect(clicked[0]?.download).toBe('leads-2026-10-26.csv')
    expect(clicked[0]?.getAttribute('href')).toBe('blob:leads')
    expect(created).toHaveBeenCalledTimes(1)
  })

  it('says why the CSV could not be made', async () => {
    mockApi({
      exported: Response.json(
        { title: 'Too many leads for one file', status: 413, code: 'too_many_rows' },
        { status: 413 },
      ),
    })
    const { user } = renderResults()
    await screen.findByRole('table', { name: 'Leads' })

    await user.click(screen.getByRole('button', { name: 'Download CSV' }))
    expect(await screen.findByText('Too many leads for one file')).toBeInTheDocument()
    expect(screen.getByText(/Narrow the filters so that fewer than 2,000/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeEnabled()
  })

  it('shows the list and the map side by side, with approximate pins', async () => {
    mockApi({ mapTotal: 2500 })
    const { user } = renderResults('?view=map')

    expect(await screen.findByRole('table', { name: 'Leads beside the map' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Leads on the map' })).toBeInTheDocument()
    expect(
      screen.getByRole('separator', { name: 'Resize the list and the map' }),
    ).toBeInTheDocument()
    const pins = await screen.findByRole('list', { name: 'Leads on the map' })
    expect(
      within(pins).getByText(/Acme Software: Pass, score 78, near Richmond/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Pins are approximate/)).toBeInTheDocument()
    expect(screen.getByText(/The map shows 1 of 2,500 leads/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Compact rows' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Table' }))
    expect(address().has('view')).toBe(false)
    expect(await screen.findByRole('table', { name: 'Leads' })).toBeInTheDocument()
  })

  it('remembers compact rows on this computer', async () => {
    mockApi()
    const { user } = renderResults()
    await screen.findByRole('table', { name: 'Leads' })

    await user.click(screen.getByRole('button', { name: 'Compact rows' }))
    expect(window.localStorage.getItem('lead-finder.results.compact')).toBe('true')
    expect(screen.getByRole('button', { name: 'Compact rows' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('says there are no leads yet, and where to start', async () => {
    mockApi({ rows: [] })
    renderResults()
    expect(await screen.findByText('No leads yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start a run' })).toHaveAttribute('href', '/start')
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDisabled()
  })

  it('says when no lead matches the filters, with a way out', async () => {
    mockApi({ rows: [] })
    const { user } = renderResults('?result=drop')
    expect(await screen.findByText('No leads match these filters.')).toBeInTheDocument()

    const clear = screen.getAllByRole('button', { name: 'Clear filters' })
    await user.click(clear.at(-1) as HTMLElement)
    expect(address().toString()).toBe('')
  })

  it('shows a hostile company name as plain text', async () => {
    mockApi({ rows: [makeRow({ company: HOSTILE })] })
    renderResults()
    expect(await screen.findByText(HOSTILE)).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })
})
