/**
 * The details of one run, under its live progress:
 *
 * - `RunSetupCard`: what the run was asked to do (kind, cities and areas, signs, how far back,
 *   limits), when it ran and for how long, and the rules and prompt versions it used.
 * - `RunCostSplit`: where the money went: finding companies vs researching them, and the average
 *   per company researched. Read from the run's search log.
 * - `RunLeads`: every company the run researched, as Levi's section 9 lists them (PLAN-V16
 *   T3-3): the ranked leads (Tier A and B, best first), then the excluded ones with each reason,
 *   then the watch list (Tier C), and then the ones that scored under 40. Each opens its lead
 *   card. None is hidden: before PLAN-V20 the last group was only counted, so a run of weak
 *   companies looked empty.
 * - `FunnelLine`: sweeps, searches, finds, companies after merging, chosen, and how many the HubSpot
 *   top up added, in one line. In a discovery run, a company the top up added says "From HubSpot"
 *   under its name in the tables (PLAN-V21 T3-4).
 */
import { EVERY_TIER } from '@/lib/labels'
import { createColumnHelper } from '@tanstack/react-table'
import { useNavigate } from 'react-router'
import { useLeads, useRunOptions, useSearches } from '@/api/hooks'
import type { LeadRow, Run, RunCounts } from '@/api/types'
import { DataTable, type DataTableProps } from '@/components/data-table'
import { Money } from '@/components/money'
import { ResultBadge } from '@/components/result-badge'
import { SourceMark } from '@/components/source-mark'
import { TierMark } from '@/components/tier-mark'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatNumber, pluralise } from '@/lib/format'
import { costSplit, logIsPartial, setupLines, timingLines, type DetailLine } from './details-data'
import { groupRunLeads } from './goal-data'

const LOG_LIMIT = 200

