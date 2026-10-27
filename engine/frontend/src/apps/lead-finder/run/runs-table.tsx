/**
 * The table of runs, newest first: when it started, what kind it was, its status, what it found and
 * what it cost. A row opens the run. The Runs page and the Admin "Runs and cost" tab both show it.
 */
import { createColumnHelper } from '@tanstack/react-table'
import { ListChecks } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useRuns } from '@/api/hooks'
import type { Run } from '@/api/types'
import { DataTable } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Money } from '@/components/money'
import { StatusBadge } from '@/components/status-badge'
import { formatDateTime, formatNumber, shortId } from '@/lib/format'
import { RUN_MODE_LABELS } from '@/lib/labels'

const PAGE_SIZE = 50

const help = createColumnHelper<Run>()
const columns = [
  help.accessor('created_at', {
    header: 'Started',
    enableSorting: false,
    cell: (info) => (
      <Link
        to={`/runs/${info.row.original.id}`}
        className="font-semibold underline-offset-4 hover:underline"
      >
        {formatDateTime(info.getValue())}
      </Link>
    ),
  }),
  help.accessor('id', {
    header: 'Run',
    enableSorting: false,
    meta: { hideBelow: 'sm' },
    cell: (info) => shortId(info.getValue()),
  }),
  help.accessor('mode', {
    header: 'Kind',
    enableSorting: false,
    meta: { hideBelow: 'sm' },
    cell: (info) => RUN_MODE_LABELS[info.getValue()] ?? info.getValue(),
  }),
  help.accessor('status', {
    header: 'Status',
    enableSorting: false,
    cell: (info) => <StatusBadge status={info.getValue()} />,
  }),
  help.accessor((run) => run.counts.researched, {
    id: 'researched',
    header: 'Researched',
    enableSorting: false,
    meta: { align: 'right', hideBelow: 'md' },
    cell: (info) => formatNumber(info.getValue()),
  }),
  help.accessor('cost_usd', {
    header: 'Cost',
    enableSorting: false,
    meta: { align: 'right' },
    cell: (info) => <Money value={info.getValue()} />,
  }),
]

export function RunsTable() {
  const navigate = useNavigate()
  const [pageIndex, setPageIndex] = useState(0)
  const [active, setActive] = useState<string | null>(null)
  const runs = useRuns({ limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE })
  if (runs.error) {
    return (
      <ErrorState
        error={runs.error}
        context="The runs couldn't be loaded."
        onRetry={() => void runs.refetch()}
      />
    )
  }
  return (
    <DataTable
      label="Runs"
      columns={columns}
      data={runs.data?.items ?? []}
      getRowId={(run) => run.id}
      page={{ pageIndex, pageSize: PAGE_SIZE, total: runs.data?.total ?? 0 }}
      onPageChange={setPageIndex}
      activeRowId={active}
      onActiveRowChange={setActive}
      onOpenRow={(id) => {
        void navigate(`/runs/${id}`)
      }}
      loading={runs.isFetching}
      empty={
        <EmptyState
          icon={ListChecks}
          title="No runs yet."
          description="Start a run to find companies with a sign of an office change."
        />
      }
    />
  )
}
