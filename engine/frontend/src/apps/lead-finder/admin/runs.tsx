/**
 * Admin, Runs and cost: what Claude cost each day (Melbourne days), why leads were rejected over the
 * last 90 days (PLAN-V9 D1: the counts show which rule to tune), and every run.
 */
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { useRejectReasons, useRunSummary } from '@/api/hooks'
import { ErrorState } from '@/components/error-state'
import { Money } from '@/components/money'
import { PendingText } from '@/components/skeletons'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { formatNumber } from '@/lib/format'
import { chartNumber } from '@/lib/money'
import { RunsTable } from '../run/runs-table'

function RejectReasonsCard() {
  const reasons = useRejectReasons(90)
  const data = reasons.data
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-section font-semibold">Why leads were rejected</CardTitle>
        <CardDescription>
          {data ? (
            data.total === 0 ? (
              'No lead was rejected in the last 90 days.'
            ) : (
              <>
                {formatNumber(data.total)} rejected in the last {data.days} days. The reason picked
                most shows which rule to change first.
              </>
            )
          ) : (
            <PendingText />
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {reasons.error ? (
          <ErrorState error={reasons.error} context="The reasons couldn't be loaded." />
        ) : data && data.total > 0 ? (
          <dl
            aria-label="Rejected leads by reason"
            className="grid max-w-md grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1 text-ui"
          >
            {data.reasons.map((item) => (
              <div key={item.reason} className="contents">
                <dt className={item.count === 0 ? 'text-muted-foreground' : undefined}>
                  {item.label}
                </dt>
                <dd className="text-right tabular-nums">{formatNumber(item.count)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </CardContent>
    </Card>
  )
}

const CHART: ChartConfig = { cost: { label: 'Cost (US$)', color: 'var(--chart-1)' } }

export default function AdminRunsTab() {
  const summary = useRunSummary()
  const data = summary.data
  const rows = (data?.days ?? []).map((day) => ({
    date: day.date.slice(5),
    cost: chartNumber(day.cost_usd),
    runs: day.runs,
  }))
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-section font-semibold">Cost by day</CardTitle>
          <CardDescription>
            {data ? (
              <>
                <Money value={data.total_cost_usd} /> across {formatNumber(data.total_runs)} runs
                since {data.since}.
              </>
            ) : (
              <PendingText />
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {summary.error ? (
            <ErrorState error={summary.error} context="The cost by day couldn't be loaded." />
          ) : rows.length === 0 ? (
            <p className="text-ui text-muted-foreground">No runs in the last 30 days.</p>
          ) : (
            <ChartContainer config={CHART} className="h-56 w-full">
              <BarChart data={rows} accessibilityLayer>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={48} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="cost" fill="var(--color-cost)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
      <RejectReasonsCard />
      <RunsTable />
    </div>
  )
}
