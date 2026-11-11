/**
 * Runs and cost on Home (the "bento" Home, 11 Nov): what the runs cost over the last 30 days, and
 * a small bar for each of the newest days with a run. It is shared, like Admin's "Runs and cost"
 * tab it opens: the backend counts the runs of the projects this person may use.
 *
 * One bar is lit in the accent (today's, or the newest), the rest are the muted ink at 70%
 * (DESIGN.md "The accent"). Pointing at a bar lights it, and the line under the bars says its day.
 * A screen reader hears the list of days and their numbers. The bars grow once when the page
 * opens, and with reduced motion they are simply there.
 */
import { ArrowRight, ListChecks } from 'lucide-react'
import { m } from 'motion/react'
import { useState } from 'react'
import { Link } from 'react-router'
import { useRunSummary } from '@/api/hooks'
import { springs, useStill } from '@/components/motion'
import { PendingText, SkeletonLines } from '@/components/skeletons'
import { Card } from '@/components/ui/card'
import { melbourneDate, pluralise } from '@/lib/format'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  COST_BARS,
  COST_DAYS,
  costBars,
  barLabels,
  costSince,
  shortDay,
  weekdayDay,
  type CostBar,
} from './home-words'
import { ADMIN_TABS } from './nav'

const TITLE_ID = 'home-runs-cost'

/** The Admin tab this card opens, so it has the same name and icon (DESIGN.md "Same thing, same look"). */
const TAB = ADMIN_TABS.find((tab) => tab.to === '/admin/runs')
const TabIcon = TAB?.icon ?? ListChecks

function dayLine(bar: CostBar, today: string): string {
  const day = bar.date === today ? 'Today' : weekdayDay(bar.date)
  return `${day}: ${pluralise(bar.runs, 'run')}, ${formatMoney(bar.cost)}.`
}

function Bars({ bars, today, more }: { bars: CostBar[]; today: string; more: boolean }) {
  const still = useStill()
  const fallback = bars.findIndex((bar) => bar.date === today)
  const resting = fallback >= 0 ? fallback : bars.length - 1
  const [pointed, setPointed] = useState<number | null>(null)
  const lit = pointed ?? resting
  const litBar = bars[lit]
  const labels = barLabels(
    bars.map((bar) => bar.date),
    today,
  )
  return (
    <div className="flex flex-col gap-2">
      <ol
        aria-label={
          more
            ? `Spend on the last ${String(COST_BARS)} days with a run`
            : 'Spend on each day with a run'
        }
        className="grid h-32 items-end gap-2"
        style={{
          gridTemplateColumns: `repeat(${String(Math.max(bars.length, 4))}, minmax(0, 1fr))`,
        }}
        onPointerLeave={() => {
          setPointed(null)
        }}
      >
        {bars.map((bar, index) => {
          const on = index === lit
          return (
            <li
              key={bar.date}
              className="flex h-full flex-col justify-end gap-1.5"
              onPointerEnter={() => {
                setPointed(index)
              }}
            >
              <span className="sr-only">{dayLine(bar, today)}</span>
              <span aria-hidden="true" className="flex flex-1 items-end">
                <m.span
                  className={cn(
                    'block w-full rounded-t-xs',
                    on ? 'bg-chart-1' : 'bg-muted-foreground opacity-70',
                  )}
                  style={{
                    height: `${String(Math.max(4, bar.share * 100))}%`,
                    transformOrigin: 'bottom',
                  }}
                  initial={still ? false : { scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ ...springs.smooth, delay: Math.min(index, 8) * 0.04 }}
                />
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'truncate text-center text-caption tabular-nums',
                  on ? 'font-semibold text-foreground' : 'text-muted-foreground',
                )}
              >
                {labels[index]}
              </span>
            </li>
          )
        })}
      </ol>
      {/* The day you point at. At rest it is today's, which the line above already says. */}
      <p aria-hidden="true" className="min-h-5 text-caption text-muted-foreground">
        {litBar && (pointed !== null || litBar.date !== today) ? dayLine(litBar, today) : null}
      </p>
    </div>
  )
}

function Body() {
  const today = melbourneDate()
  const summary = useRunSummary(costSince(today))
  if (summary.isPending) {
    return (
      <div className="flex flex-col gap-3">
        <PendingText className="h-9 w-32" />
        <SkeletonLines count={2} />
      </div>
    )
  }
  if (summary.isError) {
    return <p className="text-ui text-muted-foreground">Can't load the cost right now.</p>
  }
  const data = summary.data
  if (data.total_runs === 0) {
    return (
      <p className="font-serif text-ui text-muted-foreground">
        No runs in the last {COST_DAYS} days.
      </p>
    )
  }
  const bars = costBars(data)
  const todayCost = data.days.find((day) => day.date === today)
  const withRuns = data.days.filter((day) => day.runs > 0).length
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-display font-semibold text-foreground tabular-nums">
          {formatMoney(data.total_cost_usd)}
        </p>
        <p className="text-ui text-muted-foreground">
          {pluralise(data.total_runs, 'run')} since {shortDay(data.since)}.{' '}
          {todayCost ? `Today ${formatMoney(todayCost.cost_usd)}.` : 'None today.'}
        </p>
      </div>
      {bars.length > 0 ? <Bars bars={bars} today={today} more={withRuns > bars.length} /> : null}
    </div>
  )
}

export function RunsCostCard() {
  return (
    <Card role="region" aria-labelledby={TITLE_ID} className="h-full gap-5">
      <div className="flex items-center gap-3 px-6">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground"
        >
          <TabIcon className="size-5" />
        </span>
        <h2 id={TITLE_ID} className="flex-1 text-section font-semibold text-foreground">
          {TAB?.label ?? 'Runs and cost'}
        </h2>
        <Link
          to={TAB?.to ?? '/admin/runs'}
          aria-label="Open Runs and cost in Admin"
          className="inline-flex shrink-0 items-center gap-1 rounded-sm text-ui text-link underline-offset-4 hover:underline"
        >
          Admin
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
      <div className="px-6">
        <Body />
      </div>
    </Card>
  )
}
