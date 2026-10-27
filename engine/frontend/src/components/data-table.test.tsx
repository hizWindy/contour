import { createColumnHelper, type SortingState } from '@tanstack/react-table'
import { fireEvent, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { DataTable, DensityToggle, type DataTablePage } from './data-table'

interface Row {
  id: string
  company: string
  score: number
}

const help = createColumnHelper<Row>()
const columns = [
  help.accessor('company', { header: 'Company', enableSorting: false, meta: { sticky: true } }),
  help.accessor('score', { header: 'Score', meta: { align: 'right', hideBelow: 'sm' } }),
]

const HOSTILE = '<img src=x onerror=alert(1)>'
const ROWS: Row[] = [
  { id: 'a', company: 'Acme Software', score: 78 },
  { id: 'b', company: HOSTILE, score: 55 },
  { id: 'c', company: '=1+1', score: 12 },
]

interface HarnessProps {
  rows?: Row[]
  page?: DataTablePage
  onOpenRow?: (id: string) => void
  onEscape?: () => void
  onSortingChange?: (sorting: SortingState) => void
  onPageChange?: (index: number) => void
  loading?: boolean
}

/** The table the way a page uses it: the page keeps the sort, the active row and the density. */
function Harness({
  rows = ROWS,
  page,
  onOpenRow,
  onEscape,
  onSortingChange,
  onPageChange,
  loading,
}: HarnessProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'score', desc: true }])
  const [active, setActive] = useState<string | null>(null)
  const [compact, setCompact] = useState(false)
  return (
    <DataTable
      label="Leads"
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      sorting={sorting}
      onSortingChange={(updater) => {
        const next = typeof updater === 'function' ? updater(sorting) : updater
        setSorting(next)
        onSortingChange?.(next)
      }}
      page={page}
      onPageChange={onPageChange}
      compact={compact}
      activeRowId={active}
      onActiveRowChange={setActive}
      onOpenRow={onOpenRow}
      onEscape={onEscape}
      loading={loading}
      toolbar={<DensityToggle compact={compact} onCompactChange={setCompact} />}
    />
  )
}

function bodyRows(): HTMLElement[] {
  const [, body] = screen.getAllByRole('rowgroup')
  return within(body).getAllByRole('row')
}

