/**
 * How a cost stands against its cap. DESIGN.md: Ochre when the cost is close to its cap,
 * Terracotta when it is over. "Close" is 80% or more of the cap.
 */
import { compareMoney, moneyPercent } from './money'

export type CostState = 'ok' | 'near' | 'over'

/** The share of the cap, in percent, from which a cost counts as close to it. */
export const NEAR_CAP_PERCENT = 80

export interface CostStanding {
  /** Cost as a share of the cap (two decimals). `null` when there is no usable cap. */
  percent: number | null
  state: CostState
}

/** Compares a cost with its cap, both Decimal strings. No cap (zero or missing) is `ok`. */
export function costStanding(
  cost: string | null | undefined,
  cap: string | null | undefined,
): CostStanding {
  const percent = moneyPercent(cost, cap)
  if (percent === null) {
    return { percent: null, state: 'ok' }
  }
  if (compareMoney(cost, cap) > 0) {
    return { percent, state: 'over' }
  }
  return { percent, state: percent >= NEAR_CAP_PERCENT ? 'near' : 'ok' }
}