function Lines({ lines, label }: { lines: DetailLine[]; label: string }) {
  return (
    <dl aria-label={label} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-ui">
      {lines.map((line) => (
        <div key={line.label} className="contents">
          <dt className="text-muted-foreground">{line.label}</dt>
          <dd className="min-w-0 break-words">{line.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function RunSetupCard({ run, className }: { run: Run; className?: string }) {
  const options = useRunOptions()
  const triggers = new Map((options.data?.triggers ?? []).map((item) => [item.id, item.label]))
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-section font-semibold">What it looked for</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Lines label="What the run was asked to do" lines={setupLines(run, { triggers })} />
        <Lines label="When it ran" lines={timingLines(run)} />
        <p className="text-caption break-words text-muted-foreground">
          Rules version {run.rules_version}. Prompts: {run.prompt_versions}.
        </p>
      </CardContent>
    </Card>
  )
}

export function RunCostSplit({ runId, researched }: { runId: string; researched: number }) {
  const log = useSearches({ run_id: runId, limit: LOG_LIMIT })
  if (!log.data || log.data.items.length === 0) {
    return null
  }
  const split = costSplit(log.data.items, researched)
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <dl
        aria-label="Where the money went"
        className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-ui"
      >
        <dt className="text-muted-foreground">
          Finding companies ({pluralise(split.findingRequests, 'request')})
        </dt>
        <dd className="text-right">
          <Money value={split.finding} />
        </dd>
        <dt className="text-muted-foreground">
          Researching ({pluralise(split.researchingRequests, 'request')})
        </dt>
        <dd className="text-right">
          <Money value={split.researching} />
        </dd>
        {split.perCompany !== null ? (
          <>
            <dt className="text-muted-foreground">Per company researched</dt>
            <dd className="text-right">
              <Money value={split.perCompany} />
            </dd>
          </>
        ) : null}
      </dl>
      {logIsPartial(log.data.items, log.data.total) ? (
        <p className="text-caption text-muted-foreground">
          From the first {formatNumber(LOG_LIMIT)} of {formatNumber(log.data.total)} requests.
        </p>
      ) : null}
    </div>
  )
}

const help = createColumnHelper<LeadRow>()

/**
 * The company's name, which opens its card. In a discovery run, a company the HubSpot top up added
 * says "From HubSpot" under its name (PLAN-V21 T3-4). In a watchlist run every company is from
 * HubSpot, so the mark would say nothing there.
 */
const companyColumn = (markTopUp: boolean) =>
  help.accessor('company', {
    header: 'Company',
    enableSorting: false,
    cell: (info) => (
      <span className="flex min-w-0 flex-col items-start">
        <button
          type="button"
          className="rounded-sm text-left font-semibold underline-offset-4 hover:underline"
        >
          {info.getValue()}
        </button>
        {markTopUp && info.row.original.origin === 'hubspot' ? (
          <SourceMark origin="hubspot" />
        ) : null}
      </span>
    ),
  })

const cityColumn = () =>
  help.accessor('city', {
    header: 'City',
    enableSorting: false,
    meta: { hideBelow: 'sm' },
    cell: (info) => info.getValue() ?? 'Unknown',
  })

const scoreColumn = () =>
  help.accessor('score', {
    header: 'Score',
    enableSorting: false,
    meta: { align: 'right', className: 'tabular-nums' },
  })

type Columns = DataTableProps<LeadRow>['columns']

const resultColumn = () =>
  help.accessor('result', {
    header: 'Result',
    enableSorting: false,
    meta: { hideBelow: 'sm' },
    cell: (info) => <ResultBadge result={info.getValue()} />,
  })

const tierColumn = () =>
  help.accessor('tier', {
    header: 'Tier',
    enableSorting: false,
    cell: (info) => <TierMark tier={info.getValue()} />,
  })

const costColumn = () =>
  help.accessor('cost_usd', {
    header: 'Cost',
    enableSorting: false,
    meta: { align: 'right', hideBelow: 'sm' },
    cell: (info) => <Money value={info.getValue()} />,
  })

const reasonColumn = () =>
  help.accessor((row) => row.excluded?.label ?? '', {
    id: 'reason',
    header: 'Why it was left out',
    enableSorting: false,
    // A reason can be long: it wraps instead of widening the table on a phone.
    meta: { className: 'min-w-40 whitespace-normal' },
  })

interface ColumnSets {
  ranked: Columns
  excluded: Columns
  watch: Columns
  underForty: Columns
}

/** The four tables' columns, with or without the top up's "From HubSpot" mark. */
function columnSets(markTopUp: boolean): ColumnSets {
  const company = companyColumn(markTopUp)
  return {
    ranked: [company, tierColumn(), scoreColumn(), resultColumn(), cityColumn(), costColumn()],
    excluded: [company, reasonColumn(), cityColumn()],
    watch: [company, scoreColumn(), cityColumn()],
    underForty: [company, scoreColumn(), resultColumn(), cityColumn()],
  }
}

const PLAIN_COLUMNS = columnSets(false)
const MARKED_COLUMNS = columnSets(true)

function LeadGroup({
  id,
  title,
  about,
  rows,
  columns,
  onOpen,
}: {
  id: string
  title: string
  about: string
  rows: LeadRow[]
  columns: Columns
  onOpen: (leadId: string) => void
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 id={id} className="text-ui font-semibold">
          {title}
        </h3>
        <span className="text-caption text-muted-foreground tabular-nums">
          {formatNumber(rows.length)}
        </span>
      </div>
      <p className="text-caption text-muted-foreground">{about}</p>
      <DataTable
        label={title}
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        compact
        onOpenRow={onOpen}
        empty={<span className="text-muted-foreground">None yet.</span>}
      />
    </section>
  )
}

export function RunLeads({
  runId,
  markTopUp = false,
  className,
}: {
  runId: string
  /** A discovery run: a company the HubSpot top up added says "From HubSpot". */
  markTopUp?: boolean
  className?: string
}) {
  const navigate = useNavigate()
  // Every tier: the run's Discards and excluded leads have groups of their own (PLAN-V20 S4)
  const leads = useLeads({
    run_id: runId,
    sort: 'score',
    order: 'desc',
    limit: 100,
    tier: [...EVERY_TIER],
  })
  const items = leads.data?.items ?? []
  const groups = groupRunLeads(items)
  const columns = markTopUp ? MARKED_COLUMNS : PLAIN_COLUMNS
  const open = (leadId: string): void => {
    void navigate(`/leads/${leadId}`)
  }
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-section font-semibold">Companies from this run</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {items.length === 0 ? (
          <DataTable
            label="Companies from this run"
            columns={columns.ranked}
            data={items}
            getRowId={(row) => row.id}
            compact
            loading={leads.isFetching}
            empty={<span className="text-muted-foreground">No company researched yet.</span>}
          />
        ) : (
          <>
            <LeadGroup
              id="run-ranked"
              title="Ranked leads"
              about="Tier A and B, best first: the good leads."
              rows={groups.ranked}
              columns={columns.ranked}
              onOpen={open}
            />
            {groups.excluded.length > 0 ? (
              <LeadGroup
                id="run-excluded"
                title="Excluded"
                about="Left out by the rules, each with its reason. Open one to override it."
                rows={groups.excluded}
                columns={columns.excluded}
                onOpen={open}
              />
            ) : null}
            {groups.watch.length > 0 ? (
              <LeadGroup
                id="run-watch"
                title="Watch"
                about="Tier C: watch for a new sign."
                rows={groups.watch}
                columns={columns.watch}
                onOpen={open}
              />
            ) : null}
            {groups.discarded.length > 0 ? (
              <LeadGroup
                id="run-discarded"
                title="Scored under 40"
                about="Not a fit for now, or too little is known. They are listed so every company the run researched is here."
                rows={groups.discarded}
                columns={columns.underForty}
                onOpen={open}
              />
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * "2 of 4 sweeps, 16 searches of 16, 17 finds, 13 companies after merging, 25 chosen to research,
 * 12 of them from the HubSpot watchlist." Only what the run did: the sweeps and the top up show
 * only for a run that had them (PLAN-V21).
 */
export function FunnelLine({ counts }: { counts: RunCounts }) {
  const parts: string[] = []
  if (counts.sweeps > 1) {
    parts.push(`${formatNumber(counts.sweeps_done)} of ${pluralise(counts.sweeps, 'sweep')}`)
  }
  if (counts.slices > 0) {
    parts.push(
      pluralise(counts.slices_done, 'search', 'searches') + ` of ${formatNumber(counts.slices)}`,
    )
    if (counts.slices_failed > 0) {
      parts.push(`${formatNumber(counts.slices_failed)} failed`)
    }
    parts.push(pluralise(counts.candidates, 'find'))
    parts.push(`${pluralise(counts.unique, 'company', 'companies')} after merging`)
  }
  if (counts.chosen > 0) {
    parts.push(`${formatNumber(counts.chosen)} chosen to research`)
  }
  if (counts.topped_up > 0) {
    parts.push(`${formatNumber(counts.topped_up)} of them from the HubSpot watchlist`)
  }
  if (parts.length === 0) {
    return null
  }
  return <p className="text-caption text-muted-foreground">{parts.join(', ')}.</p>
}
