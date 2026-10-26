import type { LeadResult } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { isLeadResult, resultLabel } from '@/lib/labels'
import { RESULT_META, UNKNOWN_META } from './badge-meta'

export interface ResultBadgeProps {
  /** `pass`, `director_review`, `watch` or `drop`. Another value is shown as plain text. */
  result: LeadResult | (string & {})
  className?: string
}

/**
 * The one badge for a result, the same on every page: an icon, the word, and the colour of the
 * result (Olive, Ochre, Sand, or a grey outline). Never colour alone.
 */
export function ResultBadge({ result, className }: ResultBadgeProps) {
  const meta = isLeadResult(result) ? RESULT_META[result] : UNKNOWN_META
  const Icon = meta.icon
  return (
    <Badge variant={meta.variant} data-result={result} className={className}>
      <Icon aria-hidden="true" />
      {resultLabel(result)}
    </Badge>
  )
}
