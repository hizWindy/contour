import { LazyMotion, MotionConfig } from 'motion/react'
import type { ReactNode } from 'react'
import { springs } from './springs'

/**
 * The root of all motion, around the app (main.tsx) and around every test render (test/render.tsx).
 *
 * `LazyMotion` loads `motion`'s features once, here, and loads them late: the first screen draws
 * with the small `m` components and no animation, and the features (about 25 kB gzipped) arrive
 * in a file of their own right after, so the main file stays small (PLAN-V7's speed work). A page
 * that animates then uses `m.*` and brings no features of its own. The features are `domMax`
 * (not `domAnimation`) because the sliding indicators (`Segmented`, `TabIndicator`) are layout
 * animations with `layoutId`, which the smaller set does not have. `strict` throws if a page uses
 * the full `motion.div` instead of `m.div`.
 *
 * `MotionConfig` follows the computer's reduced-motion setting: transforms and layout animations
 * are dropped for it. The kit's parts also check `useStill` themselves, so with reduced motion
 * nothing fades either: everything changes at once (DESIGN.md "Motion").
 */
export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user" transition={springs.snappy}>
        {children}
      </MotionConfig>
    </LazyMotion>
  )
}

/** The features, in a file of their own that the browser fetches once the app has started. */
function loadFeatures() {
  return import('./features').then((module) => module.default)
}
