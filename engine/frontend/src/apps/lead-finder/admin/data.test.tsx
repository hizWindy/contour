/** Admin, Data (PLAN-V26 T4-1), against the generated contract and a fake server. */
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { asLaptop } from '@/test/screen'
import AdminDataTab from './data'

const TABLES = [
  {
    table: 'companies.call_notes',
    label: 'Call notes',
    group: 'Companies',
    newest: 'called_at',
    note: null,
    screen: null,
    screen_label: null,
    columns: [
      { key: 'called_at', label: 'When', sortable: true },
      { key: 'company_name', label: 'Company', sortable: true },
      { key: 'text', label: 'Note', sortable: false },
    ],
  },
  {
    table: 'core.hubspot_contacts',
    label: 'Contacts',
    group: 'HubSpot',
    newest: 'imported_at',
    note: 'Change it in HubSpot, then press Sync.',
    screen: null,
    screen_label: null,
    columns: [{ key: 'email', label: 'Email', sortable: false }],
  },
  {
    table: 'core.settings',
    label: 'Settings',
    group: 'Set-up',
    newest: 'updated_at',
    note: null,
    screen: '/admin/settings',
    screen_label: 'Settings',
    columns: [{ key: 'key', label: 'Setting', sortable: true }],
  },
]

function serve(total = 1): URL[] {
  const asked: URL[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request) => {
      const url = new URL(request.url)
      if (url.pathname === '/api/v1/data/tables') return Promise.resolve(Response.json(TABLES))
      asked.push(url)
      const values = {
        called_at: '2026-11-23T04:40:00Z',
        company_name: 'Northwind',
        text: 'Email j•••@northwind.com.au',
        email: 'j•••@northwind.com.au',
        key: 'run_cap_usd',
      }
      return Promise.resolve(
        Response.json({ total, items: total ? [{ id: 'row-1', values }] : [] }),
      )
    }),
  )
  return asked
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the Data tab', () => {
  it('opens on the first table, newest first', async () => {
    asLaptop()
    serve()
    renderWithProviders(<AdminDataTab />, { route: '/admin/data' })
    const table = await screen.findByRole('table', { name: 'Call notes' })
    expect(table).toHaveTextContent('Northwind')
    expect(table).toHaveTextContent('j•••@northwind.com.au')
    expect(within(table).getByRole('columnheader', { name: 'When' })).toHaveAttribute(
      'aria-sort',
      'descending',
    )
    expect(within(table).queryByRole('button', { name: 'Note' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /export|download/i })).not.toBeInTheDocument()
  })

  it('asks the server to sort and to search', async () => {
    asLaptop()
    const asked = serve()
    const { user } = renderWithProviders(<AdminDataTab />, { route: '/admin/data' })
    await user.click(await screen.findByRole('button', { name: 'Company' }))
    await waitFor(() => {
      expect(asked.at(-1)?.searchParams.get('sort')).toBe('company_name')
    })
    await user.type(await screen.findByRole('searchbox', { name: 'Search Call notes' }), 'north')
    await waitFor(() => {
      expect(asked.at(-1)?.searchParams.get('q')).toBe('north')
    })
  })

  it('pages 50 at a time', async () => {
    asLaptop()
    const asked = serve(120)
    const { user } = renderWithProviders(<AdminDataTab />, { route: '/admin/data' })
    expect(await screen.findByText('Showing 1 to 50 of 120')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => {
      expect(asked.at(-1)?.searchParams.get('offset')).toBe('50')
    })
  })

  it('says to change a HubSpot table in HubSpot', async () => {
    asLaptop()
    serve()
    renderWithProviders(<AdminDataTab />, { route: '/admin/data?table=core.hubspot_contacts' })
    expect(await screen.findByText('Change it in HubSpot, then press Sync.')).toBeInTheDocument()
  })

  it('links a table to its own screen', async () => {
    asLaptop()
    serve()
    renderWithProviders(<AdminDataTab />, { route: '/admin/data?table=core.settings' })
    expect(await screen.findByRole('link', { name: 'Open Settings' })).toHaveAttribute(
      'href',
      '/admin/settings',
    )
  })

  it('says so when a table is empty', async () => {
    asLaptop()
    serve(0)
    renderWithProviders(<AdminDataTab />, { route: '/admin/data' })
    expect(await screen.findByText('This table is empty.')).toBeInTheDocument()
  })
})
