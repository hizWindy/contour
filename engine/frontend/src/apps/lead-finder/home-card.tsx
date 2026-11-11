/**
 * The Lead Finder on Home (the "bento" Home, 11 Nov): its main card, two columns wide on a laptop.
 *
 * - **The count:** good leads (a Pass or a Director review) in large digits, with the line "2 pass
 *   and 7 for the director, out of 59 found".
 * - **The results bar:** every lead by result, in the result colours, with the result badges under
 *   it as the legend. Each badge opens Results with only that result.
 * - **Signs seen most:** the four signs most leads show, each a link to Results with that sign.
 *   The biggest is lit in the accent (DESIGN.md "The accent": a chart's one highlighted bar).
 * - **Start with these:** the three best good leads nobody has acted on yet, each with its sign and
 *   when it happened, so the card says what to open first.
 * - **The last run** and the one main button, "Start a run".
 *
 * Each part asks for its own data and says so plainly if it can't load. The bars grow once when
 * the page opens (a transform), and with reduced motion they are simply there.
 */
import { ArrowRight, MapPinned, Target } from 'lucide-react'
import { m } from 'motion/react'
import { Link } from 'react-router'
import { useLeadFacets, useLeads, useRuns } from '@/api/hooks'
import type { LeadResult, LeadRow } from '@/api/types'
import { ResultBadge } from '@/components/result-badge'
import { RollingNumber, springs, useStill } from '@/components/motion'
import { PendingText, SkeletonLines } from '@/components/skeletons'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatDate, formatNumber, formatRelative, pluralise } from '@/lib/format'
import { RESULT_ORDER, resultLabel } from '@/lib/labels'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { TONE_CLASSES } from '@/shell/tone'
import { goodLine, runLine, topSigns, whereWords } from './home-words'
import { LAST_RUN, TOP_LEADS } from './prefetch'

const TITLE_ID = 'home-lead-finder'

/** The fill of each result's part of the bar: the result colours, and Drop as a grey outline. */
const SEGMENT: Record<LeadResult, string> = {
  pass: 'bg-pass',
  director_review: 'bg-review',
  watch: 'bg-watch',
  drop: 'border border-input bg-transparent',
}

function Quiet({ children }: { children: string }) {
  return <p className="text-ui text-muted-foreground">{children}</p>
}

/** A bar that grows from its start once, when the page opens. */
function Grow({
  className,
  index = 0,
  axis = 'x',
}: {
  className: string
  index?: number
  axis?: 'x' | 'y'
}) {
  const still = useStill()
  const scale = axis === 'x' ? 'scaleX' : 'scaleY'
  return (
    <m.span
      aria-hidden="true"
      className={cn('block', className)}
      style={{ transformOrigin: axis === 'x' ? 'left' : 'bottom' }}
      initial={still ? false : { [scale]: 0 }}
      animate={{ [scale]: 1 }}
      transition={{ ...springs.smooth, delay: Math.min(index, 8) * 0.04 }}
    />
  )
}

