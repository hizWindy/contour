/**
 * The numbers and the one step behind `FrequencyBars` (PLAN-V18 T3-4), in a file of their own so
 * the mic's code and the tests can use them. Plain code: no React.
 */

/** How many bars. */
export const BAR_COUNT = 24

/** At most this many draws a second. */
export const BAR_FPS = 30

/** The smallest a bar gets, as a share of its height: silence is still and low. */
export const BAR_FLOOR = 0.08

/** A band below this counts as silence, so the hum of a room doesn't make the bars twitch. */
export const BAR_GATE = 0.06

/** How far a bar goes toward its new level in one draw: up fast, down slower. */
const RISE = 0.65
const FALL = 0.3

/** A bar closer than this to where it should be is left where it is: it has settled. */
const SETTLED = 0.002

/** Reads the sound now into `levels`: one value per bar, from 0 (silence) to 1. */
export interface BarSource {
  read: (levels: Float32Array) => void
}

/** Where a bar should be for a level: the floor, then the rest of its height, after the gate. */
export function barTarget(level: number): number {
  const held = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0
  const voiced = held < BAR_GATE ? 0 : (held - BAR_GATE) / (1 - BAR_GATE)
  return BAR_FLOOR + (1 - BAR_FLOOR) * voiced
}

/**
 * One draw: moves each bar in `scales` toward its level, and returns which bars moved (their
 * index), so only those are written. A settled bar isn't in the list, so silence writes nothing.
 */
export function stepBars(scales: Float32Array, levels: Float32Array): number[] {
  const moved: number[] = []
  for (let bar = 0; bar < scales.length; bar += 1) {
    const now = scales[bar] ?? BAR_FLOOR
    const target = barTarget(levels[bar] ?? 0)
    const gap = target - now
    if (Math.abs(gap) < SETTLED) continue
    const next = now + gap * (gap > 0 ? RISE : FALL)
    scales[bar] = Math.abs(target - next) < SETTLED ? target : next
    moved.push(bar)
  }
  return moved
}
