/**
 * The columns of the results table, and the shorter list beside the map. A sortable column's id is
 * the API's sort key, so the table's sort state and the address use the same word.
 *
 * The table shows what tells leads apart at a glance (PLAN-V6, E1): the company and where it came
 * from, the result, the score, the best sign and its date, the city, the HubSpot label with its
 * owner, and when it was researched. Everything else is one click away, on the lead card.
 *
 * The company name is a button: a click or Enter opens the lead card, through the row's own click.
 *
 * On the review page (Results for one run, PLAN-V9 C3) the Company column also has a tick box for
 * each lead (`tableColumns(tick)`). The box for the whole page is in the review bar, because the
 * Company header is a sort button.
 */
import { createColumnHelper } from '@tanstack/react-table'
import type { LeadRow } from '@/api/types'
import { HubSpotBadge } from '@/components/hubspot-badge'
import { ResultBadge } from '@/components/result-badge'
import { formatDate, formatScore, UNKNOWN } from '@/lib/format'
import { CompanyName, RowTick, type Tick } from './company-cell'

export type { Tick }

const help = createColumnHelper<LeadRow>()

function companyColumn(tick?: Tick) {
  return help.accessor('company', {
    header: 'Company',
    // The name stays in view while the other columns scroll sideways.
    meta: { sticky: true, className: 'max-w-64 sm:min-w-44' },
    cell: (info) => {
      const { id, score, score_checked: checked, city, is_test: isTest, origin } = info.row.original
      const points = formatScore(score, checked)
      const name = info.getValue()
      return (
        <span className="flex min-w-0 items-start gap-3">
          {tick ? <RowTick tick={tick} id={id} name={name} /> : null}
          <CompanyName name={name} points={points} city={city} isTest={isTest} origin={origin} />
        </span>
      )
    },
  })
}

const company = companyColumn()

const result = help.accessor('result', {
  header: 'Result',
  cell: (info) => <ResultBadge result={info.getValue()} />,
})

const score = help.accessor('score', {
  header: 'Score',
  meta: { align: 'right', className: 'tabular-nums whitespace-nowrap', hideBelow: 'sm' },
  cell: (info) => formatScore(info.getValue(), info.row.original.score_checked),
})

const sign = help.accessor('trigger_date', {
  header: 'Best sign',
  meta: { hideBelow: 'md', className: 'max-w-60' },
  cell: (info) => {
    const { trigger_label: label } = info.row.original
    const date = info.getValue()
    if (!label) {
      return <span className="text-muted-foreground">None found</span>
    }
    return (
      <span className="flex min-w-0 flex-col">
        <span className="truncate" title={label}>
          {label}
        </span>
        <span className="text-caption text-muted-foreground">
          {date ? formatDate(date) : 'Date not known'}
        </span>
      </span>
    )
  },
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

const hubspot = help.accessor('hubspot_status', {
  header: 'HubSpot',
  meta: { hideBelow: 'md' },
  cell: (info) => {
    const owner = info.row.original.hubspot_owner
    return (
      <span className="flex flex-col items-start gap-0.5">
        <HubSpotBadge status={info.getValue()} />
        {owner ? <span className="text-caption text-muted-foreground">Owner: {owner}</span> : null}
      </span>
    )
  },
})

const researched = help.accessor('created_at', {
  header: 'Researched',
  meta: { hideBelow: 'md', className: 'whitespace-nowrap' },
  cell: (info) => formatDate(info.getValue()),
})

/** The full table. */
export const TABLE_COLUMNS = [company, result, score, sign, city, hubspot, researched]

/** The list beside the map: enough to tell the leads apart. */
export const LIST_COLUMNS = [company, result, score, city]

/** The full table, with tick boxes on the review page. */
export function tableColumns(tick?: Tick) {
  return tick
    ? [companyColumn(tick), result, score, sign, city, hubspot, researched]
    : TABLE_COLUMNS
}

/** The list beside the map, with tick boxes on the review page. */
export function listColumns(tick?: Tick) {
  return tick ? [companyColumn(tick), result, score, city] : LIST_COLUMNS
}
