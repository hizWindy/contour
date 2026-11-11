/**
 * Admin, Runs and cost (PLAN-V13 T1-8): three stat tabs (this round, this month, cost per good
 * lead). The selected one has the accent underline and drives the chart under it: spend by day,
 * with one bar lit in the accent (the day you point at, or today) and the rest muted. Then a compact
 * table of the newest runs, and why leads were rejected (PLAN-V9 D1).
 *
 * The chart (DESIGN.md "The accent", the dataviz method): one series, so no legend; bars at most
 * 24px wide with a 4px rounded top on one baseline; recessive hairline grid. The muted bars are the
 * muted ink at 70%, which keeps them 3:1 on the card in light and dark (checked with the palette
 * validator: the line colour `--border` gave 1.4:1, too faint to read). It works by keyboard: the
 * arrows move the lit day, and the line under the chart says that day's numbers. "Show the
 * numbers" is the same data as a table. The bars grow once when the page opens (a transform), and
 * with reduced motion they are simply there.
 */
import { m } from 'motion/react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import { useLeadFinderRound, useRejectReasons, useRunSummary, useRuns } from '@/api/hooks'
import type { Run } from '@/api/types'
import { ErrorState } from '@/components/error-state'
import { Money } from '@/components/money'
import { springs, TabIndicator, useStill } from '@/components/motion'
import { PendingCards, PendingText } from '@/components/skeletons'
import { StatusBadge } from '@/components/status-badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDate, formatNumber, melbourneDate } from '@/lib/format'
import { RUN_MODE_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { goodLeads } from '../good-leads-data'
import {
  addDays,
  barValue,
  dayLine,
  dayWords,
  daysOf,
  statsOf,
  type Day,
  type Stat,
  type StatId,
} from './runs-stats'

const CHART: ChartConfig = { value: { label: 'Spend', color: 'var(--chart-1)' } }
const RUN_ROWS = 10
const MUTED_OPACITY = 0.7

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

/** The three stats as tabs: arrows move between them, as in any tab list. */
function StatTabs({
  stats,
  selected,
  onSelect,
  panelId,
}: {
  stats: Stat[]
  selected: StatId
  onSelect: (id: StatId) => void
  panelId: string
}) {
  const list = useRef<HTMLDivElement>(null)
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = stats.findIndex((stat) => stat.id === selected)
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % stats.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + stats.length) % stats.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? stats.length - 1
              : -1
    const stat = stats[next]
    if (!stat) return
    event.preventDefault()
    onSelect(stat.id)
    list.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus()
  }
  return (
    <div
      ref={list}
      role="tablist"
      aria-label="What to show"
      className="grid grid-cols-3 border-b"
      onKeyDown={onKeyDown}
    >
      {stats.map((stat) => {
        const on = stat.id === selected
        return (
          <button
            key={stat.id}
            type="button"
            role="tab"
            id={`${panelId}-${stat.id}`}
            aria-selected={on}
            aria-controls={panelId}
            tabIndex={on ? 0 : -1}
            onClick={() => {
              onSelect(stat.id)
            }}
            className={cn(
              'relative flex w-full min-w-0 flex-col items-start gap-0.5 px-3 py-3 text-left transition-colors duration-(--duration-fast) ease-(--ease) focus-visible:outline-offset-[-2px] sm:px-4',
              on ? 'text-foreground' : 'text-muted-foreground hover:bg-muted/60',
            )}
          >
            <span className="w-full truncate text-caption font-semibold">{stat.label}</span>
            <span className="text-section font-semibold text-foreground tabular-nums sm:text-title">
              {stat.value === null ? '-' : <Money value={stat.value} />}
            </span>
            <span className="w-full truncate text-caption" title={stat.detail}>
              {stat.detail}
            </span>
            <TabIndicator group="runs-stats" active={on} />
          </button>
        )
      })}
    </div>
  )
}

