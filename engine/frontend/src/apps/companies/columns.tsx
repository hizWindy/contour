/**
 * The columns of the Companies table (PLAN-V13 T2-8). A sortable column's id is the API's sort
 * key, so the table's sort state and the address use the same word.
 *
 * The order follows HubSpot's own company list, so the team finds things where they expect:
 * Company name, Owner, Last activity, City, Industry, Staff, Next lease end, Deal. People with
 * the Lead Finder tick also see Source (HubSpot, Lead Finder or Both) and the newest result.
 * The name stays put when the table scrolls sideways. Pointing at a row shows "Prep a call" and
 * "Open in HubSpot" at its end. Everything else is one click away, in the panel.
 *
 * The name is a button: a click or Enter opens the panel, through the row's own click.
 */
import { createColumnHelper } from '@tanstack/react-table'
import type { CompanyRow } from '@/api/types'
import { ResultBadge } from '@/components/result-badge'
import { formatNumber, melbourneDate } from '@/lib/format'
import { CompanyCell } from './company-cell'
import { DealMark, LastTalk, LeaseEnd } from './marks'
import { RowActions, type RowActionHandlers } from './row-actions'
import { CompanySource } from './source'

const help = createColumnHelper<CompanyRow>()

const unknown = <span className="text-muted-foreground">Unknown</span>

export function companyColumns({
  leadsShown,
  today = melbourneDate(),
  handlers,
}: {
  leadsShown: boolean
  today?: string
  /** The row actions. Without them the actions column stays out. */
  handlers?: RowActionHandlers
}) {
  const columns = [
    help.accessor('name', {
      id: 'name',
      header: 'Company name',
      // The name stays in view while the other columns scroll sideways.
      meta: { sticky: true, className: 'max-w-72 sm:min-w-56' },
      cell: (info) => <CompanyCell row={info.row.original} />,
    }),
    help.accessor('owner', {
      header: 'Owner',
      enableSorting: false,
      meta: { hideBelow: 'md', className: 'whitespace-nowrap' },
      cell: (info) => info.getValue() ?? <span className="text-muted-foreground">No owner</span>,
    }),
    help.accessor('last_talk', {
      id: 'last_talk',
      header: 'Last activity',
      meta: { hideBelow: 'md', className: 'whitespace-nowrap' },
      cell: (info) => <LastTalk date={info.getValue()} today={today} />,
    }),
    help.accessor('city', {
      header: 'City',
      enableSorting: false,
      meta: { hideBelow: 'sm', className: 'whitespace-nowrap' },
      cell: (info) => info.getValue() ?? unknown,
    }),
    help.accessor('industry', {
      header: 'Industry',
      enableSorting: false,
      meta: { hideBelow: 'md', className: 'max-w-44 truncate' },
      cell: (info) => info.getValue() ?? unknown,
    }),
    help.accessor('staff', {
      id: 'staff',
      header: 'Staff',
      meta: { align: 'right', hideBelow: 'md', className: 'tabular-nums whitespace-nowrap' },
      cell: (info) => {
        const staff = info.getValue()
        return staff === null ? unknown : formatNumber(staff)
      },
    }),
    help.accessor('next_lease_end', {
      id: 'lease',
      header: 'Next lease end',
      meta: { hideBelow: 'md', className: 'whitespace-nowrap' },
      cell: (info) => <LeaseEnd date={info.getValue()} today={today} />,
    }),
    help.accessor('deal', {
      header: 'Deal',
      enableSorting: false,
      meta: { className: 'whitespace-nowrap' },
      cell: (info) => <DealMark deal={info.getValue()} />,
    }),
  ]
  const withLeads = !leadsShown
    ? columns
    : [
        ...columns,
        help.display({
          id: 'source',
          header: 'Source',
          meta: { hideBelow: 'md', className: 'whitespace-nowrap' },
          cell: (info) => <CompanySource row={info.row.original} />,
        }),
        help.accessor('lead_result', {
          header: 'Lead Finder',
          enableSorting: false,
          meta: { hideBelow: 'lg', className: 'whitespace-nowrap' },
          cell: (info) => {
            const result = info.getValue()
            const score = info.row.original.lead_score
            if (!result) {
              return <span className="text-muted-foreground">Not researched</span>
            }
            return (
              <span className="inline-flex items-center gap-2">
                <ResultBadge result={result} />
                {score === null ? null : (
                  <span className="text-caption text-muted-foreground tabular-nums">{score}</span>
                )}
              </span>
            )
          },
        }),
      ]
  if (!handlers) {
    return withLeads
  }
  return [
    ...withLeads,
    help.display({
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      // Zero width, stuck to the right edge: the actions float over the row's end when it is
      // pointed at, like HubSpot's preview button, and never push the other columns.
      meta: { hideBelow: 'md', className: 'sticky right-0 w-0 p-0' },
      cell: (info) => <RowActions row={info.row.original} handlers={handlers} />,
    }),
  ]
}
