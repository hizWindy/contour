/**
 * Admin, Data (PLAN-V26 T4-1, choices 16, 17 and 19): a read-only look at every table. Pick a
 * table, search its names, sort by a column. 50 rows to a page, and no export or download.
 *
 * The backend picks the columns and hides contact details, so nothing secret reaches this page.
 */
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useDataRows, useDataTables, type DataTableInfo } from '@/api/hooks/data'
import { ErrorState } from '@/components/error-state'
import { Pager } from '@/components/pager'
import { PendingCards } from '@/components/skeletons'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useDebounced } from '@/hooks/useDebounced'
import { formatDate, formatDateTime } from '@/lib/format'

const PAGE_SIZE = 50
const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** A cell's words. The backend sends text, so a time is told by its shape. */
function shown(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''
  if (MOMENT.test(value)) return formatDateTime(value)
  if (DAY.test(value)) return formatDate(value)
  return value
}

function Rows({ table }: { table: DataTableInfo }) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ key: string; order: 'asc' | 'desc' } | null>(null)
  const [page, setPage] = useState(0)
  const q = useDebounced(search.trim())
  const rows = useDataRows(table.table, {
    ...(q ? { q } : {}),
    ...(sort ? { sort: sort.key, order: sort.order } : {}),
    offset: page * PAGE_SIZE,
  })

  const sorted = sort ?? { key: table.newest, order: 'desc' as const }
  const sortBy = (key: string): void => {
    setPage(0)
    setSort({ key, order: sorted.key === key && sorted.order === 'desc' ? 'asc' : 'desc' })
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {table.note || table.screen ? (
        <p className="flex flex-wrap gap-x-2 text-ui text-foreground">
          {table.note ? <span>{table.note}</span> : null}
          {table.screen ? (
            <Link className="underline underline-offset-4" to={table.screen}>
              Open {table.screen_label ?? table.label}
            </Link>
          ) : null}
        </p>
      ) : null}
      <Input
        type="search"
        aria-label={`Search ${table.label}`}
        placeholder="Search"
        maxLength={120}
        className="sm:w-72"
        value={search}
        onChange={(event) => {
          setPage(0)
          setSearch(event.target.value)
        }}
      />
      {rows.error ? (
        <ErrorState
          error={rows.error}
          context={`${table.label} couldn't be loaded.`}
          onRetry={() => void rows.refetch()}
        />
      ) : !rows.data ? (
        <PendingCards label={`Loading ${table.label.toLowerCase()}.`} cards={1} />
      ) : rows.data.total === 0 ? (
        <p className="text-ui text-muted-foreground">
          {q ? `Nothing in ${table.label} matches "${q}".` : 'This table is empty.'}
        </p>
      ) : (
        <>
          <Table compact aria-label={table.label}>
            <TableHeader>
              <TableRow>
                {table.columns.map((column) => {
                  const on = sorted.key === column.key
                  const Arrow = sorted.order === 'asc' ? ArrowUp : ArrowDown
                  return (
                    <TableHead
                      key={column.key}
                      aria-sort={
                        on ? (sorted.order === 'asc' ? 'ascending' : 'descending') : undefined
                      }
                    >
                      {column.sortable ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 whitespace-nowrap touch:min-h-11"
                          onClick={() => {
                            sortBy(column.key)
                          }}
                        >
                          {column.label}
                          {on ? <Arrow aria-hidden="true" className="size-3.5" /> : null}
                        </button>
                      ) : (
                        column.label
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.data.items.map((row) => (
                <TableRow key={row.id}>
                  {table.columns.map((column) => {
                    const words = shown(row.values[column.key])
                    return (
                      <TableCell key={column.key} className="max-w-72 truncate" title={words}>
                        {words}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager
            page={{ pageIndex: page, pageSize: PAGE_SIZE, total: rows.data.total }}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  )
}

export default function AdminDataTab() {
  const tables = useDataTables()
  const [params, setParams] = useSearchParams()
  if (tables.error) {
    return (
      <ErrorState
        error={tables.error}
        context="The tables couldn't be loaded."
        onRetry={() => void tables.refetch()}
      />
    )
  }
  if (!tables.data) return <PendingCards label="Loading the tables." cards={1} />
  const table = tables.data.find((item) => item.table === params.get('table')) ?? tables.data[0]
  if (!table) return <p className="text-ui text-muted-foreground">No tables to show.</p>
  const groups = [...new Set(tables.data.map((item) => item.group))]
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Select
        value={table.table}
        onValueChange={(next) => {
          setParams({ table: next })
        }}
      >
        <SelectTrigger aria-label="Table" className="w-full sm:w-72">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {groups.map((group) => (
            <SelectGroup key={group}>
              <SelectLabel>{group}</SelectLabel>
              {tables.data
                .filter((item) => item.group === group)
                .map((item) => (
                  <SelectItem key={item.table} value={item.table}>
                    {item.label}
                  </SelectItem>
                ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {/* A key for each table, so another one starts with no search, sort or page. */}
      <Rows key={table.table} table={table} />
    </div>
  )
}
