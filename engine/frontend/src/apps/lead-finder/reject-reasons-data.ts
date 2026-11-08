/** The reasons a lead is rejected (PLAN-V9 D1), in the order the dialog lists them. */
import type { LeadPatch } from '@/api/types'

export type RejectReason = NonNullable<LeadPatch['reject_reason']>

/** In the order the dialog lists them. "Other" is last and needs a note. */
export const REJECT_REASONS: readonly { id: RejectReason; label: string }[] = [
  { id: 'too_small', label: 'Too small' },
  { id: 'wrong_industry', label: 'Wrong industry' },
  { id: 'already_talking', label: 'Already talking to them' },
  { id: 'bad_timing', label: 'Bad timing' },
  { id: 'not_a_real_sign', label: 'Not a real sign' },
  { id: 'other', label: 'Other' },
]

export function rejectReasonLabel(reason: string | null | undefined): string {
  return REJECT_REASONS.find((item) => item.id === reason)?.label ?? reason ?? ''
}
