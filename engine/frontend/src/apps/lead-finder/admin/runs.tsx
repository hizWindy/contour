/** Admin, Runs and cost: what Claude cost each day (Melbourne days), and every run. */
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { useRunSummary } from '@/api/hooks'
import { ErrorState } from '@/components/error-state'
import { Money } from '@/components/money'
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
              'Loading.'
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
      <RunsTable />
    </div>
  )
}
