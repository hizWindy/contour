/**
 * The results-style table: TanStack Table 8 on the shadcn table parts. The server sorts and pages
 * (the table never sorts or slices the rows itself), so the props carry the sort and the page and
 * report changes back.
 *
 * - Rows are 48px, or 40px with `compact` (the `DensityToggle` below goes in the toolbar).
 * - A column with `meta: { align: 'right' }` is right-aligned in its header and every cell (numbers).
 * - Headers are real column headers. A sortable one is a button, and the header says how it sorts
 *   (`aria-sort`).
 * - One row can be active (the Navy selection). Clicking a row makes it active and opens it. With
 *   `onActiveRowChange`, J and K move the active row, Enter opens it and Esc calls `onEscape`
 *   (`useListKeyboard`).
 * - The table scrolls inside its own box, up and down and sideways, so the page doesn't have to:
 *   the box fills the screen from where it starts down to the page buttons (`fill`). The header
 *   row stays at the top of the box, and a column with `meta: { sticky: true }` stays at the left
 *   while the others scroll past it. The page buttons stay in view under the box.
 * - On a phone a column with `meta: { hideBelow: 'sm' | 'md' }` is hidden, so the rows show only
 *   what tells them apart. Details are one tap away.
 * - Every cell renders React children, so text from the backend is always plain text.
 */
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type SortingState,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Rows4 } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Toggle } from '@/components/ui/toggle'
import { useListKeyboard } from '@/hooks/useListKeyboard'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
// The column `meta` fields (align, className). Imported so every program that uses the table has them.
import './data-table-types'

/** Which page is shown, and how many rows there are in all (from the server's `total`). */
export interface DataTablePage {
  pageIndex: number
  pageSize: number
  total: number
}

export interface DataTableProps<TData> {
  /** What the table lists, for screen readers: "Leads". */
  label: string
  // Columns of one table have different value types, so the value type is left open here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<TData, any>[]
  data: readonly TData[]
  /** A stable id for each row (the lead id), used for the active row and the keys. */
  getRowId: (row: TData) => string
  sorting?: SortingState
  onSortingChange?: OnChangeFn<SortingState>
  page?: DataTablePage
  onPageChange?: (pageIndex: number) => void
  compact?: boolean
  activeRowId?: string | null
  onActiveRowChange?: (id: string) => void
  onOpenRow?: (id: string) => void
  onEscape?: () => void
  /** True while a new page or sort loads. The rows already shown stay, dimmed. */
  loading?: boolean
  /** Shown when there are no rows. Default: a plain sentence. */
  empty?: ReactNode
  /** Filters and buttons above the table. */
  toolbar?: ReactNode
  /**
   * The box is as tall as the screen allows (at least 18rem), and scrolls inside. Turn it off to
   * let the table be as tall as its rows.
   */
  fill?: boolean
  className?: string
}

/** The smallest the filled box gets, in pixels, however short the screen. */
const FILL_MIN_PX = 288
/** Room kept under the box: the page buttons, the page's bottom padding and a little air. */
const RESERVE_WITH_PAGER_PX = 96
const RESERVE_PX = 48

/**
 * How tall the table's scroll box may be: from where it starts down to the bottom of the screen,
 * less room for the page buttons. It is worked out from the box's place on the page (not on the
 * screen), so scrolling the page doesn't change it, and again when the window or the page above it
 * changes size.
 */
function useFillHeight(enabled: boolean, reserve: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [maxHeight, setMaxHeight] = useState<number | null>(null)
  useLayoutEffect(() => {
    const box = ref.current
    if (!enabled || !box) {
      return undefined
    }
    const measure = (): void => {
      const top = box.getBoundingClientRect().top + window.scrollY
      setMaxHeight(Math.max(FILL_MIN_PX, Math.round(window.innerHeight - top - reserve)))
    }
    measure()
    window.addEventListener('resize', measure)
    const observer = new ResizeObserver(measure)
    observer.observe(document.body)
    return () => {
      window.removeEventListener('resize', measure)
      observer.disconnect()
    }
  }, [enabled, reserve])
  return { ref, maxHeight: enabled ? maxHeight : null }
}

/** The classes that hide a column below a screen width (see `meta.hideBelow`). */
const HIDE_BELOW = { sm: 'max-sm:hidden', md: 'max-md:hidden' } as const

/** A cell that must stay put while the table scrolls: opaque, with the row's tint on top. */
const STICKY_CELL =
  'bg-card group-hover/row:bg-[color-mix(in_srgb,var(--muted)_60%,var(--card))] group-data-[state=selected]/row:bg-selected sm:sticky sm:left-0 sm:z-10 sm:after:absolute sm:after:inset-y-0 sm:after:right-0 sm:after:w-px sm:after:bg-border'

const SORT_WORDS = { asc: 'ascending', desc: 'descending' } as const

