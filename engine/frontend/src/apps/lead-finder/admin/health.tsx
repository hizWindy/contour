/**
 * Admin, Health (PLAN-V13 T1-6): is everything working? One row for each system the platform leans
 * on (the database, Claude, HubSpot, Signal Hire, email, the runs, the schedules and the API),
 * problems first, each with what to do next. Below, the API's last hour as a small table: failed
 * first, then "not ready" (503, said on purpose and not a failure), then the slowest endpoints.
 *
 * Every check is free (the backend asks Claude for its model list, never for an answer), and the
 * backend keeps the answer for a minute, so opening the tab again doesn't check again. "Check
 * again" asks for a fresh look at every system.
 */
import { RefreshCw, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useCheckHealthAgain, useHealth } from '@/api/hooks'
import type { EndpointTraffic, HealthDetails, HealthState, SystemCheck } from '@/api/types'
import { ErrorState } from '@/components/error-state'
import { Reveal } from '@/components/motion'
import { PendingCards } from '@/components/skeletons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatNumber, formatTime, pluralise } from '@/lib/format'
import { toastProblem } from '@/lib/problems'
import { cn } from '@/lib/utils'
import { API_ROWS, STATES, apiSummary, sortChecks } from './health-states'

function StateBadge({ state }: { state: HealthState }) {
  const { label, icon: Icon, variant } = STATES[state]
  return (
    <Badge variant={variant} data-state={state} className="w-24 justify-start">
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  )
}

function took(ms: number): string {
  return ms < 1000 ? `${formatNumber(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

function SystemRow({ check, index }: { check: SystemCheck; index: number }) {
  return (
    <Reveal
      index={index}
      role="listitem"
      aria-label={`${check.name}: ${STATES[check.state].label}`}
      className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 border-b py-3 last:border-b-0 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
    >
      <StateBadge state={check.state} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-ui">
          <span className="font-semibold">{check.name}.</span> {check.sentence}
        </p>
        {check.next_step && check.state !== 'ok' ? (
          <p
            className={cn(
              'text-caption',
              check.state === 'problem' ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {check.state === 'problem' ? 'Next: ' : ''}
            {check.next_step}
          </p>
        ) : null}
      </div>
      <p
        className="col-start-2 text-caption text-muted-foreground tabular-nums sm:col-start-3 sm:text-right"
        title={`Checked at ${formatTime(check.checked_at)}`}
      >
        {took(check.took_ms)}
      </p>
    </Reveal>
  )
}

/** Every row was checked in the same pass, so the time is said once, with "Check again". */
function SystemsCard({ details }: { details: HealthDetails }) {
  const again = useCheckHealthAgain()
  const checks = sortChecks(details.checks)
  const problems = checks.filter((check) => check.state === 'problem').length
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-section font-semibold">Systems</CardTitle>
        <CardDescription aria-live="polite">
          Checked at {formatTime(details.checked_at)}.{' '}
          {problems === 0
            ? 'Nothing needs you.'
            : `${pluralise(problems, 'system needs', 'systems need')} you.`}
        </CardDescription>
        <CardAction>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={again.isPending}
            onClick={() => {
              again.mutate(undefined, { onError: toastProblem })
            }}
          >
            <RefreshCw aria-hidden="true" />
            {again.isPending ? 'Checking' : 'Check again'}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div role="list" aria-label="Systems">
          {checks.map((check, index) => (
            <SystemRow key={check.id} check={check} index={index} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function ApiCard({ details }: { details: HealthDetails }) {
  const [all, setAll] = useState(false)
  const api = details.api
  if (!api) {
    return null
  }
  const shown: EndpointTraffic[] = all ? api.endpoints : api.endpoints.slice(0, API_ROWS)
  const notReady = api.unavailable > 0
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-section font-semibold">
          API, since {formatTime(api.since)}
        </CardTitle>
        <CardDescription>
          {apiSummary(api)} Failed first, then not ready, then the slowest. Counted in memory, so a
          restart starts again.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {api.endpoints.length === 0 ? (
          <p className="text-ui text-muted-foreground">No requests yet.</p>
        ) : (
          <Table compact aria-label="API endpoints">
            <TableHeader>
              <TableRow>
                <TableHead>Endpoint</TableHead>
                <TableHead className="text-right">Requests</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                {notReady ? <TableHead className="text-right">Not ready</TableHead> : null}
                <TableHead className="text-right">Slowest</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((row) => (
                <TableRow key={`${row.method} ${row.path}`}>
                  <TableCell
                    className="max-w-0 min-w-56 truncate font-mono text-caption"
                    title={`${row.method} ${row.path}`}
                  >
                    <span className="text-muted-foreground">{row.method}</span> {row.path}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(row.requests)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right tabular-nums',
                      row.errors > 0
                        ? 'font-semibold text-destructive-ink'
                        : 'text-muted-foreground',
                    )}
                    title={
                      row.last_error_at
                        ? `The last answered ${String(row.last_error_status ?? 'an error')} at ${formatTime(row.last_error_at)}`
                        : undefined
                    }
                  >
                    {row.errors > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <TriangleAlert aria-hidden="true" className="size-3.5" />
                        {formatNumber(row.errors)}
                      </span>
                    ) : (
                      '0'
                    )}
                  </TableCell>
                  {notReady ? (
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatNumber(row.unavailable)}
                    </TableCell>
                  ) : null}
                  <TableCell className="text-right tabular-nums">{took(row.slowest_ms)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {api.endpoints.length > API_ROWS ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            aria-expanded={all}
            onClick={() => {
              setAll((open) => !open)
            }}
          >
            {all ? 'Show fewer' : `Show all ${formatNumber(api.endpoints.length)}`}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}

export default function AdminHealthTab() {
  const health = useHealth()
  const details = health.data
  if (health.error && !details) {
    return <ErrorState error={health.error} context="The health checks couldn't be loaded." />
  }
  if (!details) {
    return <PendingCards label="Checking every system" cards={2} lines={6} />
  }
  return (
    <div className="flex flex-col gap-6">
      <SystemsCard details={details} />
      <ApiCard details={details} />
    </div>
  )
}
