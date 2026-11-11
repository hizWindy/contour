import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { companyQueryOptions } from '@/api/hooks'
import type { CompanyRow } from '@/api/types'
import { DataTable } from '@/components/data-table'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { companyColumns } from './columns'
import { companySource, initialsOf } from './source-words'

function row(changes: Partial<CompanyRow> = {}): CompanyRow {
  return {
    key: '101',
    name: 'ABC Logistics',
    domain: 'abclogistics.com.au',
    city: 'Perth',
    industry: 'Logistics',
    staff: 300,
    next_lease_end: '2027-06-30',
    last_talk: '2026-10-01',
    deal: 'open',
    owner: 'Levi Young',
    source: 'hubspot',
    lead_result: null,
    lead_score: null,
    ...changes,
  }
}

const ROWS: CompanyRow[] = [
  row(),
  row({
    key: '102',
    name: 'Meridian Health Partners',
    source: 'hubspot',
    lead_result: 'watch',
    lead_score: 61,
    owner: null,
    deal: 'none',
  }),
  row({
    key: 'lead:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    name: 'Delta Freight',
    source: 'lead',
    domain: null,
    deal: 'none',
    lead_result: 'pass',
    lead_score: 82,
  }),
]

describe('the Companies columns (PLAN-V13 T2-8)', () => {
  it("follow HubSpot's order, with the name first and Source only for the Lead Finder tick", () => {
    const handlers = { onPrep: vi.fn(), onOpen: vi.fn() }
    renderWithProviders(
      <DataTable
        label="Companies"
        columns={companyColumns({ leadsShown: true, today: '2026-11-11', handlers })}
        data={ROWS}
        getRowId={(item) => item.key}
      />,
    )
    const table = screen.getByRole('table', { name: 'Companies' })
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent?.trim())
    expect(headers).toEqual([
      'Company name',
      'Owner',
      'Last activity',
      'City',
      'Industry',
      'Staff',
      'Next lease end',
      'Deal',
      'Source',
      'Lead Finder',
      'Actions',
    ])
    // Industry is a column of its own, and the website sits under the name
    expect(within(table).getAllByText('Logistics')).toHaveLength(3)
    expect(within(table).getAllByText('abclogistics.com.au')).not.toHaveLength(0)
    // The initials square
    const abc = within(table).getByRole('row', { name: /ABC Logistics/ })
    expect(abc.querySelector('[data-slot=company-initials]')).toHaveTextContent('AL')
  })

  it('leave Source and the actions out without the tick or the handlers', () => {
    renderWithProviders(
      <DataTable
        label="Companies"
        columns={companyColumns({ leadsShown: false, today: '2026-11-11' })}
        data={ROWS}
        getRowId={(item) => item.key}
      />,
    )
    const table = screen.getByRole('table', { name: 'Companies' })
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent?.trim())
    expect(headers).toEqual([
      'Company name',
      'Owner',
      'Last activity',
      'City',
      'Industry',
      'Staff',
      'Next lease end',
      'Deal',
    ])
  })

  it('show where each company came from: HubSpot, Lead Finder or Both', () => {
    renderWithProviders(
      <DataTable
        label="Companies"
        columns={companyColumns({ leadsShown: true, today: '2026-11-11' })}
        data={ROWS}
        getRowId={(item) => item.key}
      />,
    )
    const table = screen.getByRole('table', { name: 'Companies' })
    const sourceOf = (name: RegExp) =>
      within(table).getByRole('row', { name }).querySelector('[data-source]')
    expect(sourceOf(/ABC Logistics/)).toHaveAttribute('data-source', 'hubspot')
    expect(sourceOf(/ABC Logistics/)).toHaveTextContent('HubSpot')
    expect(sourceOf(/Meridian/)).toHaveAttribute('data-source', 'both')
    expect(sourceOf(/Meridian/)).toHaveTextContent('Both')
    expect(sourceOf(/Delta Freight/)).toHaveAttribute('data-source', 'lead')
    expect(sourceOf(/Delta Freight/)).toHaveTextContent('Lead Finder')
    // A lead still says so under its name, where the website would be
    expect(within(table).getByText('Not in HubSpot yet')).toBeInTheDocument()
  })

  it('offer Prep a call and Open in HubSpot at the end of a row, without opening the row', async () => {
    const handlers = { onPrep: vi.fn(), onOpen: vi.fn() }
    const onOpenRow = vi.fn()
    const queryClient = createTestQueryClient()
    // The panel's data for ABC is already in the cache (the page prefetches it on pointer rest),
    // so its button is a real link. Meridian's is not, so its button opens the panel.
    queryClient.setQueryData(companyQueryOptions('101').queryKey, {
      key: '101',
      name: 'ABC Logistics',
      hubspot_url: 'https://app.hubspot.com/contacts/1/company/101',
    } as never)
    const { user } = renderWithProviders(
      <DataTable
        label="Companies"
        columns={companyColumns({ leadsShown: true, today: '2026-11-11', handlers })}
        data={ROWS}
        getRowId={(item) => item.key}
        onOpenRow={onOpenRow}
      />,
      { queryClient },
    )
    const table = screen.getByRole('table', { name: 'Companies' })
    const abc = within(table).getByRole('row', { name: /ABC Logistics/ })
    await user.click(within(abc).getByRole('button', { name: 'Prep a call' }))
    expect(handlers.onPrep).toHaveBeenCalledWith(expect.objectContaining({ key: '101' }))
    expect(onOpenRow).not.toHaveBeenCalled()
    expect(within(abc).getByRole('link', { name: 'Open in HubSpot' })).toHaveAttribute(
      'href',
      'https://app.hubspot.com/contacts/1/company/101',
    )
    const meridian = within(table).getByRole('row', { name: /Meridian/ })
    await user.click(within(meridian).getByRole('button', { name: 'Open in HubSpot' }))
    expect(handlers.onOpen).toHaveBeenCalledWith('102')
    expect(onOpenRow).not.toHaveBeenCalled()
    // A lead is not in HubSpot, so it has no HubSpot action
    const delta = within(table).getByRole('row', { name: /Delta Freight/ })
    expect(within(delta).queryByText('Open in HubSpot')).toBeNull()
    expect(within(delta).getByRole('button', { name: 'Prep a call' })).toBeInTheDocument()
    // The actions show on hover or focus, and stay out of the way otherwise
    expect(abc.querySelector('[data-slot=row-actions]')).toHaveClass('opacity-0')
  })

  it('words: the source kind and the initials', () => {
    expect(companySource({ source: 'hubspot', lead_result: null })).toBe('hubspot')
    expect(companySource({ source: 'hubspot', lead_result: 'drop' })).toBe('both')
    expect(companySource({ source: 'lead', lead_result: 'pass' })).toBe('lead')
    expect(initialsOf('ABC Logistics')).toBe('AL')
    expect(initialsOf('Harbourline Logistics Pty Ltd')).toBe('HL')
    expect(initialsOf('Canva')).toBe('CA')
    expect(initialsOf('A&B Civil')).toBe('AB')
    expect(initialsOf('   ')).toBe('?')
  })
})