/** A bar with a 4px rounded top on a square base. */
function topRounded(x: number, y: number, width: number, height: number): string {
  const r = Math.max(0, Math.min(4, width / 2, height))
  return `M${String(x)},${String(y + height)}V${String(y + r)}Q${String(x)},${String(y)} ${String(x + r)},${String(y)}H${String(x + width - r)}Q${String(x + width)},${String(y)} ${String(x + width)},${String(y + r)}V${String(y + height)}Z`
}

interface BarShapeProps {
  x?: number
  y?: number
  width?: number
  height?: number
  index?: number
}

function SpendChart({ days, stat, label }: { days: Day[]; stat: StatId; label: string }) {
  const still = useStill()
  const [hover, setHover] = useState<number | null>(null)
  const [focus, setFocus] = useState<number | null>(null)
  const grown = useRef(false)
  useEffect(() => {
    grown.current = true // the bars grow once, when the page opens
  }, [])
  const today = days.length - 1
  const lit = hover ?? focus ?? today
  const data = days.map((day) => ({ date: day.date, value: barValue(day, stat) }))
  const litDay = days[lit]

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const at = focus ?? today
    const next =
      event.key === 'ArrowRight'
        ? Math.min(at + 1, today)
        : event.key === 'ArrowLeft'
          ? Math.max(at - 1, 0)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? today
              : null
    if (next === null) return
    event.preventDefault()
    setFocus(next)
  }

  function shape(props: BarShapeProps) {
    const { x = 0, y = 0, width = 0, height = 0, index = 0 } = props
    const on = index === lit
    if (height <= 0) {
      // A day with nothing spent has no bar: the lit one still shows where it is.
      return on ? (
        <rect x={x} y={y - 3} width={width} height={3} rx={1.5} fill="var(--chart-1)" />
      ) : (
        <g />
      )
    }
    const fill = on ? 'var(--chart-1)' : 'var(--muted-foreground)'
    const path = topRounded(x, y, width, height)
    if (still || grown.current) {
      return <path d={path} fill={fill} fillOpacity={on ? 1 : MUTED_OPACITY} />
    }
    return (
      <m.path
        d={path}
        fill={fill}
        fillOpacity={on ? 1 : MUTED_OPACITY}
        style={{ transformBox: 'fill-box', transformOrigin: 'bottom' }}
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={{ ...springs.smooth, delay: Math.min(index, 30) * 0.008 }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        tabIndex={0}
        role="group"
        aria-label={`${label} by day. The left and right arrows move between days.`}
        className="rounded-md"
        onKeyDown={onKeyDown}
        onBlur={() => {
          setFocus(null)
        }}
      >
        <ChartContainer config={CHART} className="h-56 w-full">
          <BarChart
            data={data}
            barCategoryGap="20%"
            accessibilityLayer={false}
            onMouseMove={(state) => {
              const index = Number(state.activeTooltipIndex)
              setHover(Number.isInteger(index) && index >= 0 ? index : null)
            }}
            onMouseLeave={() => {
              setHover(null)
            }}
          >
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={24}
              tickFormatter={(date: string) => dayWords(date).slice(4)}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(value: number) => `US$${String(Math.round(value))}`}
            />
            <Tooltip
              cursor={{ fill: 'var(--muted)', opacity: 0.5 }}
              isAnimationActive={false}
              content={({ active, label: date }) => {
                const day = days.find((item) => item.date === date)
                if (!active || !day) return null
                return (
                  <div className="rounded-md border bg-popover px-2.5 py-1.5 text-caption text-popover-foreground shadow-float">
                    {dayLine(day, stat)}
                  </div>
                )
              }}
            />
            <Bar dataKey="value" maxBarSize={24} isAnimationActive={false} shape={shape} />
          </BarChart>
        </ChartContainer>
      </div>
      <p className="text-ui" aria-live="polite" data-slot="lit-day">
        {litDay
          ? `${lit === today && hover === null && focus === null ? 'Today, ' : ''}${dayLine(litDay, stat)}`
          : ''}
      </p>
      <details className="text-ui">
        <summary className="w-fit cursor-pointer text-muted-foreground hover:text-foreground">
          Show the numbers
        </summary>
        <Table compact aria-label={`${label} by day, as a table`} className="mt-2">
          <TableHeader>
            <TableRow>
              <TableHead>Day</TableHead>
              <TableHead className="text-right">Runs</TableHead>
              <TableHead className="text-right">Good leads</TableHead>
              <TableHead className="text-right">Spend</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {days.map((day) => (
              <TableRow key={day.date}>
                <TableCell>{dayWords(day.date)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(day.runs)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(day.good)}</TableCell>
                <TableCell className="text-right tabular-nums">US${day.cost.toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </div>
  )
}

/** What a run was: the cities it searched, or its kind. */
function whatOf(run: Run): string {
  const cities = (run.params as { cities?: unknown }).cities
  if (run.mode === 'discovery' && Array.isArray(cities) && cities.length > 0) {
    return cities.join(', ')
  }
  return RUN_MODE_LABELS[run.mode] ?? run.mode
}

function RecentRuns({ runs }: { runs: Run[] }) {
  const shown = runs.slice(0, RUN_ROWS)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-section font-semibold">The newest runs</CardTitle>
        <CardDescription>
          {runs.length === 0 ? 'No run this month yet.' : 'This month, newest first.'}
        </CardDescription>
        <CardAction>
          <Link to="/runs" className="text-ui text-link underline-offset-4 hover:underline">
            Every run
          </Link>
        </CardAction>
      </CardHeader>
      {shown.length > 0 ? (
        <CardContent>
          <Table compact aria-label="The newest runs">
            <TableHeader>
              <TableRow>
                <TableHead>City or kind</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Good leads</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="max-w-56 truncate">
                    <Link
                      to={`/runs/${run.id}`}
                      className="font-semibold underline-offset-4 hover:underline"
                    >
                      {whatOf(run)}
                    </Link>
                    {run.schedule_id ? (
                      <span className="ml-2 text-caption text-muted-foreground">Automatic</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(run.created_at)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(goodLeads(run.counts))}
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={run.cost_usd} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={run.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      ) : null}
    </Card>
  )
}

export default function AdminRunsTab() {
  const panelId = useId()
  const today = melbourneDate()
  const round = useLeadFinderRound()
  const [selected, setSelected] = useState<StatId>('round')
  // Enough days for this month and this round: 40 back covers both.
  const since = addDays(today, -40)
  const summary = useRunSummary(since)
  const runs = useRuns({ since, limit: 200 })
  const error = summary.error ?? runs.error
  if (error) {
    return <ErrorState error={error} context="The runs and their cost couldn't be loaded." />
  }
  if (!summary.data || !runs.data) {
    return <PendingCards label="Loading the runs and their cost" cards={2} lines={6} />
  }
  const items = runs.data.items
  const stats = statsOf(round.data, daysOf(summary.data, items, since, today), today)
  const stat = stats.find((item) => item.id === selected) ?? stats[0]
  const shown = stat ? daysOf(summary.data, items, stat.from, today) : []
  const monthRuns = items.filter((run) => melbourneDate(run.created_at) >= `${today.slice(0, 8)}01`)
  return (
    <div className="flex flex-col gap-6">
      <Card className="gap-0 py-0">
        <StatTabs stats={stats} selected={selected} onSelect={setSelected} panelId={panelId} />
        <div
          role="tabpanel"
          id={panelId}
          aria-labelledby={`${panelId}-${selected}`}
          className="p-4 sm:p-6"
        >
          {stat ? (
            <SpendChart
              key={stat.id}
              days={shown}
              stat={stat.id}
              label={stat.id === 'per-good' ? 'Cost per good lead' : 'Spend'}
            />
          ) : null}
        </div>
      </Card>
      <RecentRuns runs={monthRuns} />
      <RejectReasonsCard />
    </div>
  )
}
