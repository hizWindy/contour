/**
 * The columns of the results table, and the shorter list beside the map. A sortable column's id is
 * the API's sort key, so the table's sort state and the address use the same word.
 *
 * The company name is a button: a click or Enter opens the lead card, through the row's own click.
 */
import { createColumnHelper } from '@tanstack/react-table'
import type { LeadRow } from '@/api/types'
import { HubSpotBadge } from '@/components/hubspot-badge'
import { Money } from '@/components/money'
import { ResultBadge } from '@/components/result-badge'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { formatDate, formatM2, UNKNOWN } from '@/lib/format'

const help = createColumnHelper<LeadRow>()

const company = help.accessor('company', {
  header: 'Company',
  // The name stays in view while the other columns scroll sideways.
  meta: { sticky: true, className: 'max-w-64 sm:min-w-44' },
  cell: (info) => {
    const { score, city, is_test: isTest } = info.row.original
    return (
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2">
          <button
            type="button"
            className="min-w-0 truncate rounded-sm text-left font-semibold underline-offset-4 hover:underline"
          >
            {info.getValue()}
          </button>
          {isTest ? <Badge variant="outline">Test set</Badge> : null}
        </span>
        {/* On a phone the score and city columns are hidden, so they sit under the name. */}
        <span className="truncate text-caption text-muted-foreground sm:hidden">
          {city ? `Score ${String(score)}, ${city}` : `Score ${String(score)}`}
        </span>
      </span>
    )
  },
})

const result = help.accessor('result', {
  header: 'Result',
  cell: (info) => <ResultBadge result={info.getValue()} />,
})

const score = help.accessor('score', {
  header: 'Score',
  meta: { align: 'right', className: 'tabular-nums', hideBelow: 'sm' },
})

const city = help.accessor('city', {
  header: 'City',
  meta: { hideBelow: 'sm' },
  cell: (info) => {
    const { suburb } = info.row.original
    const place = info.getValue()
    if (!place) {
      return suburb ?? UNKNOWN
    }
    return suburb && suburb !== place ? `${suburb}, ${place}` : place
  },
})

const sign = help.accessor('trigger_date', {
  header: 'Sign',
  meta: { hideBelow: 'md' },
  cell: (info) => {
    const { trigger_label: label } = info.row.original
    const date = info.getValue()
    if (!label) {
      return <span className="text-muted-foreground">None found</span>
    }
    return date ? `${label}, ${formatDate(date)}` : label
  },
})

const industry = help.accessor('industry', {
  header: 'Industry',
  enableSorting: false,
  meta: { hideBelow: 'md' },
  cell: (info) => info.getValue() ?? UNKNOWN,
})

const office = help.accessor('office_m2', {
  header: 'Office',
  meta: { align: 'right', className: 'tabular-nums', hideBelow: 'md' },
  cell: (info) => formatM2(info.getValue(), info.row.original.office_m2_estimated),
})

const hubspot = help.accessor('hubspot_status', {
  header: 'HubSpot',
  meta: { hideBelow: 'md' },
  cell: (info) => <HubSpotBadge status={info.getValue()} />,
})

const status = help.accessor('status', {
  header: 'Status',
  meta: { hideBelow: 'md' },
  cell: (info) => <StatusBadge status={info.getValue()} />,
})

const researched = help.accessor('created_at', {
  header: 'Researched',
  meta: { hideBelow: 'md' },
  cell: (info) => formatDate(info.getValue()),
})

const cost = help.accessor('cost_usd', {
  header: 'Cost',
  meta: { align: 'right', hideBelow: 'md' },
  cell: (info) => <Money value={info.getValue()} />,
})

/** The full table. */
export const TABLE_COLUMNS = [
  company,
  result,
  score,
  city,
  sign,
  industry,
  office,
  hubspot,
  status,
  researched,
  cost,
]

/** The list beside the map: enough to tell the leads apart. */
export const LIST_COLUMNS = [company, result, score, city]
