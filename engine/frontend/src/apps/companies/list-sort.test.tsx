/**
 * The Companies list sorts by last activity, the newest first (PLAN-V18 T2-6), against the
 * contract and a fake server that sorts as Track 1's does: the newest last activity first, and
 * companies with none last, A to Z. Until M1, `last_activity` is hand written (`params.ts`).
 * In a file of its own, so the two website tracks never edit the same test file. Made-up names.
 */
import { screen, waitFor, within } from '@testing-library/react'
import { useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { CompanyRow } from '@/api/types'
import { renderWithProviders } from '@/test/render'
import { asPhone } from '@/test/screen'
import CompaniesPage from './index'
import { listQuery, readCompanies } from './params'
import { HOME_COMPANIES } from './prefetch'

const API = '/api/v1/companies'

/** A row as the server sends it, with its last activity (a date) or none. */
type Row = CompanyRow & { last_activity: string | null }

function row(changes: Partial<Row>): Row {
  return {
    key: '101',
    name: 'Sample Logistics Pty Ltd',
    domain: 'samplelogistics.com.au',
    city: 'Perth',
    industry: 'Logistics',
    staff: 300,
    owner: 'Jo Sample',
    last_talk: '2026-10-01',
    last_activity: '2026-11-10',
    next_lease_end: '2027-06-30',
    deal: 'open',
    source: 'hubspot',
    lead_result: null,
    lead_score: null,
    ...changes,
  }
}

const ROWS: Row[] = [
  row({ key: '101', name: 'Sample Logistics Pty Ltd', last_activity: '2026-11-10' }),
  row({ key: '102', name: 'Sample Mining Pty Ltd', last_activity: '2026-03-02', last_talk: null }),
  row({ key: '103', name: 'Sample Freight Pty Ltd', last_activity: null, last_talk: null }),
  row({ key: '104', name: 'Sample Energy Pty Ltd', last_activity: null, last_talk: null }),
]

/** As Track 1 sorts: by last activity (newest first; none last, A to Z), or by name. */
function sorted(sort: string, order: string): Row[] {
  const byName = (a: Row, b: Row) => a.name.localeCompare(b.name)
  if (sort === 'name') {
    return [...ROWS].sort((a, b) => (order === 'asc' ? byName(a, b) : byName(b, a)))
  }
  return [...ROWS].sort((a, b) => {
    if (a.last_activity === null || b.last_activity === null) {
      if (a.last_activity === b.last_activity) return byName(a, b)
      return a.last_activity === null ? 1 : -1
    }
    const newest = b.last_activity.localeCompare(a.last_activity)
    return order === 'asc' ? -newest : newest
  })
}

function mockServer(): URL[] {
  const asked: URL[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request) => {
      const url = new URL(request.url)
      if (url.pathname === API) {
        asked.push(url)
        const items = sorted(
          url.searchParams.get('sort') ?? 'last_activity',
          url.searchParams.get('order') ?? 'desc',
        )
        return Promise.resolve(Response.json({ total: items.length, items, leads_shown: false }))
      }
      if (url.pathname === `${API}/facets`) {
        return Promise.resolve(
          Response.json({ cities: [], owners: [], deals: [], sources: [], leads_shown: false }),
        )
      }
      if (url.pathname === '/api/v1/hubspot/syncs') return Promise.resolve(Response.json([]))
      if (url.pathname === `${API}/preps/today`) return Promise.resolve(Response.json([]))
      return Promise.resolve(Response.json({ title: 'Not found', status: 404 }, { status: 404 }))
    }),
  )
  return asked
}

function Address() {
  return <output aria-label="Address">{useLocation().search}</output>
}

function renderCompanies(search = '') {
  return renderWithProviders(
    <>
      <CompaniesPage />
      <Address />
    </>,
    { route: `/companies${search}` },
  )
}

function names(table: HTMLElement): string[] {
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((tableRow) => tableRow.dataset.rowId ?? '')
}