describe('DataTable', () => {
  it('has real column headers, a caption, and right-aligned numbers', () => {
    renderWithProviders(<Harness />)

    const table = screen.getByRole('table', { name: 'Leads' })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Company', 'Score'])
    const score = screen.getByRole('columnheader', { name: /Score/ })
    expect(score).toHaveClass('text-right')
    expect(within(bodyRows()[0]).getByText('78')).toHaveClass('text-right')
    expect(within(bodyRows()[0]).getByText('Acme Software')).not.toHaveClass('text-right')
  })

  it('shows text from the backend as plain text, never as markup', () => {
    const { container } = renderWithProviders(<Harness />)
    expect(screen.getByText(HOSTILE)).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('=1+1')).toBeInTheDocument()
  })

  it('says how a column sorts, and asks the page to sort the other way on a click', async () => {
    const onSortingChange = vi.fn()
    const { user } = renderWithProviders(<Harness onSortingChange={onSortingChange} />)

    const score = screen.getByRole('columnheader', { name: /Score/ })
    expect(score).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getByRole('columnheader', { name: 'Company' })).not.toHaveAttribute('aria-sort')

    await user.click(within(score).getByRole('button', { name: /Score/ }))
    expect(onSortingChange).toHaveBeenLastCalledWith([{ id: 'score', desc: false }])
    expect(score).toHaveAttribute('aria-sort', 'ascending')
    // The rows keep the order the server gave: the table never sorts them itself.
    expect(bodyRows().map((row) => row.dataset.rowId)).toEqual(['a', 'b', 'c'])
  })

  it('moves through the rows with J and K, opens one with Enter and closes with Esc', async () => {
    const onOpenRow = vi.fn()
    const onEscape = vi.fn()
    const { user } = renderWithProviders(<Harness onOpenRow={onOpenRow} onEscape={onEscape} />)

    await user.keyboard('j')
    expect(bodyRows()[0]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('jj')
    expect(bodyRows()[2]).toHaveAttribute('data-state', 'selected')
    await user.keyboard('j') // stays on the last row
    expect(bodyRows()[2]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('k')
    expect(bodyRows()[1]).toHaveAttribute('aria-selected', 'true')
    expect(bodyRows()[2]).toHaveAttribute('aria-selected', 'false')

    await user.keyboard('{Enter}')
    expect(onOpenRow).toHaveBeenCalledWith('b')
    await user.keyboard('{Escape}')
    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('makes a clicked row active and opens it', async () => {
    const onOpenRow = vi.fn()
    const { user } = renderWithProviders(<Harness onOpenRow={onOpenRow} />)
    await user.click(screen.getByText('=1+1'))
    expect(onOpenRow).toHaveBeenCalledWith('c')
    expect(bodyRows()[2]).toHaveAttribute('data-state', 'selected')
  })

  it('switches to compact rows from the toolbar', async () => {
    const { user } = renderWithProviders(<Harness />)
    const table = screen.getByRole('table', { name: 'Leads' })
    expect(table).toHaveAttribute('data-density', 'comfortable')
    const toggle = screen.getByRole('button', { name: 'Compact rows' })
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(table).toHaveAttribute('data-density', 'compact')
  })

  it('pages through the rows the server has', async () => {
    const onPageChange = vi.fn()
    const { user, rerender } = renderWithProviders(
      <Harness page={{ pageIndex: 0, pageSize: 3, total: 7 }} onPageChange={onPageChange} />,
    )
    expect(screen.getByText('Showing 1 to 3 of 7')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(onPageChange).toHaveBeenCalledWith(1)

    rerender(<Harness page={{ pageIndex: 2, pageSize: 3, total: 7 }} onPageChange={onPageChange} />)
    expect(screen.getByText('Showing 7 to 7 of 7')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('says when there are no rows, and when rows are loading', () => {
    const { rerender } = renderWithProviders(<Harness rows={[]} />)
    expect(screen.getByText('Nothing to show.')).toBeInTheDocument()
    rerender(<Harness rows={[]} loading />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading.')
    rerender(<Harness loading />)
    expect(screen.getByRole('table', { name: 'Leads' })).toHaveAttribute('aria-busy', 'true')
  })

  it('leaves J and K alone while you type in a field', () => {
    renderWithProviders(
      <>
        <input aria-label="Search" />
        <Harness />
      </>,
    )
    const field = screen.getByRole('textbox', { name: 'Search' })
    fireEvent.keyDown(field, { key: 'j' })
    expect(bodyRows().every((row) => row.getAttribute('aria-selected') === 'false')).toBe(true)
  })

  it('keeps the header row and the sticky column in place while the box scrolls', () => {
    renderWithProviders(<Harness />)
    const table = screen.getByRole('table', { name: 'Leads' })
    const [companyHead, scoreHead] = within(table).getAllByRole('columnheader')
    // Every header cell sticks to the top of the box; the sticky column's also to the left.
    expect(companyHead).toHaveClass('sticky', 'top-0', 'sm:left-0')
    expect(scoreHead).toHaveClass('sticky', 'top-0')
    expect(scoreHead).not.toHaveClass('sm:left-0')
    const rows = within(table).getAllByRole('row').slice(1)
    for (const row of rows) {
      const [name, score] = within(row).getAllByRole('cell')
      expect(name).toHaveClass('sm:sticky', 'sm:left-0')
      // Opaque, so the cells that scroll past it never show through.
      expect(name).toHaveClass('bg-card')
      expect(score).not.toHaveClass('sm:sticky')
    }
  })

  it('scrolls inside its own box, which is as tall as the screen allows', () => {
    renderWithProviders(<Harness />)
    const box = screen.getByRole('table', { name: 'Leads' }).closest('[data-slot=table-container]')
    expect(box).toHaveClass('overflow-auto')
    // jsdom's screen is 768px tall and the box starts at 0, less room for the page buttons.
    expect((box as HTMLElement).style.maxHeight).toMatch(/^\d+px$/)
    expect(Number.parseInt((box as HTMLElement).style.maxHeight, 10)).toBeGreaterThanOrEqual(288)
  })

  it('hides a column below its screen width, in the header and in every row', () => {
    renderWithProviders(<Harness />)
    const table = screen.getByRole('table', { name: 'Leads' })
    const [, scoreHead] = within(table).getAllByRole('columnheader')
    expect(scoreHead).toHaveClass('max-sm:hidden')
    for (const row of within(table).getAllByRole('row').slice(1)) {
      expect(within(row).getAllByRole('cell')[1]).toHaveClass('max-sm:hidden')
    }
    // The company column has no such rule: it is always there.
    expect(within(table).getAllByRole('columnheader')[0]).not.toHaveClass('max-sm:hidden')
  })

  it('lets the table be as tall as its rows when fill is turned off', () => {
    renderWithProviders(
      <DataTable
        label="Leads"
        columns={columns}
        data={ROWS}
        getRowId={(row) => row.id}
        fill={false}
      />,
    )
    const box = screen.getByRole('table', { name: 'Leads' }).closest('[data-slot=table-container]')
    expect((box as HTMLElement).style.maxHeight).toBe('')
  })
})
