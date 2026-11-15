/**
 * Small parts of the call script on the prep card (PLAN-V10 F1): a line's "why" (its icon and
 * where it comes from) and a line's text with its source chips (`source-chip.tsx`).
 */
import {
  BadgeCheck,
  Building2,
  CalendarClock,
  Globe,
  Handshake,
  History,
  ListChecks,
  Newspaper,
  PhoneCall,
  Target,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useContext } from 'react'
import { cn } from '@/lib/utils'
import { SourcesContext } from './guide-sources'
import type { GuideIcon, GuideLine } from './playbook'
import { SourceChip } from './source-chip'

const GUIDE_ICONS: Record<GuideIcon, LucideIcon> = {
  call: PhoneCall,
  customer: BadgeCheck,
  deal: Handshake,
  lead: Target,
  lease: CalendarClock,
  news: Newspaper,
  office: Building2,
  people: Users,
  quiet: History,
  staff: TrendingUp,
  standard: ListChecks,
  web: Globe,
}

/** The icon for what a line is about, like a calendar for a lease. */
export function GuideIconMark({ icon, className }: { icon: GuideIcon; className?: string }) {
  const Icon = GUIDE_ICONS[icon]
  return <Icon aria-hidden="true" className={className} />
}

/** The chips of a line's sources (call prep's lines only). */
export function SourceChips({ ids }: { ids: string[] }) {
  const sources = useContext(SourcesContext)
  if (ids.length === 0) return null
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {ids.map((id) => (
        <SourceChip key={id} id={id} source={sources.get(id)} />
      ))}
    </span>
  )
}

/** A line's text, with its source chips after it. */
export function GuideText({ line }: { line: GuideLine }) {
  return (
    <>
      {line.text}
      {line.sources.length > 0 ? (
        <>
          {' '}
          <SourceChips ids={line.sources} />
        </>
      ) : null}
    </>
  )
}

/** Why a line is there: its icon and where it comes from, under it. */
export function GuideWhy({ line, className }: { line: GuideLine; className?: string }) {
  if (!line.why) return null
  const Icon = GUIDE_ICONS[line.icon]
  return (
    <p
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground',
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="truncate">{line.why}</span>
    </p>
  )
}
