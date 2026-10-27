/**
 * Admin, Search log: every Claude request, newest first, with what it cost. `?run_id=` shows one
 * run's requests (the run page links here). A row shows what it searched and the pages it read.
 */
import { createColumnHelper } from '@tanstack/react-table'
import { FileSearch } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useSearches } from '@/api/hooks'
import type { SearchOut } from '@/api/types'
import { DataTable } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Money } from '@/components/money'
import { SourceLink } from '@/components/source-link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateTime, formatNumber, shortId } from '@/lib/format'

const PAGE_SIZE = 50
const help = createColumnHelper<SearchOut>()
const columns = [
  help.accessor('created_at', {
    header: 'When',
    enableSorting: false,
    cell: (info) => formatDateTime(info.getValue()),
  }),
  help.accessor('step', { header: 'Step', enableSorting: false }),
  help.accessor('subject', {
    header: 'About',
    enableSorting: false,
    cell: (info) => info.getValue() ?? '',
  }),
  help.accessor('model', { header: 'Model', enableSorting: false }),
  help.accessor('web_searches', {
    header: 'Searches',
    enableSorting: false,
    meta: { align: 'right' },
    cell: (info) => formatNumber(info.getValue()),
  }),
  help.accessor('cost_usd', {
    header: 'Cost',
    enableSorting: false,
    meta: { align: 'right' },
    cell: (info) => <Money value={info.getValue()} decimals={4} />,
  }),
  help.accessor('answer_ok', {
    header: 'Answer',
    enableSorting: false,
    cell: (info) => (info.getValue() ? 'Fitted the form' : 'Did not fit'),
  }),
]

function Details({ search }: { search: SearchOut }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-section font-semibold">
          {search.step}: {search.subject ?? 'no subject'}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-ui md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <p className="font-semibold">What it searched</p>
          {search.queries.length === 0 ? (
            <p className="text-muted-foreground">No web search.</p>
          ) : (
            <ul className="list-disc pl-5">
              {search.queries.map((query, index) => (
                <li key={`${query}-${index}`}>{query}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-semibold">Pages it read</p>
          {search.sources.length === 0 ? (
            <p className="text-muted-foreground">None.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {search.sources.map((source) => (
                <li key={source.url}>
                  <SourceLink href={source.url} label={source.title ?? undefined} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="text-caption text-muted-foreground md:col-span-2">
          {formatNumber(search.input_tokens)} tokens in, {formatNumber(search.output_tokens)} out,{' '}
          {formatNumber(search.cache_read_tokens)} read from the cache. Stopped:{' '}
          {search.stop_reason ?? 'not known'}.
        </p>
      </CardContent>
    </Card>
  )
}

export default function AdminSearchesTab() {
  const [params, setParams] = useSearchParams()
  const runId = params.get('run_id')
  const [pageIndex, setPageIndex] = useState(0)
  const [active, setActive] = useState<string | null>(null)
  const searches = useSearches({
    limit: PAGE_SIZE,
    offset: pageIndex * PAGE_SIZE,
    ...(runId ? { run_id: runId } : {}),
  })
  const items = searches.data?.items ?? []
  const selected = items.find((item) => item.id === active)
  return (
    <div className="flex flex-col gap-4">
      {runId ? (
        <p className="flex flex-wrap items-center gap-2 text-ui">
          Showing the requests of run {shortId(runId)}.
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setPageIndex(0)
              setParams({})
            }}
          >
            Show every request
          </Button>
        </p>
      ) : null}
      {searches.error ? (
        <ErrorState error={searches.error} context="The search log couldn't be loaded." />
      ) : (
        <DataTable
          label="Search log"
          columns={columns}
          data={items}
          getRowId={(item) => item.id}
          page={{ pageIndex, pageSize: PAGE_SIZE, total: searches.data?.total ?? 0 }}
          onPageChange={setPageIndex}
          activeRowId={active}
          onActiveRowChange={setActive}
          onEscape={() => {
            setActive(null)
          }}
          loading={searches.isFetching}
          empty={
            <EmptyState
              icon={FileSearch}
              title="No requests yet."
              description="Every Claude request a run makes shows here, with its cost."
              headingLevel={3}
            />
          }
        />
      )}
      {selected ? <Details search={selected} /> : null}
    </div>
  )
}