/** The count of good leads, the results bar and its legend. */
function Leads() {
  const facets = useLeadFacets()
  if (facets.isPending) return <SkeletonLines count={3} className="max-w-sm" />
  if (facets.isError) return <Quiet>Can't load the leads right now.</Quiet>
  const counts = new Map(facets.data.result.map((facet) => [facet.value, facet.count]))
  const total = facets.data.result.reduce((sum, facet) => sum + facet.count, 0)
  if (total === 0) {
    return (
      <div className="flex flex-col gap-1">
        <p className="font-serif text-section text-foreground">No leads yet.</p>
        <p className="text-ui text-muted-foreground">Start a run to find companies to call.</p>
      </div>
    )
  }
  const good = (counts.get('pass') ?? 0) + (counts.get('director_review') ?? 0)
  const shown = RESULT_ORDER.filter((result) => (counts.get(result) ?? 0) > 0)
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end gap-4">
        <Link
          to="/results?result=pass&result=director_review"
          aria-label={`${pluralise(good, 'good lead')}: open them in Results`}
          className="rounded-md text-figure text-foreground hover:text-muted-foreground"
        >
          <RollingNumber value={good} />
        </Link>
        <div className="flex min-w-0 flex-col gap-0.5 pb-1">
          <p className="text-section font-semibold text-foreground">
            {good === 1 ? 'good lead' : 'good leads'}
          </p>
          <p className="text-ui text-muted-foreground">{goodLine(counts, total)}</p>
        </div>
      </div>
      <div
        role="img"
        aria-label={`All ${pluralise(total, 'lead')} by result: ${shown
          .map((result) => `${resultLabel(result)} ${formatNumber(counts.get(result) ?? 0)}`)
          .join(', ')}.`}
        className="flex h-2.5 w-full gap-0.5"
      >
        {shown.map((result, index) => (
          <span
            key={result}
            className="block min-w-1.5"
            style={{ flexGrow: counts.get(result) ?? 0, flexBasis: 0 }}
          >
            <Grow index={index} className={cn('h-full rounded-xs', SEGMENT[result])} />
          </span>
        ))}
      </div>
      <ul aria-label="Leads by result" className="grid w-fit grid-cols-2 gap-x-6 gap-y-2">
        {shown.map((result) => {
          const count = counts.get(result) ?? 0
          return (
            <li key={result}>
              <Link
                to={`/results?result=${result}`}
                aria-label={`${resultLabel(result)}: ${pluralise(count, 'lead')}`}
                className="inline-flex items-center gap-1.5 rounded-md transition-opacity duration-150 hover:opacity-80"
              >
                <ResultBadge result={result} />
                <span className="font-semibold text-foreground tabular-nums">
                  {formatNumber(count)}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** The signs most leads show, as short bars. */
function Signs() {
  const facets = useLeadFacets()
  if (facets.isPending) return <SkeletonLines count={4} />
  if (facets.isError) return null
  const signs = topSigns(facets.data.trigger)
  const total = facets.data.result.reduce((sum, facet) => sum + facet.count, 0)
  if (signs.length === 0) return null
  const most = signs[0]?.count ?? 1
  return (
    <section aria-labelledby="home-signs" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="home-signs" className="text-ui font-semibold text-foreground">
          Signs seen most
        </h3>
        <span className="text-caption text-muted-foreground">
          across {pluralise(total, 'lead')}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {signs.map((sign, index) => (
          <li key={sign.id}>
            <Link
              to={`/results?trigger=${encodeURIComponent(sign.id)}`}
              aria-label={`${sign.label}: ${pluralise(sign.count, 'lead')}`}
              className="group/sign -mx-2 flex flex-col gap-1.5 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-muted"
            >
              <span className="flex items-baseline justify-between gap-3 text-ui">
                <span className="truncate text-foreground" title={sign.label}>
                  {sign.label}
                </span>
                <span className="font-semibold text-foreground tabular-nums">
                  {formatNumber(sign.count)}
                </span>
              </span>
              <span className="block h-1.5 w-full overflow-hidden rounded-xs bg-muted">
                <span
                  className="block h-full"
                  style={{ width: `${String(Math.max(4, (sign.count / most) * 100))}%` }}
                >
                  <Grow
                    index={index}
                    className={cn(
                      'h-full rounded-xs',
                      index === 0 ? 'bg-chart-1' : 'bg-muted-foreground opacity-70',
                    )}
                  />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** "Merger or acquisition, 3 Nov", or the reason when the lead has no sign. */
function whyNow(lead: LeadRow): string {
  if (lead.trigger_label) {
    return lead.trigger_date
      ? `${lead.trigger_label}, ${formatDate(lead.trigger_date)}`
      : lead.trigger_label
  }
  return lead.reason
}

/** The best good leads nobody has acted on yet. */
function StartWith() {
  const leads = useLeads(TOP_LEADS)
  if (leads.isPending) return <SkeletonLines count={3} />
  if (leads.isError) return <Quiet>Can't load the best leads right now.</Quiet>
  const items = leads.data.items
  return (
    <section aria-labelledby="home-start-with" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="home-start-with" className="text-ui font-semibold text-foreground">
          Start with these
        </h3>
        <span className="text-caption text-muted-foreground">
          {items.length > 0 ? 'Best scores, not acted on yet' : null}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="font-serif text-ui text-muted-foreground">
          Every good lead has been looked at. New ones show here after the next run.
        </p>
      ) : (
        <ol className="flex flex-col divide-y rounded-lg border">
          {items.map((lead) => (
            <li key={lead.id}>
              <Link
                to={`/leads/${lead.id}`}
                className="flex items-center gap-3 px-3 py-2.5 transition-colors duration-150 first:rounded-t-lg last:rounded-b-lg hover:bg-muted focus-visible:-outline-offset-2"
              >
                <span
                  aria-label={`Score ${String(lead.score)}`}
                  className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-ui font-semibold text-foreground tabular-nums"
                >
                  {lead.score}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-semibold text-foreground">
                    {lead.company}
                    {lead.city ? (
                      <span className="font-normal text-muted-foreground"> · {lead.city}</span>
                    ) : null}
                  </span>
                  <span className="truncate text-caption text-muted-foreground">
                    {whyNow(lead)}
                  </span>
                </span>
                <ResultBadge result={lead.result} className="hidden sm:inline-flex" />
                <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/** The newest run in one line, and the main button. */
function LastRun() {
  const runs = useRuns(LAST_RUN)
  const last = runs.data?.items.at(0)
  const where = last ? whereWords(last) : ''
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t px-6 py-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-ui">
        <span className="text-muted-foreground">Last run</span>
        {runs.isPending ? (
          <PendingText className="w-40" />
        ) : runs.isError ? (
          <span className="text-muted-foreground">Can't load the runs right now.</span>
        ) : !last ? (
          <span className="text-muted-foreground">None yet</span>
        ) : (
          <>
            <Link
              to={`/runs/${last.id}`}
              className="font-semibold text-foreground underline underline-offset-4 hover:text-muted-foreground"
            >
              {formatRelative(last.created_at)}
            </Link>
            <StatusBadge status={last.status} />
            {where ? <span className="text-muted-foreground">{where}</span> : null}
            <span className="text-muted-foreground tabular-nums">{formatMoney(last.cost_usd)}</span>
          </>
        )}
      </div>
      <Button asChild>
        <Link to="/start">
          <MapPinned aria-hidden="true" />
          Start a run
        </Link>
      </Button>
    </div>
  )
}

export function LeadFinderHomeCard() {
  return (
    <Card role="region" aria-labelledby={TITLE_ID} className="h-full gap-0 py-0">
      <div className="flex items-start gap-3 px-6 pt-6">
        <span
          aria-hidden="true"
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg',
            TONE_CLASSES.lead.tile,
          )}
        >
          <Target className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id={TITLE_ID} className="text-section font-semibold text-foreground">
            Lead Finder
          </h2>
          <p className="text-ui text-muted-foreground">
            Companies that fit Contour and show signs of an office change.
          </p>
        </div>
        <Link
          to="/results"
          className="inline-flex shrink-0 items-center gap-1 rounded-sm text-ui text-link underline-offset-4 hover:underline"
        >
          Open results
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
      <div className="grid flex-1 grid-cols-1 gap-8 px-6 py-6 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Leads />
        <Signs />
      </div>
      <div className="px-6 pb-6">
        <StartWith />
      </div>
      <LastRun />
    </Card>
  )
}

/** The sentence under the greeting: what the newest run did. Nothing while it loads or fails. */
export function LeadFinderHomeLine() {
  const runs = useRuns(LAST_RUN)
  const last = runs.data?.items.at(0)
  if (runs.isPending || runs.isError) return null
  return <>{last ? runLine(last) : 'No runs yet. Start one to find leads.'}</>
}
