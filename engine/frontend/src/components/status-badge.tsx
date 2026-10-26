import type { LeadStatus, RunStatus } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { humanise } from '@/lib/format'
import { LEAD_STATUS_LABELS, RUN_STATUS_LABELS } from '@/lib/labels'
import { LEAD_STATUS_META, RUN_STATUS_META, UNKNOWN_META, type BadgeMeta } from './badge-meta'

export interface StatusBadgeProps {
  /**
   * A lead status (`new`, `watching`, `rejected`, `sent`) or a run status (`queued`, `running`,
   * `done`, `failed`, `cancelled`, `interrupted`). Another value is shown as plain text.
   */
  status: LeadStatus | RunStatus | (string & {})
  className?: string
}

function lookup(status: string): { meta: BadgeMeta; label: string } {
  if (status in LEAD_STATUS_META) {
    return {
      meta: LEAD_STATUS_META[status as LeadStatus],
      label: LEAD_STATUS_LABELS[status as LeadStatus],
    }
  }
  if (status in RUN_STATUS_META) {
    return {
      meta: RUN_STATUS_META[status as RunStatus],
      label: RUN_STATUS_LABELS[status as RunStatus],
    }
  }
  return { meta: UNKNOWN_META, label: humanise(status) }
}

/**
 * The badge for the status of a lead or of a run: an icon and a word. A failed run is the only
 * one in the colour of an error. A run that is going shows a still dot, and nothing pulses.
 */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { meta, label } = lookup(status)
  const Icon = meta.icon
  return (
    <Badge variant={meta.variant} data-status={status} className={className}>
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  )
}
