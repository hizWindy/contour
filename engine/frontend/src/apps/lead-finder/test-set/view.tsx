/**
 * Test set: the 10 public test companies, and how each came out in the last runs (a Lead Finder
 * page, once an Admin tab; redesigned in PLAN-V13 T2-7). A change to a prompt or a rule stays
 * only if the test set score holds.
 *
 * At the top, the last run in one line and the run before it for comparison. Then a grid: the
 * companies down the side, the last 5 runs across, each cell the result's icon and colour; a cell
 * that changed from the run before gets a small mark. A company opens a side panel with what each
 * run said and what changed. "Run the test set" keeps its cost confirm, from the estimate.
 */
import { useQueries } from '@tanstack/react-query'
import { CircleX, FlaskConical } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { api, unwrap } from '@/api/client'
import { useEstimateRun, useStartTestRun, useTests } from '@/api/hooks'
import { queryKeys } from '@/api/query'
import type { RunCreate, TestReport } from '@/api/types'
import { RESULT_META, UNKNOWN_META } from '@/components/badge-meta'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Money } from '@/components/money'
import { Reveal } from '@/components/motion'
import { ResultBadge } from '@/components/result-badge'
import { PendingCards } from '@/components/skeletons'
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatDate, pluralise, shortId } from '@/lib/format'
import { isLeadResult, RESULT_LABELS, resultLabel } from '@/lib/labels'
import { formatMoney } from '@/lib/money'
import { toastProblem } from '@/lib/problems'
import { cn } from '@/lib/utils'
import {
  buildGrid,
  changeWords,
  compared,
  resultOf,
  RUNS_ACROSS,
  summaryLine,
  type GridCell,
  type GridRow,
  type TestSummary,
} from './grid'

/** The body the backend's "Run the test set" uses (mode `testset`, no choices), for the estimate. */
const TEST_SET_RUN: RunCreate = { app: 'lead_finder', mode: 'testset', params: {} }

const CELL_CLASSES: Record<string, string> = {
  pass: 'bg-pass-soft text-pass-ink',
  director_review: 'bg-review-soft text-review-ink',
  watch: 'bg-watch-soft text-watch-ink',
  drop: 'border border-input text-muted-foreground',
  failed: 'bg-destructive-soft text-destructive-ink',
}

function wordsOf(result: string | null): string {
  if (result === null) return 'Not in this run'
  if (result === 'failed') return 'Failed'
  return resultLabel(result)
}

const COMPARED_WORDS = { better: 'Better now.', same: 'The same.', worse: 'Worse now.' } as const

/** One cell: the result's icon in its colour, the score, and a mark when it changed. */
function Cell({ cell, loading }: { cell: GridCell; loading: boolean }) {
  const result = resultOf(cell.item)
  if (result === null) {
    return (
      <td className="p-1 text-center text-caption text-muted-foreground">
        {loading ? <span className="sr-only">Loading</span> : <span aria-hidden="true">·</span>}
      </td>
    )
  }
  const icon =
    result === 'failed'
      ? CircleX
      : isLeadResult(result)
        ? RESULT_META[result].icon
        : UNKNOWN_META.icon
  const Icon = icon
  const score = cell.item?.score
  const title = `${wordsOf(result)}${score != null ? `, ${score}` : ''}${cell.changed ? ', changed from the run before' : ''}`
  return (
    <td className="p-1 text-center">
      <span
        data-result={result}
        data-changed={cell.changed || undefined}
        title={title}
        className={cn(
          'relative inline-flex min-w-14 items-center justify-center gap-1 rounded-md px-2 py-1 text-caption tabular-nums',
          CELL_CLASSES[result] ?? 'border border-input',
        )}
      >
        <Icon aria-hidden="true" className="size-4" />
        <span className="sr-only">{wordsOf(result)}</span>
        {score != null ? <span>{score}</span> : null}
        {cell.changed ? (
          <span
            role="img"
            aria-label="Changed from the run before"
            className="absolute -top-1 -right-1 size-2.5 rounded-xs bg-accent-strong"
          />
        ) : null}
      </span>
    </td>
  )
}

/** The side panel for one company: what each run said, and what changed between them. */
function CompanyPanel({ row, onClose }: { row: GridRow | null; onClose: () => void }) {
  const cells = row ? [...row.cells].reverse() : []
  return (
    <Sheet
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader className="pr-12">
          <SheetTitle>{row?.name ?? 'Company'}</SheetTitle>
          <SheetDescription>
            {row?.city ?? 'City unknown'}.{' '}
            {row?.expected?.length
              ? `Expected: ${row.expected.map((result) => RESULT_LABELS[result]).join(' or ')}.`
              : 'Nothing expected.'}
          </SheetDescription>
        </SheetHeader>
        <ol className="flex flex-col px-4 pb-6">
          {cells.map((cell, index) => {
            const before = cells[index + 1]
            const change = before ? changeWords(before.item, cell.item, wordsOf) : null
            const item = cell.item
            return (
              <li key={cell.run.run_id} className="flex flex-col gap-1 border-b py-3 last:border-0">
                <div className="flex flex-wrap items-center justify-between gap-2 text-ui">
                  <span className="font-semibold tabular-nums">
                    {formatDate(cell.run.created_at)}{' '}
                    <span className="font-normal text-muted-foreground">
                      ({shortId(cell.run.run_id)})
                    </span>
                  </span>
                  {item?.result ? (
                    <ResultBadge result={item.result} />
                  ) : (
                    <span className="text-muted-foreground">{wordsOf(resultOf(item))}</span>
                  )}
                </div>
                {item ? (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-caption">
                    <dt className="text-muted-foreground">Score</dt>
                    <dd className="tabular-nums">{item.score ?? 'None'}</dd>
                    <dt className="text-muted-foreground">As expected</dt>
                    <dd>{item.ok === null ? 'Nothing expected' : item.ok ? 'Yes' : 'No'}</dd>
                    <dt className="text-muted-foreground">Cost</dt>
                    <dd className="tabular-nums">
                      <Money value={item.cost_usd} />
                    </dd>
                    <dt className="text-muted-foreground">Not found</dt>
                    <dd>{item.unknown_facts.length ? item.unknown_facts.join(', ') : 'Nothing'}</dd>
                    {item.note ? (
                      <>
                        <dt className="text-muted-foreground">Note</dt>
                        <dd>{item.note}</dd>
                      </>
                    ) : null}
                  </dl>
                ) : null}
                {change ? (
                  <p className="text-caption text-accent-ink">Changed: {change}</p>
                ) : before ? (
                  <p className="text-caption text-muted-foreground">Same as the run before.</p>
                ) : null}
              </li>
            )
          })}
        </ol>
      </SheetContent>
    </Sheet>
  )
}

