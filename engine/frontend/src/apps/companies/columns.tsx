/**
 * The columns of the Companies table. A sortable column's id is the API's sort key, so the
 * table's sort state and the address use the same word.
 *
 * The table shows what tells companies apart at a glance: the name with its website and industry,
 * the city, staff, the next lease end, the last talk, the deal and the owner. People with the Lead
 * Finder tick also see its newest result. Everything else is one click away, in the panel.
 *
 * The name is a button: a click or Enter opens the panel, through the row's own click.
 */
import { createColumnHelper } from '@tanstack/react-table'
import type { CompanyRow } from '@/api/types'
import { ResultBadge } from '@/components/result-badge'
import { formatNumber, melbourneDate } from '@/lib/format'
import { CompanyCell } from './company-cell'
import { DealMark, LastTalk, LeaseEnd } from './marks'

const help = createColumnHelper<CompanyRow>()

export function companyColumns({
  leadsShown,
  today = melbourneDate(),
}: {
  leadsShown: boolean
  today?: string
}) {
  const columns = [
    help.accessor('name', {
      id: 'name',
      header: 'Company',
      // The name stays in view while the other columns scroll sideways.
      meta: { sticky: true, className: 'max-w-72 sm:min-w-56' },
      cell: (info) => <CompanyCell row={info.row.original} />,
    }),
    help.accessor('city', {
      header: 'City',
      enableSorting: false,
      meta: { hideBelow: 'sm', className: 'whitespace-nowrap' },
      cell: (info) => info.getValue() ?? <span className="text-muted-foreground">Unknown</span>,
    }),
    help.accessor('staff', {
      id: 'staff',
      header: 'Staff',
      meta: { align: 'right', hideBelow: 'md', className: 'tabular-nums whitespace-nowrap' },
      cell: (info) => {
        const staff = info.getValue()
        return staff === null ? (
          <span className="text-muted-foreground">Unknown</span>
        ) : (
          formatNumber(staff)
        )
      },
    }),
    help.accessor('next_lease_end', {
      id: 'lease',
      header: 'Next lease end',
      meta: { hideBelow: 'md', className: 'whitespace-nowrap' },
      cell: (info) => <LeaseEnd date={info.getValue()} today={today} />,
    }),
    help.accessor('last_talk', {
      id: 'last_talk',
      header: 'Last talk',
      meta: { hideBelow: 'md', className: 'whitespace-nowrap' },
      cell: (info) => <LastTalk date={info.getValue()} today={today} />,
    }),
    help.accessor('deal', {
      header: 'Deal',
      enableSorting: false,
      meta: { className: 'whitespace-nowrap' },
      cell: (info) => <DealMark deal={info.getValue()} />,
    }),
    help.accessor('owner', {
      header: 'Owner',
      enableSorting: false,
      meta: { hideBelow: 'md', className: 'whitespace-nowrap' },
      cell: (info) => info.getValue() ?? <span className="text-muted-foreground">No owner</span>,
    }),
  ]
  if (!leadsShown) {
    return columns
  }
  return [
    ...columns,
    help.accessor('lead_result', {
      header: 'Lead Finder',
      enableSorting: false,
      meta: { hideBelow: 'md', className: 'whitespace-nowrap' },
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
}