describe('the newest activity first', () => {
  it('is the plain list: it asks for last activity, newest first, and keeps a plain address', async () => {
    const asked = mockServer()
    renderCompanies()
    const table = await screen.findByRole('table', { name: 'Companies' })
    await within(table).findByText('Sample Logistics Pty Ltd')
    const list = asked.at(-1)
    expect(list?.searchParams.get('sort')).toBe('last_activity')
    expect(list?.searchParams.get('order')).toBe('desc')
    expect(screen.getByLabelText('Address')).toHaveTextContent(/^$/)
    // In the server's order: the newest first, then none, A to Z.
    expect(names(table)).toEqual(['101', '102', '104', '103'])
  })

  it("shows each company's last activity in its column, whose header shows the sort", async () => {
    mockServer()
    renderCompanies()
    const table = await screen.findByRole('table', { name: 'Companies' })
    await within(table).findByText('Sample Logistics Pty Ltd')
    const header = within(table).getByRole('columnheader', { name: /Last activity/ })
    expect(header).toHaveAttribute('aria-sort', 'descending')
    expect(within(table).getByRole('columnheader', { name: /Company name/ })).toHaveAttribute(
      'aria-sort',
      'none',
    )
    const logistics = within(table).getByRole('row', { name: /Sample Logistics Pty Ltd/ })
    expect(within(logistics).getByText('10 Nov 2026')).toBeInTheDocument()
    // Mining's last talk is none, but its activity is the column's: March, Ochre as stale.
    const mining = within(table).getByRole('row', { name: /Sample Mining Pty Ltd/ })
    expect(within(mining).getByText('2 Mar 2026')).toBeInTheDocument()
    expect(within(mining).getByText('. No activity in 6 months')).toHaveClass('sr-only')
    // None on record says so.
    const freight = within(table).getByRole('row', { name: /Sample Freight Pty Ltd/ })
    expect(within(freight).getByText('None on record')).toBeInTheDocument()
  })

  it('turns to the oldest first on a click of its header, and back', async () => {
    const asked = mockServer()
    const { user } = renderCompanies()
    const table = await screen.findByRole('table', { name: 'Companies' })
    await within(table).findByText('Sample Logistics Pty Ltd')
    await user.click(
      within(table)
        .getByRole('columnheader', { name: /Last activity/ })
        .querySelector('button') as HTMLButtonElement,
    )
    await waitFor(() => {
      expect(asked.at(-1)?.searchParams.get('order')).toBe('asc')
    })
    expect(screen.getByLabelText('Address')).toHaveTextContent('?order=asc')
  })

  it('keeps an old link to A to Z working, with its sort in the address', async () => {
    const asked = mockServer()
    renderCompanies('?sort=name')
    const table = await screen.findByRole('table', { name: 'Companies' })
    await within(table).findByText('Sample Logistics Pty Ltd')
    expect(asked.at(-1)?.searchParams.get('sort')).toBe('name')
    expect(asked.at(-1)?.searchParams.get('order')).toBe('asc')
    expect(within(table).getByRole('columnheader', { name: /Company name/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
    expect(names(table)).toEqual(['104', '103', '101', '102'])
    // So is the last talk's sort, which no column shows now.
    expect(readCompanies(new URLSearchParams('sort=last_talk')).sort).toBe('last_talk')
  })

  it("Home's Companies card asks for the same list the page asks for first", () => {
    expect(HOME_COMPANIES).toEqual(listQuery(readCompanies(new URLSearchParams())))
    expect(HOME_COMPANIES).toMatchObject({ sort: 'last_activity', order: 'desc', offset: 0 })
  })

  it('on a phone, each card says its last activity, in the same order', async () => {
    asPhone()
    mockServer()
    renderCompanies()
    const cards = await screen.findByRole('list', { name: 'Companies' })
    await within(cards).findByText('Sample Logistics Pty Ltd')
    const items = within(cards).getAllByRole('listitem')
    expect(
      items.map((item) => item.querySelector('[data-row-id]')?.getAttribute('data-row-id')),
    ).toEqual(['101', '102', '104', '103'])
    const logistics = within(items[0])
    expect(logistics.getByText('Last activity')).toBeInTheDocument()
    expect(logistics.getByText('10 Nov 2026')).toBeInTheDocument()
    expect(logistics.queryByText('Last talk')).toBeNull()
  })
})
