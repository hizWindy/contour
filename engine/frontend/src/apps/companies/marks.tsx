/**
 * The Companies page's marks (PLAN-V10, "The design and motion bar"). Colour only where something
 * needs attention, and every status has an icon and words:
 *
 * - Ochre: a lease ending within 24 months, or no talk in 6 months (or none on record).
 * - A deal is a plain outline badge with an icon. Colour is saved for results.
 *
 * Dates are calendar dates from HubSpot (YYYY-MM-DD), compared with today in Melbourne.
 */
import {
  BadgeCheck,
  CircleDashed,
  CalendarClock,
  CalendarDays,
  CircleDot,
  CircleSlash,
  CircleX,
  Handshake,
  History,
  Minus,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react'
import type { CompanyDeal, DealState } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatDate, melbourneDate } from '@/lib/format'
import { agoWords, leaseSoon, talkStale, untilWords } from './dates'
import { cn } from '@/lib/utils'

/**
 * A date with its words under it, and an Ochre icon when it needs attention. `stacked` puts the
 * words on a second line (table cells); otherwise they follow the date.
 */
function DateMark({
  date,
  words,
  attention,
  attentionWords,
  icon: Icon,
  quietIcon: QuietIcon,
  stacked,
  className,
}: {
  date: string
  words: string
  attention: boolean
  /** What the Ochre mark means, for a screen reader and the tooltip. */
  attentionWords: string
  icon: LucideIcon
  quietIcon: LucideIcon
  stacked: boolean
  className?: string
}) {
  const Mark = attention ? Icon : QuietIcon
  return (
    <span className={cn('inline-flex items-start gap-1.5', className)}>
      <Mark
        aria-hidden="true"
        className={cn(
          'mt-0.5 size-4 shrink-0',
          attention ? 'text-review' : 'text-muted-foreground',
        )}
      />
      <span className={cn('flex min-w-0', stacked ? 'flex-col' : 'flex-wrap gap-x-1.5')}>
        <span className="tabular-nums">{formatDate(date)}</span>
        <span className="text-caption text-muted-foreground">
          {words}
          {attention ? <span className="sr-only">. {attentionWords}</span> : null}
        </span>
      </span>
    </span>
  )
}

export function LeaseEnd({
  date,
  stacked = true,
  today = melbourneDate(),
  className,
}: {
  date: string | null | undefined
  stacked?: boolean
  today?: string
  className?: string
}) {
  if (!date) {
    return <span className={cn('text-muted-foreground', className)}>None on record</span>
  }
  return (
    <DateMark
      date={date}
      words={untilWords(date, today)}
      attention={leaseSoon(date, today)}
      attentionWords="Ends within 24 months"
      icon={CalendarClock}
      quietIcon={CalendarDays}
      stacked={stacked}
      className={className}
    />
  )
}

export function LastTalk({
  date,
  stacked = true,
  today = melbourneDate(),
  className,
}: {
  date: string | null | undefined
  stacked?: boolean
  today?: string
  className?: string
}) {
  if (!date) {
    return (
      <span className={cn('inline-flex items-start gap-1.5', className)}>
        <History aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-review" />
        <span className="text-muted-foreground">None on record</span>
      </span>
    )
  }
  return (
    <DateMark
      date={date}
      words={agoWords(date, today)}
      attention={talkStale(date, today)}
      attentionWords="No talk in 6 months"
      icon={History}
      quietIcon={MessageSquare}
      stacked={stacked}
      className={className}
    />
  )
}

const DEAL_MARKS: Record<DealState, { label: string; icon: LucideIcon }> = {
  open: { label: 'Open deal', icon: Handshake },
  customer: { label: 'Customer', icon: BadgeCheck },
  none: { label: 'No deal', icon: Minus },
}

/** A company's deal on the list: an open deal, a customer, or none. */
export function DealMark({ deal, className }: { deal: DealState; className?: string }) {
  const { label, icon: Icon } = DEAL_MARKS[deal]
  if (deal === 'none') {
    return (
      <span
        data-deal={deal}
        className={cn('inline-flex items-center gap-1 text-muted-foreground', className)}
      >
        <Icon aria-hidden="true" className="size-3.5" />
        {label}
      </span>
    )
  }
  return (
    <Badge variant="outline" data-deal={deal} className={className}>
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  )
}

const STAGE_MARKS: Record<CompanyDeal['state'], { label: string; icon: LucideIcon }> = {
  open: { label: 'Open', icon: CircleDot },
  won: { label: 'Won', icon: BadgeCheck },
  lost: { label: 'Lost', icon: CircleX },
  dissolved: { label: 'Dissolved', icon: CircleSlash },
}

/** One deal's state on the panel: open, won, lost or dissolved. */
export function StageMark({ state }: { state: CompanyDeal['state'] }) {
  const { label, icon: Icon } = STAGE_MARKS[state]
  return (
    <Badge variant={state === 'open' || state === 'won' ? 'outline' : 'drop'} data-stage={state}>
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  )
}

/** The quiet mark for a lead the Lead Finder found that HubSpot doesn't have yet. */
export function NotInHubSpot() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex w-fit shrink-0 items-center gap-1 text-caption whitespace-nowrap text-muted-foreground">
          <CircleDashed aria-hidden="true" className="size-3.5" />
          Not in HubSpot yet
        </span>
      </TooltipTrigger>
      <TooltipContent>
        A good lead from the Lead Finder. It reaches HubSpot once sent.
      </TooltipContent>
    </Tooltip>
  )
}
