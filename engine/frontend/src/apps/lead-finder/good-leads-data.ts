/**
 * Good leads and what each cost (PLAN-V9 D2): a good lead is a Pass or a Director review. Watch and
 * Drop are not counted. The run already keeps its counts by result and its cost, so this is free.
 */
import type { RunCounts } from '@/api/types'
import { moneyToString, parseMoney } from '@/lib/money'

const GOOD = ['pass', 'director_review'] as const
export const NO_GOOD_LEADS = 'no good leads yet'

export function goodLeads(counts: Pick<RunCounts, 'by_result'>): number {
  return GOOD.reduce((sum, result) => sum + (counts.by_result[result] ?? 0), 0)
}

/** The cost shared over the good leads, as a Decimal string, or null when there are none. */
export function costPerGoodLead(cost: string, good: number): string | null {
  const micros = parseMoney(cost)
  if (micros === null || good <= 0) {
    return null
  }
  const share = BigInt(good)
  return moneyToString((micros + share / 2n) / share)
}
