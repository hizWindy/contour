/**
 * How Admin's Health tab shows each state, and the order of its rows (PLAN-V13 T1-6). Kept apart
 * from the page so the page file exports only the page.
 */
import { CircleCheck, CircleMinus, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { HealthState, SystemCheck } from '@/api/types'

/** How each state looks: an icon and a word, so colour is never the only signal. */
export const STATES: Record<
  HealthState,
  { label: string; icon: LucideIcon; variant: 'default' | 'outline' | 'destructive'; order: number }
> = {
  problem: { label: 'Problem', icon: TriangleAlert, variant: 'destructive', order: 0 },
  off: { label: 'Off', icon: CircleMinus, variant: 'outline', order: 1 },
  ok: { label: 'OK', icon: CircleCheck, variant: 'default', order: 2 },
}

/** The API table shows this many endpoints until "Show all". */
export const API_ROWS = 8

/** Problems first, then what is off, then what is fine; the backend's own order inside each. */
export function sortChecks(checks: readonly SystemCheck[]): SystemCheck[] {
  return checks
    .map((check, index) => ({ check, index }))
    .sort((a, b) => STATES[a.check.state].order - STATES[b.check.state].order || a.index - b.index)
    .map(({ check }) => check)
}
