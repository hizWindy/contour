/**
 * The Companies list on a phone (PLAN-V10 G1): one card per company instead of the table, which on
 * a phone could show only the name and the deal. A card shows what a caller checks first: the name
 * and the deal, where it is, the next lease end and the last talk (in Ochre when they need
 * attention), and the owner.
 *
 * - **A tap** opens the company panel. The touch that starts the tap already starts loading the
 *   company, so the panel opens filled.
 * - **The card it came from** is marked with a Navy edge, so you keep your place.
 * - **Pages:** Previous and Next under the list, which scrolls back to its first card.
 * - **Motion:** a pressed card tints at once; the list dims while the next page loads (150 ms).
 */
import { ChevronLeft, ChevronRight, CircleDashed } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import type { CompanyRow } from '@/api/types'
import { ResultBadge } from '@/components/result-badge'
import { Pending } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { DealMark, LastTalk, LeaseEnd } from './marks'
import { companyPlace } from './words'

function Card({
  row,
  active,
  leadsShown,
  today,
  onOpen,
  onIntent,
}: {
  row: CompanyRow
  active: boolean
  leadsShown: boolean
  today: string
  onOpen: (key: string) => void
  onIntent: (key: string) => void
}) {
  const id = useId()
  const place = companyPlace(row)
  return (
    <li>
      <button
        type="button"
        data-row-id={row.key}
        aria-current={active || undefined}
        // A screen reader hears the name, then the deal and the rest as its description.
        aria-labelledby={`${id}-name`}
        aria-describedby={`${id}-deal ${id}-more`}
        onPointerDown={() => {
          onIntent(row.key)
        }}
        onClick={() => {
          onOpen(row.key)
        }}
        className={cn(
          'flex w-full flex-col gap-2.5 rounded-lg border bg-card p-3.5 text-left transition-colors active:bg-muted',
          active && 'border-l-2 border-l-primary bg-selected',
        )}
      >
        <span className="flex w-full items-start justify-between gap-3">
          <span id={`${id}-name`} className="min-w-0 flex-1 truncate text-body font-semibold">
            {row.name}
          </span>
          <span id={`${id}-deal`} className="shrink-0">
            {leadsShown && row.lead_result ? (
              <ResultBadge result={row.lead_result} />
            ) : (
              <DealMark deal={row.deal} />
            )}
          </span>
        </span>
        <span id={`${id}-more`} className="flex w-full flex-col gap-2.5">
          {row.source === 'lead' ? (
            <span className="inline-flex items-center gap-1 text-caption text-muted-foreground">
              <CircleDashed aria-hidden="true" className="size-3.5" />
              Not in HubSpot yet{place ? ` · ${place}` : ''}
            </span>
          ) : (
            <span className="truncate text-caption text-muted-foreground">
              {place || row.domain || 'No details on record'}
            </span>
          )}
          <span className="grid w-full grid-cols-2 gap-3 text-ui">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-caption text-muted-foreground">Next lease end</span>
              <LeaseEnd date={row.next_lease_end} today={today} />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-caption text-muted-foreground">Last talk</span>
              <LastTalk date={row.last_talk} today={today} />
            </span>
          </span>
          <span className="text-caption text-muted-foreground">
            {row.owner ? `Owner: ${row.owner}` : 'No owner'}
          </span>
        </span>
      </button>
    </li>
  )
}

function CardsPending() {
  return (
    <Pending label="Loading the companies.">
      <ul className="flex flex-col gap-2">
        {Array.from({ length: 6 }, (_, index) => (
          <li key={index} className="flex flex-col gap-3 rounded-lg border bg-card p-3.5">
            <span className="flex justify-between gap-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-5 w-20" />
            </span>
            <Skeleton className="h-3.5 w-48" />
            <span className="grid grid-cols-2 gap-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </span>
          </li>
        ))}
      </ul>
    </Pending>
  )
}

export interface CompanyCardsProps {
  rows: readonly CompanyRow[] | undefined
  total: number
  pageIndex: number
  pageSize: number
  /** The next page is on its way: the list dims. */
  loading: boolean
  leadsShown: boolean
  /** The company whose card to mark (the open one, or the last one opened). */
  activeKey: string | null
  today: string
  onOpen: (key: string) => void
  onIntent: (key: string) => void
  onPageChange: (index: number) => void
  empty: ReactNode
}

/** The list as cards, with Previous and Next under it. */
export function CompanyCards({
  rows,
  total,
  pageIndex,
  pageSize,
  loading,
  leadsShown,
  activeKey,
  today,
  onOpen,
  onIntent,
  onPageChange,
  empty,
}: CompanyCardsProps) {
  if (rows === undefined) return <CardsPending />
  if (rows.length === 0) return <div className="rounded-lg border bg-card">{empty}</div>
  const first = pageIndex * pageSize + 1
  const last = Math.min(total, (pageIndex + 1) * pageSize)
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1)
  return (
    <div className="flex flex-col gap-4">
      <ul
        aria-label="Companies"
        aria-busy={loading || undefined}
        className={cn('flex flex-col gap-2 transition-opacity', loading && 'opacity-60')}
      >
        {rows.map((row) => (
          <Card
            key={row.key}
            row={row}
            active={row.key === activeKey}
            leadsShown={leadsShown}
            today={today}
            onOpen={onOpen}
            onIntent={onIntent}
          />
        ))}
      </ul>
      <nav aria-label="Pages" className="flex flex-col gap-2">
        <p className="text-center text-caption text-muted-foreground" aria-live="polite">
          {`${formatNumber(first)} to ${formatNumber(last)} of ${formatNumber(total)}`}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={pageIndex <= 0}
            onClick={() => {
              onPageChange(pageIndex - 1)
            }}
          >
            <ChevronLeft aria-hidden="true" />
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pageIndex >= lastPage}
            onClick={() => {
              onPageChange(pageIndex + 1)
            }}
          >
            Next
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </nav>
    </div>
  )
}
