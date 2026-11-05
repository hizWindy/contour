/**
 * Where the Lead Finder stands, on its Home card: the last run (when, how it ended, what it cost)
 * and the leads by result. Each part links to the page with the detail, and a result opens
 * Results with only that result. If the backend can't be reached, it says so in one quiet line.
 */
import { Link } from 'react-router'
import { useLeadFacets, useRuns } from '@/api/hooks'
import { ResultBadge } from '@/components/result-badge'
import { PendingText } from '@/components/skeletons'
import { StatusBadge } from '@/components/status-badge'
import { formatNumber, formatRelative, pluralise } from '@/lib/format'
import { RESULT_ORDER, resultLabel } from '@/lib/labels'
import { formatMoney } from '@/lib/money'

function Quiet({ children }: { children: string }) {
  return <span className="text-muted-foreground">{children}</span>
}

function LastRun() {
  const runs = useRuns({ app: 'lead_finder', limit: 1 })
  if (runs.isPending) return <PendingText className="w-40" />
  if (runs.isError) return <Quiet>Can't load the runs right now.</Quiet>
  const last = runs.data.items.at(0)
  if (!last) return <Quiet>No runs yet. Start one to find leads.</Quiet>
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Link
        to={`/runs/${last.id}`}
        className="underline underline-offset-4 hover:text-muted-foreground"
      >
        {formatRelative(last.created_at)}
      </Link>
      <StatusBadge status={last.status} />
      <span className="text-muted-foreground tabular-nums">{formatMoney(last.cost_usd)}</span>
    </span>
  )
}

function Leads() {
  const facets = useLeadFacets()
  if (facets.isPending) return <PendingText className="w-56" />
  if (facets.isError) return <Quiet>Can't load the leads right now.</Quiet>
  const counts = new Map(facets.data.result.map((facet) => [facet.value, facet.count]))
  const total = facets.data.result.reduce((sum, facet) => sum + facet.count, 0)
  if (total === 0) return <Quiet>No leads yet.</Quiet>
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Link
        to="/results"
        className="font-semibold underline underline-offset-4 hover:text-muted-foreground"
      >
        {pluralise(total, 'lead')}
      </Link>
      {RESULT_ORDER.map((result) => {
        const count = counts.get(result) ?? 0
        return count > 0 ? (
          <Link
            key={result}
            to={`/results?result=${result}`}
            aria-label={`${resultLabel(result)}: ${pluralise(count, 'lead')}`}
            className="inline-flex items-center gap-1.5 rounded-md hover:opacity-80"
          >
            <ResultBadge result={result} />
            <span className="tabular-nums">{formatNumber(count)}</span>
          </Link>
        ) : null
      })}
    </span>
  )
}

export function LeadFinderSummary() {
  return (
    <dl className="grid grid-cols-[5.5rem_1fr] items-center gap-x-4 gap-y-3 text-ui">
      <dt className="text-caption text-muted-foreground">Last run</dt>
      <dd className="min-w-0">
        <LastRun />
      </dd>
      <dt className="text-caption text-muted-foreground">Leads</dt>
      <dd className="min-w-0">
        <Leads />
      </dd>
    </dl>
  )
}
