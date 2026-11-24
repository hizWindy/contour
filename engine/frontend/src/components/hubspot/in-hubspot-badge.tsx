import type { HubSpotStatus } from '@/api/types'
import { useOpensHubSpot } from '@/auth/hubspot-user'
import { HubSpotBadge } from '@/components/hubspot-badge'
import { SourceLink } from '@/components/source-link'
import { quietLabel } from '@/lib/labels'
import { cn } from '@/lib/utils'

export interface InHubSpotBadgeProps {
  /** `new`, `quiet`, `in_hubspot`, `open_deal`, `dissolved_deal` or `possible_match`. */
  status: HubSpotStatus
  /**
   * When someone last worked the company in HubSpot. Given (even as `null`), a quiet company's
   * label says it: "In HubSpot, quiet since March 2025", or "In HubSpot, never worked".
   */
  lastActivity?: string | null
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
 * to the record. The label always has an icon and a word. No link for someone with no HubSpot user
 * (PLAN-V23 T3-4).
 */
export function InHubSpotBadge({
  status,
  lastActivity,
  name,
  owner,
  href,
  className,
}: InHubSpotBadgeProps) {
  const opens = useOpensHubSpot()
  const label =
    status === 'quiet' && lastActivity !== undefined ? quietLabel(lastActivity) : undefined
  return (
    <span
      data-slot="in-hubspot"
      className={cn('inline-flex flex-wrap items-center gap-x-3 gap-y-1', className)}
    >
      <HubSpotBadge status={status} label={label} />
      {name ? <span>{name}</span> : null}
      {owner ? <span className="text-muted-foreground">Owner: {owner}</span> : null}
      {href && opens ? <SourceLink href={href} label="Open in HubSpot" /> : null}
    </span>
  )
}
