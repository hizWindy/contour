import type { LeadOrigin } from '@/api/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { humanise } from '@/lib/format'
import { ORIGIN_HINTS, ORIGIN_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { ORIGIN_ICONS } from './badge-meta'

export interface SourceMarkProps {
  /** `hubspot`, `web` or `typed`. Another value is shown as plain words. */
  origin: LeadOrigin | (string & {})
  className?: string
}

function isOrigin(value: string): value is LeadOrigin {
  return value in ORIGIN_LABELS
}

/**
 * Where a company came from (PLAN-V6, E2): an icon and a word, From HubSpot, Found or Typed, with a
 * tooltip that says what it means. Quiet text, not a badge, so the result and the HubSpot label
 * stay the loudest things on a row. The word carries the meaning; the tooltip only adds to it.
 */
export function SourceMark({ origin, className }: SourceMarkProps) {
  const known = isOrigin(origin)
  const Icon = known ? ORIGIN_ICONS[origin] : null
  const label = known ? ORIGIN_LABELS[origin] : humanise(origin)
  const mark = (
    <span
      data-origin={origin}
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1 text-caption whitespace-nowrap text-muted-foreground',
        className,
      )}
    >
      {Icon ? <Icon aria-hidden="true" className="size-3.5" /> : null}
      {label}
    </span>
  )
  if (!known) {
    return mark
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>{mark}</TooltipTrigger>
      <TooltipContent>{ORIGIN_HINTS[origin]}</TooltipContent>
    </Tooltip>
  )
}