/** The cost confirm, from the estimate of a `testset` run. */
function RunButton() {
  const navigate = useNavigate()
  const start = useStartTestRun()
  const estimate = useEstimateRun(TEST_SET_RUN)
  const e = estimate.data
  let words =
    'It researches 10 companies with real searches, so it costs money: about US$5, and never more than the run limit.'
  if (e?.valid && e.companies_expected > 0) {
    const each = (Number(e.cost_usd_low) / e.companies_expected).toFixed(2)
    words = `It researches ${pluralise(e.companies_expected, 'company', 'companies')} with real searches, so it costs money: about ${formatMoney(e.cost_usd_low)} (${formatMoney(each)} a company), and never more than ${formatMoney(e.cap_usd)}.`
  }
  return (
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
          <AlertDialogDescription>{words}</AlertDialogDescription>
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
  )
}

export default function TestSetView() {
  const tests = useTests({ limit: RUNS_ACROSS })
  const runs = tests.data?.items ?? []
  const reports = useQueries({
    queries: runs.map((run) => ({
      queryKey: queryKeys.tests.report(run.run_id),
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        unwrap(
          await api.GET('/lead-finder/tests/{run_id}', {
            params: { path: { run_id: run.run_id } },
            signal,
          }),
        ),
    })),
  })
  const [open, setOpen] = useState<string | null>(null)

  if (tests.error) {
    return <ErrorState error={tests.error} context="The test runs couldn't be loaded." />
  }
  if (!tests.data) {
    return <PendingCards label="Loading the test set." cards={2} />
  }

  const byRun = new Map<string, TestReport | undefined>()
  runs.forEach((run, index) => byRun.set(run.run_id, reports[index]?.data))
  const grid = buildGrid(runs, byRun)
  const loading = reports.some((report) => report.isPending)
  const newest = runs[0]
  const before = runs[1]
  const money = (value: string) => formatMoney(value)
  const openRow = grid.rows.find((row) => row.name === open) ?? null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        {newest ? (
          <div className="flex flex-col gap-1 text-ui">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-semibold tabular-nums">
                {summaryLine(newest, { money, date: formatDate })}
              </span>
              <StatusBadge status={newest.status} />
            </p>
            {before ? (
              <p className="text-muted-foreground tabular-nums">
                The run before: {summaryLine(before, { money, date: formatDate })}.{' '}
                {COMPARED_WORDS[compared(newest, before)]}
              </p>
            ) : (
              <p className="text-muted-foreground">The first run, so nothing to compare yet.</p>
            )}
          </div>
        ) : (
          <p className="max-w-prose text-ui text-muted-foreground">
            Run it after a change to a prompt or a rule, and keep the change only if the score
            holds.
          </p>
        )}
        <RunButton />
      </div>

      {runs.length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title="The test set hasn't been run yet."
          description="Run it to see how each company comes out against the rules."
          headingLevel={3}
        />
      ) : (
        <Reveal>
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-section font-semibold">Company by company</CardTitle>
              <CardDescription>
                The last {pluralise(grid.runs.length, 'run')}, oldest on the left. A marked cell
                changed from the run before. Open a company for the details.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-ui" aria-label="Test set grid">
                <thead>
                  <tr className="border-b">
                    <th
                      scope="col"
                      className="sticky left-0 bg-card px-4 py-2 text-left font-semibold"
                    >
                      Company
                    </th>
                    {grid.runs.map((run: TestSummary) => (
                      <th
                        key={run.run_id}
                        scope="col"
                        className="px-2 py-2 text-center font-semibold whitespace-nowrap"
                      >
                        <span className="block tabular-nums">{formatDate(run.created_at)}</span>
                        <span className="block text-caption font-normal text-muted-foreground tabular-nums">
                          {run.matched} of {run.expected}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.rows.map((row) => (
                    <tr key={row.name} className="border-b last:border-0 hover:bg-muted">
                      <th
                        scope="row"
                        className="sticky left-0 bg-card px-4 py-1 text-left font-normal"
                      >
                        <button
                          type="button"
                          onClick={() => setOpen(row.name)}
                          className="flex flex-col rounded-sm text-left font-semibold underline-offset-4 hover:underline"
                        >
                          {row.name}
                          <span className="text-caption font-normal text-muted-foreground">
                            {row.expected?.length
                              ? `Expected ${row.expected.map((result) => RESULT_LABELS[result]).join(' or ')}`
                              : 'Nothing expected'}
                          </span>
                        </button>
                      </th>
                      {row.cells.map((cell) => (
                        <Cell key={cell.run.run_id} cell={cell} loading={loading} />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </Reveal>
      )}
      <CompanyPanel row={openRow} onClose={() => setOpen(null)} />
    </div>
  )
}
