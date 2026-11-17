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
 * - `FunnelLine`: searches, finds, companies after merging, chosen, researched, in one line.
 */
import { createColumnHelper } from '@tanstack/react-table'
import { useNavigate } from 'react-router'
import { useLeads, useRunOptions, useSearches } from '@/api/hooks'
import type { LeadRow, Run, RunCounts } from '@/api/types'
import { DataTable, type DataTableProps } from '@/components/data-table'
import { Money } from '@/components/money'
import { ResultBadge } from '@/components/result-badge'
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

const companyColumn = () =>
  help.accessor('company', {
    header: 'Company',
    enableSorting: false,
    cell: (info) => (
      <button
        type="button"
        className="rounded-sm text-left font-semibold underline-offset-4 hover:underline"
      >
        {info.getValue()}
      </button>
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

const RANKED = [
  companyColumn(),
  help.accessor('tier', {
    header: 'Tier',
    enableSorting: false,
    cell: (info) => <TierMark tier={info.getValue()} />,
  }),
  scoreColumn(),
  resultColumn(),
  cityColumn(),
  help.accessor('cost_usd', {
    header: 'Cost',
    enableSorting: false,
    meta: { align: 'right', hideBelow: 'sm' },
    cell: (info) => <Money value={info.getValue()} />,
  }),
]

const EXCLUDED = [
  companyColumn(),
  help.accessor((row) => row.excluded?.label ?? '', {
    id: 'reason',
    header: 'Why it was left out',
    enableSorting: false,
    // A reason can be long: it wraps instead of widening the table on a phone.
    meta: { className: 'min-w-40 whitespace-normal' },
  }),
  cityColumn(),
]

const WATCH = [companyColumn(), scoreColumn(), cityColumn()]

const UNDER_FORTY = [companyColumn(), scoreColumn(), resultColumn(), cityColumn()]

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

export function RunLeads({ runId, className }: { runId: string; className?: string }) {
  const navigate = useNavigate()
  const leads = useLeads({ run_id: runId, sort: 'score', order: 'desc', limit: 100 })
  const items = leads.data?.items ?? []
  const groups = groupRunLeads(items)
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
            columns={RANKED}
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
              columns={RANKED}
              onOpen={open}
            />
            {groups.excluded.length > 0 ? (
              <LeadGroup
                id="run-excluded"
                title="Excluded"
                about="Left out by the rules, each with its reason. Open one to override it."
                rows={groups.excluded}
                columns={EXCLUDED}
                onOpen={open}
              />
            ) : null}
            {groups.watch.length > 0 ? (
              <LeadGroup
                id="run-watch"
                title="Watch"
                about="Tier C: watch for a new sign."
                rows={groups.watch}
                columns={WATCH}
                onOpen={open}
              />
            ) : null}
            {groups.discarded.length > 0 ? (
              <LeadGroup
                id="run-discarded"
                title="Scored under 40"
                about="Not a fit for now, or too little is known. They are listed so every company the run researched is here."
                rows={groups.discarded}
                columns={UNDER_FORTY}
                onOpen={open}
              />
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** "12 searches, 14 finds, 13 companies after merging, 13 chosen." Only what the run did. */
export function FunnelLine({ counts }: { counts: RunCounts }) {
  const parts: string[] = []
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
  if (parts.length === 0) {
    return null
  }
  return <p className="text-caption text-muted-foreground">{parts.join(', ')}.</p>
}
