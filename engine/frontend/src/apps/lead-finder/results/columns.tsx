/**
 * The columns of the results table, and the shorter list beside the map. A sortable column's id is
 * the API's sort key, so the table's sort state and the address use the same word.
 *
 * The table shows what tells leads apart at a glance (PLAN-V6, E1): the company and where it came
 * from, the tier (PLAN-V16 T3-5), the result, the score, the best sign and its date, the city, the
 * HubSpot label with its owner, and when it was researched. Everything else is one click away, on
 * the lead card. On a phone the rows show the company and the tier, or the result for a lead with
 * no tier yet (PLAN-V21 T3-5).
 *
 * The company name is a button: a click or Enter opens the lead card, through the row's own click.
 *
 * On the review page (Results for one run, PLAN-V9 C3) and for the bulk add to HubSpot (PLAN-V27
 * T3-2) the Company column also has a tick box for each lead (`tableColumns(mode)`). The boxes
 * read the ticks from `TickContext`, so these columns stay the same objects as leads are ticked.
 * The review page's box for the whole page is in its bar. The bulk add's sits in the Company
 * header, beside (never inside) the sort button.
 */
import { createColumnHelper } from '@tanstack/react-table'
import type { LeadRow } from '@/api/types'
import { HubSpotBadge } from '@/components/hubspot-badge'
import { ResultBadge } from '@/components/result-badge'
import { TierMark } from '@/components/tier-mark'
import { formatDate, formatScore, UNKNOWN } from '@/lib/format'
import { isTier } from '@/lib/labels'
import { CompanyName, HeaderTick, RowTick, type Tick } from './company-cell'

export type { Tick }

/** Which tick boxes the Company column has: none, the review page's, or the bulk add's. */
export type TickMode = 'none' | 'review' | 'send'

const help = createColumnHelper<LeadRow>()

function companyColumn(mode: TickMode) {
  return help.accessor('company', {
    header: 'Company',
    // The name stays in view while the other columns scroll sideways. On a phone it gives up some
    // width, so a long result like "Director review" fits beside it (PLAN-V21 T3-6).
    meta: {
      sticky: true,
      className: 'max-w-52 sm:max-w-64 sm:min-w-44',
      headStart: mode === 'send' ? <HeaderTick /> : undefined,
    },
    cell: (info) => {
      const {
        id,
        score,
        score_checked: checked,
        city,
        is_test: isTest,
        origin,
        status,
      } = info.row.original
      const points = formatScore(score, checked)
      const name = info.getValue()
      return (
        <span className="flex min-w-0 items-start gap-3">
          {mode === 'none' ? null : <RowTick id={id} name={name} sent={status === 'sent'} />}
          <CompanyName name={name} points={points} city={city} isTest={isTest} origin={origin} />
        </span>
      )
    },
  })
}

const company = companyColumn('none')
const reviewCompany = companyColumn('review')
const sendCompany = companyColumn('send')

/**
 * The tier, in words: the headline since PLAN-V16. The list is sorted by tier, then score. A lead
 * with no tier yet says so, and its result shows in the Result column. On a phone the Result
 * column is hidden (only the columns that tell rows apart), so there a lead with no tier shows its
 * result in this column instead (PLAN-V21 T3-5): each row still says it once.
 */
const tier = help.accessor('tier', {
  header: 'Tier',
  enableSorting: false,
  cell: (info) => {
    const value = info.getValue()
    if (isTier(value)) {
      return <TierMark tier={value} />
    }
    return (
      <>
        <span data-slot="phone-result" className="sm:hidden">
          <ResultBadge result={info.row.original.result} />
        </span>
        <TierMark tier={value} className="max-sm:hidden" />
      </>
    )
  },
})

const result = help.accessor('result', {
  header: 'Result',
  meta: { hideBelow: 'sm' },
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
export const TABLE_COLUMNS = [company, tier, result, score, sign, city, hubspot, researched]

/** The list beside the map: enough to tell the leads apart. */
export const LIST_COLUMNS = [company, tier, result, score, city]

const TICKED_TABLE = {
  review: [reviewCompany, tier, result, score, sign, city, hubspot, researched],
  send: [sendCompany, tier, result, score, sign, city, hubspot, researched],
}
const TICKED_LIST = {
  review: [reviewCompany, tier, result, score, city],
  send: [sendCompany, tier, result, score, city],
}

/** The full table, with tick boxes on the review page or for the bulk add. */
export function tableColumns(mode: TickMode = 'none') {
  return mode === 'none' ? TABLE_COLUMNS : TICKED_TABLE[mode]
}

/** The list beside the map, with tick boxes on the review page or for the bulk add. */
export function listColumns(mode: TickMode = 'none') {
  return mode === 'none' ? LIST_COLUMNS : TICKED_LIST[mode]
}
