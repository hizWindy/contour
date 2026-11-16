/**
 * The Companies list on a phone (PLAN-V10 G1): one card per company instead of the table, which on
 * a phone could show only the name and the deal. A card shows what a caller checks first: the name
 * and the deal, where it is, the next lease end and the last activity (in Ochre when they need
 * attention), and the owner. The cards come in the list's order: the newest activity first by
 * default (PLAN-V18 T2-6).
 *
 * - **A tap** opens the company. The touch that starts the tap already starts loading the
 *   company, so it opens filled.
 * - **Prep** sits at the card's bottom right, where a thumb reaches it, and opens call prep
 *   straight away, without opening the company first.
 * - **The card it came from** is marked with a Navy edge, so you keep your place.
 * - **Pages:** Previous and Next under the list, which scrolls back to its first card.
 * - **Motion:** a pressed card tints at once; the list dims while the next page loads (150 ms).
 * - **Source:** with the Lead Finder tick, each card says where the company came from
 *   (HubSpot, Lead Finder or Both), as the table's Source column does (PLAN-V13 T2-8).
 */
import { ChevronLeft, ChevronRight, CircleDashed, PhoneCall } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import type { CompanyRow } from '@/api/types'
import { ResultBadge } from '@/components/result-badge'
import { Pending } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { PREP_BUTTON } from './focus'
import { DealMark, LastActivity, LeaseEnd } from './marks'
import { CompanySource } from './source'
import { companyPlace } from './words'

function Card({
  row,
  active,
  leadsShown,
  today,
  onOpen,
  onIntent,
  onPrep,
}: {
  row: CompanyRow
  active: boolean
  leadsShown: boolean
  today: string
  onOpen: (key: string) => void
  onIntent: (key: string) => void
  onPrep?: (row: CompanyRow) => void
}) {
  const id = useId()
  const place = companyPlace(row)
  return (
    <li className="relative">
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
              <span className="text-caption text-muted-foreground">Last activity</span>
              <LastActivity date={row.last_activity} today={today} />
            </span>
          </span>
          <span
            className={cn(
              'flex flex-wrap items-center justify-between gap-2 text-caption text-muted-foreground',
              // Room for Prep, which sits over the card's bottom right.
              onPrep && 'min-h-8 pr-24',
            )}
          >
            {row.owner ? `Owner: ${row.owner}` : 'No owner'}
            {/* Where it came from (PLAN-V13 T2-8), for the Lead Finder tick. */}
            {leadsShown ? <CompanySource row={row} /> : null}
          </span>
        </span>
      </button>
      {onPrep ? (
        // Beside the card's button, not inside it: a button can't hold another one.
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="absolute right-3.5 bottom-3.5"
          aria-label={`Prep a call to ${row.name}`}
          {...{ [PREP_BUTTON]: row.key }}
          onPointerDown={() => {
            onIntent(row.key)
          }}
          onClick={() => {
            onPrep(row)
          }}
        >
          <PhoneCall aria-hidden="true" />
          Prep
        </Button>
      ) : null}
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
  /** "Prep" on a card: opens call prep. Without it, no button. */
  onPrep?: (row: CompanyRow) => void
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
  onPrep,
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
            onPrep={onPrep}
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
