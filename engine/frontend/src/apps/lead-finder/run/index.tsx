/**
 * One run, live: what it is doing, what it has found, what it has cost against its cap (and where
 * the money went), the companies it researched, what it was asked to do, and the feed of events. Stop asks the run to stop (it says "Stopping." until it has). Resume continues an
 * interrupted or failed run. Nothing resumes by itself.
 *
 * The numbers come from the live events (`useRunEvents`). The run row (`useRun`) gives the start:
 * the kind of run, its caps and its status, and the final truth once the run has ended.
 */
import {
  CircleCheck,
  CircleDot,
  CircleX,
  Info,
  ListChecks,
  RotateCcw,
  Square,
  Table2,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { useEffect } from 'react'
import { Link, useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ApiProblem } from '@/api/client'
import { useCancelRun, useResumeRun, useRun } from '@/api/hooks'
import { queryKeys } from '@/api/query'
import type { Run } from '@/api/types'
import { CostMeter } from '@/components/cost-meter'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { ResultBadge } from '@/components/result-badge'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { useRunEvents, type RunConnection } from '@/hooks/useRunEvents'
import type { FeedTone, RunEventsState } from '@/hooks/run-events'
import { formatDateTime, formatNumber, formatTime, shortId } from '@/lib/format'
import { isTerminalRunStatus, RESULT_ORDER, RUN_MODE_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { FunnelLine, RunCompanies, RunCostSplit, RunSetupCard } from './details'

const TONE_ICON: Record<FeedTone, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleX,
}

const CONNECTION_WORDS: Record<RunConnection, string> = {
  live: 'Live',
  reconnecting: 'Reconnecting',
  closed: 'Not live',
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-section font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

function progressOf(state: RunEventsState): { value: number; words: string } | null {
  const { counts } = state
  const total = counts.chosen || state.plan?.companies || 0
  if (total > 0) {
    const done = counts.researched + counts.failed
    return { value: Math.min(100, (done / total) * 100), words: `${done} of ${total} companies` }
  }
  if (counts.slices > 0) {
    const done = counts.slices_done + counts.slices_failed
    return {
      value: Math.min(100, (done / counts.slices) * 100),
      words: `${done} of ${counts.slices} searches for companies`,
    }
  }
  return null
}

function RunView({ runId, run }: { runId: string; run: Run }) {
  const queryClient = useQueryClient()
  const events = useRunEvents(runId)
  const cancel = useCancelRun()
  const resume = useResumeRun()
  const { state, connection } = events

  const status = events.status ?? run.status
  const ended = isTerminalRunStatus(status)
  // Once the stream says the run has ended, read the row for the final totals.
  useEffect(() => {
    if (state.finished) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs.detail(runId) })
    }
  }, [state.finished, queryClient, runId])

  const final = events.run ?? run
  const counts = state.lastSeq > 0 ? state.counts : final.counts
  const cost = ended ? final.cost_usd : state.lastSeq > 0 ? state.costUsd : final.cost_usd
  const caps = state.caps ?? final.caps
  const progress = progressOf({ ...state, counts })
  const stopping = (cancel.isPending || final.cancel_requested_at !== null) && !ended
  const canResume = status === 'interrupted' || status === 'failed'
  const byResult = RESULT_ORDER.filter((result) => (counts.by_result[result] ?? 0) > 0)

  // A company finished: the list of companies and the cost split read it again.
  const researched = counts.researched
  useEffect(() => {
    if (researched > 0) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.leads.lists() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.searches.all })
    }
  }, [researched, queryClient])

  return (
    <>
      <PageHeader
        icon={ListChecks}
        tone="lead"
        title={`Run ${shortId(runId)}`}
        description={`${RUN_MODE_LABELS[final.mode] ?? final.mode}. Started ${formatDateTime(final.created_at)}.`}
        actions={
          <>
            <StatusBadge status={status} />
            {!ended ? (
              <Button
                type="button"
                variant="outline"
                disabled={stopping}
                onClick={() => {
                  cancel.mutate(runId)
                }}
              >
                <Square aria-hidden="true" />
                {stopping ? 'Stopping.' : 'Stop'}
              </Button>
            ) : null}
            {canResume ? (
              <Button
                type="button"
                disabled={resume.isPending}
                onClick={() => {
                  resume.mutate(runId)
                }}
              >
                <RotateCcw aria-hidden="true" />
                {resume.isPending ? 'Resuming.' : 'Resume'}
              </Button>
            ) : null}
          </>
        }
      />
      {cancel.error ? <ErrorState error={cancel.error} /> : null}
      {resume.error ? <ErrorState error={resume.error} /> : null}
      {final.error && ended ? (
        <ErrorState
          error={
            new ApiProblem({
              title: final.stop_reason ?? 'The run stopped',
              detail: final.error,
              status: 0,
              code: 'run_failed',
            })
          }
          context={final.error_id ? `Error id ${final.error_id}, for the backend log.` : undefined}
        />
      ) : null}

      {/* On a phone the two columns become one list, in the order of the `order-` numbers: how
          far along it is, what it cost, the links, then the companies, the feed and the setup.
          On a laptop they are two columns and the numbers do nothing. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6 max-lg:contents">
          <Card className="max-lg:order-1">
            <CardHeader>
              <CardTitle className="text-section font-semibold">Progress</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {progress ? (
                <div className="flex flex-col gap-2">
                  <Progress value={progress.value} aria-label="Progress" />
                  <p className="text-caption text-muted-foreground">{progress.words}</p>
                </div>
              ) : (
                <p className="text-ui text-muted-foreground">Planning the run.</p>
              )}
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {counts.slices > 0 ? (
                  <Stat
                    label="Companies found"
                    value={formatNumber(counts.unique || counts.candidates)}
                  />
                ) : null}
                <Stat label="Researched" value={formatNumber(counts.researched)} />
                <Stat label="Skipped" value={formatNumber(counts.skipped)} />
                <Stat label="Failed" value={formatNumber(counts.failed)} />
              </dl>
              <FunnelLine counts={counts} />
              {byResult.length > 0 ? (
                <ul aria-label="Results so far" className="flex flex-wrap gap-2">
                  {byResult.map((result) => (
                    <li key={result} className="flex items-center gap-1 text-ui">
                      <ResultBadge result={result} />
                      <span className="tabular-nums">{counts.by_result[result]}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {final.stop_reason && !final.error ? (
                <p className="text-ui text-muted-foreground">Stopped early: {final.stop_reason}</p>
              ) : null}
              {state.capReached ? (
                <p className="flex items-start gap-2 text-ui text-review-ink">
                  <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  {state.capReached.detail}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <RunCompanies runId={runId} className="max-lg:order-4" />

          <Card className="max-lg:order-5">
            <CardHeader>
              <CardTitle className="text-section font-semibold">What happened</CardTitle>
            </CardHeader>
            <CardContent>
              {state.feed.length === 0 ? (
                <p className="text-ui text-muted-foreground">
                  {ended ? 'This run has no events to show.' : 'Waiting for the first event.'}
                </p>
              ) : (
                <ol
                  aria-label="Run events"
                  // Newest first, in a box of its own: a long run has hundreds of lines, and the
                  // page shouldn't be as long as the log. It takes the keyboard's focus so it can
                  // be scrolled without a mouse.
                  tabIndex={0}
                  className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto pr-1"
                >
                  {[...state.feed].reverse().map((item) => {
                    const Icon = TONE_ICON[item.tone]
                    return (
                      <li key={item.seq} className="flex items-start gap-3 text-ui">
                        <Icon
                          aria-hidden="true"
                          className={cn(
                            'mt-0.5 size-4 shrink-0',
                            item.tone === 'error' && 'text-destructive',
                            item.tone === 'warning' && 'text-review',
                            item.tone === 'success' && 'text-pass',
                            item.tone === 'info' && 'text-muted-foreground',
                          )}
                        />
                        <span className="min-w-0 flex-1">{item.message}</span>
                        <time
                          className="shrink-0 text-caption text-muted-foreground"
                          dateTime={item.at}
                        >
                          {formatTime(item.at)}
                        </time>
                      </li>
                    )
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="flex flex-col gap-4 max-lg:contents" aria-label="Cost and links">
          <Card className="max-lg:order-2">
            <CardHeader>
              <CardTitle className="text-section font-semibold">Cost</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-ui">
              <CostMeter cost={cost} cap={caps.run_cap_usd} status={status} />
              <p className="text-caption text-muted-foreground">
                {formatNumber(state.lastSeq > 0 ? state.claudeRequests : final.claude_requests)}{' '}
                Claude requests,{' '}
                {formatNumber(state.lastSeq > 0 ? state.webSearches : final.web_searches)} web
                searches.
              </p>
              <p className="flex items-center gap-2 text-caption text-muted-foreground">
                <CircleDot
                  aria-hidden="true"
                  className={cn('size-4', connection === 'live' && 'text-primary')}
                />
                {ended ? 'Finished' : CONNECTION_WORDS[connection]}
              </p>
              <RunCostSplit runId={runId} researched={counts.researched} />
            </CardContent>
          </Card>
          <RunSetupCard run={final} className="max-lg:order-6" />
          <Card className="max-lg:order-3">
            <CardContent className="flex flex-col gap-2 pt-6">
              <Button asChild variant="outline">
                <Link to={`/results?run_id=${encodeURIComponent(runId)}`}>
                  <Table2 aria-hidden="true" />
                  See this run's leads
                </Link>
              </Button>
              <Button asChild variant="ghost">
                <Link to={`/admin/searches?run_id=${encodeURIComponent(runId)}`}>
                  <ListChecks aria-hidden="true" />
                  Its search log
                </Link>
              </Button>
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  )
}

export default function RunPage() {
  const { runId = '' } = useParams()
  const run = useRun(runId)
  if (run.error) {
    return (
      <>
        <PageHeader title={`Run ${shortId(runId)}`} />
        <ErrorState
          error={run.error}
          context="This run couldn't be loaded."
          onRetry={() => void run.refetch()}
        />
      </>
    )
  }
  if (!run.data) {
    return <EmptyState title="Loading the run." />
  }
  return <RunView runId={runId} run={run.data} />
}
