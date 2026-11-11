import type { Transition } from 'motion/react'
import { REDUCED_MOTION, useMediaQuery } from '@/lib/use-media-query'
import { INSTANT } from './springs'

/**
 * True when the computer asks for reduced motion. Then everything changes at once: the kit's
 * parts skip their `initial` state and use INSTANT. It reads the media query on every render
 * (not once at start-up, as `motion`'s own `useReducedMotion` does), so a test can switch it.
 */
export function useStill(): boolean {
  return useMediaQuery(REDUCED_MOTION)
}

/** The transition to use: the one given, or INSTANT when the computer asks for reduced motion. */
export function useTransition(transition: Transition): Transition {
  const still = useStill()
  return still ? INSTANT : transition
}
