import type { HubSpotStatus } from '@/api/types'
import { HubSpotBadge } from '@/components/hubspot-badge'
import { SourceLink } from '@/components/source-link'
import { cn } from '@/lib/utils'

export interface InHubSpotBadgeProps {
  /** `new`, `in_hubspot`, `open_deal`, `dissolved_deal` or `possible_match`. */
  status: HubSpotStatus
  /** The company's name in HubSpot, when it is known. */
  name?: string | null
  /** Who owns it in HubSpot. */
  owner?: string | null
  /** The record's page in HubSpot. Only an https address becomes a link. */
  href?: string | null
  className?: string
}

/**
 * Where a company stands in HubSpot, for any project: the label, the name, the owner and a link
 * to the record. The label always has an icon and a word.
 */
export function InHubSpotBadge({ status, name, owner, href, className }: InHubSpotBadgeProps) {
  return (
    <span
      data-slot="in-hubspot"
      className={cn('inline-flex flex-wrap items-center gap-x-3 gap-y-1', className)}
    >
      <HubSpotBadge status={status} />
      {name ? <span>{name}</span> : null}
      {owner ? <span className="text-muted-foreground">Owner: {owner}</span> : null}
      {href ? <SourceLink href={href} label="Open in HubSpot" /> : null}
    </span>
  )
}
