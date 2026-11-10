/**
 * Test set: run the 10 public test companies, and compare the scores over time (a Lead Finder page). A change
 * to a prompt or a rule stays only if the test set score holds.
 */
import { createColumnHelper } from '@tanstack/react-table'
import { CircleCheck, CircleX, FlaskConical, Minus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useStartTestRun, useTestReport, useTests } from '@/api/hooks'
import type { TestPage, TestReport } from '@/api/types'
import { DataTable } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Money } from '@/components/money'
import { ResultBadge } from '@/components/result-badge'
import { StatusBadge } from '@/components/status-badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateTime, shortId } from '@/lib/format'
import { RESULT_LABELS } from '@/lib/labels'
import { toastProblem } from '@/lib/problems'

type Summary = TestPage['items'][number]
type Item = TestReport['items'][number]

const summaryHelp = createColumnHelper<Summary>()
const summaryColumns = [
  summaryHelp.accessor('created_at', {
    header: 'Run',
    enableSorting: false,
    cell: (info) => `${formatDateTime(info.getValue())} (${shortId(info.row.original.run_id)})`,
  }),
  summaryHelp.accessor('status', {
    header: 'Status',
    enableSorting: false,
    cell: (info) => <StatusBadge status={info.getValue()} />,
  }),
  summaryHelp.accessor((row) => `${row.matched} of ${row.expected}`, {
    id: 'matched',
    header: 'As expected',
    enableSorting: false,
    meta: { align: 'right' },
  }),
  summaryHelp.accessor('avg_cost_usd', {
    header: 'Per company',
    enableSorting: false,
    meta: { align: 'right', hideBelow: 'md' },
    cell: (info) => <Money value={info.getValue()} />,
  }),
  summaryHelp.accessor('total_cost_usd', {
    header: 'Total',
    enableSorting: false,
    meta: { align: 'right' },
    cell: (info) => <Money value={info.getValue()} />,
  }),
  summaryHelp.accessor('rules_version', {
    header: 'Rules',
    enableSorting: false,
    meta: { hideBelow: 'md' },
  }),
]

const itemHelp = createColumnHelper<Item>()
const itemColumns = [
  itemHelp.accessor('name', { header: 'Company', enableSorting: false }),
  itemHelp.accessor('expected', {
    header: 'Expected',
    enableSorting: false,
    meta: { hideBelow: 'md' },
    cell: (info) =>
      info
        .getValue()
        ?.map((result) => RESULT_LABELS[result])
        .join(' or ') ?? 'Nothing set',
  }),
  itemHelp.accessor('result', {
    header: 'Result',
    enableSorting: false,
    cell: (info) => {
      const result = info.getValue()
      return result ? <ResultBadge result={result} /> : (info.row.original.note ?? 'Not researched')
    },
  }),
  itemHelp.accessor('ok', {
    header: 'As expected',
    enableSorting: false,
    cell: (info) => {
      const ok = info.getValue()
      const Icon = ok === null ? Minus : ok ? CircleCheck : CircleX
      return (
        <span className="inline-flex items-center gap-1">
          <Icon aria-hidden="true" className="size-4" />
          {ok === null ? 'No expectation' : ok ? 'Yes' : 'No'}
        </span>
      )
    },
  }),
  itemHelp.accessor('score', {
    header: 'Score',
    enableSorting: false,
    meta: { align: 'right' },
    cell: (info) => info.getValue() ?? '',
  }),
  itemHelp.accessor('unknown_facts', {
    header: 'Not found',
    enableSorting: false,
    cell: (info) => info.getValue().length,
    meta: { align: 'right', hideBelow: 'md' },
  }),
  itemHelp.accessor('cost_usd', {
    header: 'Cost',
    enableSorting: false,
    meta: { align: 'right', hideBelow: 'sm' },
    cell: (info) => <Money value={info.getValue()} />,
  }),
]

function Report({ runId }: { runId: string }) {
  const report = useTestReport(runId)
  if (report.error)
    return <ErrorState error={report.error} context="The report couldn't be loaded." />
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-section font-semibold">
          Run {shortId(runId)}, company by company
        </CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable
          label="Test report"
          columns={itemColumns}
          data={report.data?.items ?? []}
          getRowId={(item) => item.name}
          loading={report.isFetching}
        />
      </CardContent>
    </Card>
  )
}

export default function AdminTestsTab() {
  const navigate = useNavigate()
  const tests = useTests({ limit: 50 })
  const start = useStartTestRun()
  const [active, setActive] = useState<string | null>(null)
  const items = tests.data?.items ?? []
  const shown = active ?? items[0]?.run_id ?? null
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-prose text-ui text-muted-foreground">
          Run it after a change to a prompt or a rule, and keep the change only if the score holds.
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" disabled={start.isPending}>
              <FlaskConical aria-hidden="true" />
              Run the test set
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Run the test set?</AlertDialogTitle>
              <AlertDialogDescription>
                It researches 10 companies with real searches, so it costs money: about US$10, never
                more than the run limit.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  start.mutate(undefined, {
                    onSuccess: (run) => {
                      void navigate(`/runs/${run.id}`)
                    },
                    onError: toastProblem,
                  })
                }}
              >
                Run it
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {tests.error ? (
        <ErrorState error={tests.error} context="The test runs couldn't be loaded." />
      ) : (
        <DataTable
          label="Test set runs"
          columns={summaryColumns}
          data={items}
          getRowId={(item) => item.run_id}
          activeRowId={shown}
          onActiveRowChange={setActive}
          loading={tests.isFetching}
          empty={
            <EmptyState
              icon={FlaskConical}
              title="The test set hasn't been run yet."
              description="Run it to see how each company comes out against the rules."
              headingLevel={3}
            />
          }
        />
      )}
      {shown ? <Report runId={shown} /> : null}
    </div>
  )
}
