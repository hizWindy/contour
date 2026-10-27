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
  cell: (info) => (
    <span className="flex items-center gap-2">
      <button
        type="button"
        className="rounded-sm text-left font-semibold underline-offset-4 hover:underline"
      >
        {info.getValue()}
      </button>
      {info.row.original.is_test ? <Badge variant="outline">Test set</Badge> : null}
    </span>
  ),
})

const result = help.accessor('result', {
  header: 'Result',
  cell: (info) => <ResultBadge result={info.getValue()} />,
})

const score = help.accessor('score', {
  header: 'Score',
  meta: { align: 'right', className: 'tabular-nums' },
})

const city = help.accessor('city', {
  header: 'City',
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
  cell: (info) => info.getValue() ?? UNKNOWN,
})

const office = help.accessor('office_m2', {
  header: 'Office',
  meta: { align: 'right', className: 'tabular-nums' },
  cell: (info) => formatM2(info.getValue(), info.row.original.office_m2_estimated),
})

const hubspot = help.accessor('hubspot_status', {
  header: 'HubSpot',
  cell: (info) => <HubSpotBadge status={info.getValue()} />,
})

const status = help.accessor('status', {
  header: 'Status',
  cell: (info) => <StatusBadge status={info.getValue()} />,
})

const researched = help.accessor('created_at', {
  header: 'Researched',
  cell: (info) => formatDate(info.getValue()),
})

const cost = help.accessor('cost_usd', {
  header: 'Cost',
  meta: { align: 'right' },
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
