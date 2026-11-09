/**
 * Small parts of the call script on the prep card (PLAN-V10 F1): a source chip, a line's "why"
 * (its icon and where it comes from) and a line's text with its chips.
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
import type { PrepSource } from '@/api/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatDate } from '@/lib/format'
import { safeHref } from '@/lib/safe-href'
import { cn } from '@/lib/utils'
import { SourcesContext } from './guide-sources'
import type { GuideIcon, GuideLine } from './playbook'

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

/** A source id (F3, W1) with its label in a tooltip, and a link for a web page. */
export function SourceChip({ id, source }: { id: string; source: PrepSource | undefined }) {
  const href = safeHref(source?.url)
  const chip = (
    <span className="inline-flex h-5 items-center rounded-sm border border-input px-1 text-caption leading-none font-semibold text-muted-foreground tabular-nums">
      {id}
    </span>
  )
  const what = source
    ? `${source.label}${source.date ? `, ${formatDate(source.date)}` : ''}`
    : 'A source'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="rounded-sm transition-opacity hover:opacity-80"
          >
            {chip}
            <span className="sr-only">Source: {what}</span>
          </a>
        ) : (
          <span tabIndex={0} className="rounded-sm">
            {chip}
            <span className="sr-only">Source: {what}</span>
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent>{what}</TooltipContent>
    </Tooltip>
  )
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
