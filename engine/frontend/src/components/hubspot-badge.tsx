import type { HubSpotStatus } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { humanise } from '@/lib/format'
import { HUBSPOT_STATUS_LABELS } from '@/lib/labels'
import { HUBSPOT_STATUS_META, UNKNOWN_META, type BadgeMeta } from './badge-meta'

export interface HubSpotBadgeProps {
  /** `new`, `in_hubspot`, `open_deal`, `dissolved_deal` or `possible_match`. */
  status: HubSpotStatus | (string & {})
  className?: string
}

function isKnown(status: string): status is HubSpotStatus {
  return status in HUBSPOT_STATUS_META
}

/**
 * Whether HubSpot already has the company. A plain outline badge with an icon: colour is saved
 * for results.
 */
export function HubSpotBadge({ status, className }: HubSpotBadgeProps) {
  const meta: BadgeMeta = isKnown(status) ? HUBSPOT_STATUS_META[status] : UNKNOWN_META
  const label = isKnown(status) ? HUBSPOT_STATUS_LABELS[status] : humanise(status)
  const Icon = meta.icon
  return (
    <Badge variant={meta.variant} data-hubspot-status={status} className={className}>
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  )
}
