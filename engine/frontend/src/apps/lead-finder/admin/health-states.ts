/**
 * How Admin's Health tab shows each state, and the order of its rows (PLAN-V13 T1-6). Kept apart
 * from the page so the page file exports only the page.
 */
import { CircleCheck, CircleMinus, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { ApiTraffic, HealthState, SystemCheck } from '@/api/types'
import { formatNumber, pluralise } from '@/lib/format'

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

/**
 * The API card's first line: the requests, how many failed, and how many the backend answered
 * "not ready" (503) on purpose, like the run engine during a deploy. A 503 isn't a failure.
 */
export function apiSummary(api: ApiTraffic): string {
  const parts = [
    pluralise(api.requests, 'request'),
    api.errors === 0 ? 'none failed' : `${formatNumber(api.errors)} failed`,
  ]
  if (api.unavailable > 0) {
    parts.push(`${formatNumber(api.unavailable)} not ready (503)`)
  }
  return `${parts.join(', ')}.`
}
