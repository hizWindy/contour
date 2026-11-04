/**
 * HubSpot parts any project can use (PLAN-V5 C2): the send preview, the "in HubSpot" badge, and
 * the connection state. A new project reuses these instead of building its own.
 */
export { useHubSpotStatus } from '@/api/hooks/hubspot'
export { InHubSpotBadge, type InHubSpotBadgeProps } from './in-hubspot-badge'
export { SendToHubSpotDialog, type SendToHubSpotDialogProps } from './send-to-hubspot-dialog'
