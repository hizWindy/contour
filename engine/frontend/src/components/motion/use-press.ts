import { springs } from './springs'
import { useStill } from './use-still'

/** The press: a part shrinks to 0.98 while it is held, and springs back on release. */
export const PRESS_SCALE = 0.98

/**
 * Props for an `m.button` (or any `m.*` element) so a press feels physical (DESIGN.md "Motion").
 * Spread them: `<m.button {...usePress()} />`. With reduced motion there is no press. Hover never
 * grows or moves anything, and a CSS press class (a scale on the pressed state) is banned
 * (design-rules.ts): this is the one way to press.
 */
export function usePress(): { whileTap?: { scale: number }; transition?: typeof springs.soft } {
  const still = useStill()
  if (still) {
    return {}
  }
  return { whileTap: { scale: PRESS_SCALE }, transition: springs.soft }
}
