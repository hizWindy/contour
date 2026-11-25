/**
 * After this month's live voice limit (PLAN-V28 T4-1): a start refused with 429 `live_voice_limit`,
 * or a talk that ended at the limit, keeps live voice off until the month changes. Every other
 * fallback lets the next V try live voice again.
 *
 * - **Until when:** the server's `Retry-After` where it gave one (a refused start), else the next
 *   month's first moment in Melbourne (a talk that ended at the limit; Melbourne months, TBC as on
 *   the server).
 * - **Kept in this page only.** A reload tries once more, and the server says no again with its
 *   `Retry-After`: one cheap refusal, never a cost.
 */
import { melbourneDate } from '@/lib/format'

let offUntil = 0

/** Live voice is held off now: the month's limit was reached. */
export function liveHeldOff(now: number = Date.now()): boolean {
  return now < offUntil
}

/** Holds live voice off until `until` (ms since 1970). */
export function holdLiveOff(until: number): void {
  offUntil = Math.max(offUntil, until)
}

/** For tests, and a month that changed: live voice may start again. */
export function letLiveBack(): void {
  offUntil = 0
}

const HOUR = 3_600_000

/**
 * The next month's first moment in Melbourne, after `now`: midnight on the 1st, at UTC+11 in
 * summer or +10 in winter, whichever Melbourne keeps that night.
 */
export function melbourneMonthEnd(now: number = Date.now()): number {
  const [year = 1970, month = 1] = melbourneDate(now).split('-').map(Number)
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const first = `${String(nextYear)}-${String(nextMonth).padStart(2, '0')}-01`
  const midnightUtc = Date.UTC(nextYear, nextMonth - 1, 1)
  for (const offset of [11, 10]) {
    const at = midnightUtc - offset * HOUR
    // That moment is the 1st in Melbourne, and the moment before it is still the old month.
    if (melbourneDate(at) === first && melbourneDate(at - 1) !== first) return at
  }
  return midnightUtc - 10 * HOUR
}