export function DataTable<TData>({
  label,
  columns,
  data,
  getRowId,
  sorting = [],
  onSortingChange,
  page,
  onPageChange,
  compact = false,
  activeRowId = null,
  onActiveRowChange,
  onOpenRow,
  onEscape,
  loading = false,
  empty,
  toolbar,
  fill = true,
  className,
}: DataTableProps<TData>) {
  const { ref: boxRef, maxHeight } = useFillHeight(
    fill,
    page && onPageChange ? RESERVE_WITH_PAGER_PX : RESERVE_PX,
  )
  const table = useReactTable({
    data: data as TData[],
    columns,
    getRowId: (row) => getRowId(row),
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
    state: { sorting },
    onSortingChange,
  })

  const rows = table.getRowModel().rows
  const ids = rows.map((row) => row.id)
  const bodyRef = useRef<HTMLTableSectionElement>(null)

  useListKeyboard({
    enabled: onActiveRowChange !== undefined && rows.length > 0,
    ids,
    activeId: activeRowId,
    onActiveChange: (id) => onActiveRowChange?.(id),
    onOpen: onOpenRow,
    onEscape,
    containerRef: bodyRef,
  })

  // Keep the active row in view as J and K move it.
  useEffect(() => {
    if (!activeRowId) {
      return
    }
    const row = bodyRef.current?.querySelector(`[data-row-id="${CSS.escape(activeRowId)}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [activeRowId])

  const columnCount = table.getVisibleLeafColumns().length
  return (
    <div data-slot="data-table" className={cn('flex flex-col gap-3', className)}>
      {toolbar ? <div className="flex flex-wrap items-center gap-2">{toolbar}</div> : null}
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table
          compact={compact}
          aria-busy={loading || undefined}
          containerRef={boxRef}
          containerStyle={maxHeight === null ? undefined : { maxHeight }}
        >
          <TableCaption className="sr-only">{label}</TableCaption>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((header) => {
                  const meta = header.column.columnDef.meta
                  const right = meta?.align === 'right'
                  const sorted = header.column.getIsSorted()
                  const canSort = header.column.getCanSort() && onSortingChange !== undefined
                  const title = header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())
                  return (
                    <TableHead
                      key={header.id}
                      scope="col"
                      aria-sort={canSort ? (sorted ? SORT_WORDS[sorted] : 'none') : undefined}
                      className={cn(
                        // The header row stays at the top of the box, over the rows that scroll.
                        'sticky top-0 z-10 bg-card',
                        right && 'text-right',
                        meta?.className,
                        meta?.hideBelow && HIDE_BELOW[meta.hideBelow],
                        // The frozen column's header also stays at the left, over its own cells.
                        meta?.sticky && 'sm:left-0 sm:z-20',
                      )}
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            '-mx-1 inline-flex items-center gap-1 rounded-sm px-1 font-semibold hover:text-foreground',
                            right && 'flex-row-reverse',
                          )}
                        >
                          <span>{title}</span>
                          {sorted === 'asc' ? (
                            <ArrowUp aria-hidden="true" className="size-4" />
                          ) : sorted === 'desc' ? (
                            <ArrowDown aria-hidden="true" className="size-4" />
                          ) : (
                            <ArrowUpDown
                              aria-hidden="true"
                              className="size-4 text-muted-foreground"
                            />
                          )}
                        </button>
                      ) : (
                        title
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody ref={bodyRef} className={cn(loading && rows.length > 0 && 'opacity-60')}>
            {rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columnCount} className="h-24 whitespace-normal">
                  {loading ? (
                    <span role="status" className="text-muted-foreground">
                      Loading.
                    </span>
                  ) : (
                    (empty ?? <span className="text-muted-foreground">Nothing to show.</span>)
                  )}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const active = row.id === activeRowId
                const open = onOpenRow ?? onActiveRowChange
                return (
                  <TableRow
                    key={row.id}
                    data-row-id={row.id}
                    data-state={active ? 'selected' : undefined}
                    aria-selected={onActiveRowChange ? active : undefined}
                    onClick={
                      open
                        ? () => {
                            onActiveRowChange?.(row.id)
                            onOpenRow?.(row.id)
                          }
                        : undefined
                    }
                    className={cn(open && 'cursor-pointer')}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta
                      return (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            meta?.align === 'right' && 'text-right',
                            meta?.className,
                            meta?.hideBelow && HIDE_BELOW[meta.hideBelow],
                            meta?.sticky && STICKY_CELL,
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
      {page && onPageChange ? <Pager page={page} onPageChange={onPageChange} /> : null}
    </div>
  )
}

function Pager({
  page,
  onPageChange,
}: {
  page: DataTablePage
  onPageChange: (index: number) => void
}) {
  const first = page.total === 0 ? 0 : page.pageIndex * page.pageSize + 1
  const last = Math.min(page.total, (page.pageIndex + 1) * page.pageSize)
  const lastPage = Math.max(0, Math.ceil(page.total / page.pageSize) - 1)
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-4 text-ui">
      <p className="text-muted-foreground" aria-live="polite">
        {page.total === 0
          ? 'No rows'
          : `Showing ${formatNumber(first)} to ${formatNumber(last)} of ${formatNumber(page.total)}`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page.pageIndex <= 0}
          onClick={() => {
            onPageChange(page.pageIndex - 1)
          }}
        >
          <ChevronLeft aria-hidden="true" />
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page.pageIndex >= lastPage}
          onClick={() => {
            onPageChange(page.pageIndex + 1)
          }}
        >
          Next
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  )
}

export interface DensityToggleProps {
  compact: boolean
  onCompactChange: (compact: boolean) => void
}

/** The toolbar switch between 48px and 40px rows. */
export function DensityToggle({ compact, onCompactChange }: DensityToggleProps) {
  return (
    <Toggle variant="outline" size="sm" pressed={compact} onPressedChange={onCompactChange}>
      <Rows4 aria-hidden="true" />
      Compact rows
    </Toggle>
  )
}
