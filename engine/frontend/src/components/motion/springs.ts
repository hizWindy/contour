/**
 * The motion kit's springs (DESIGN.md "Motion", PLAN-V13 T2-4). Every part of the kit moves on
 * one of these, and so should any page that animates with `motion` itself.
 *
 *   snappy   250ms, no bounce    an indicator, a chip, a segment
 *   smooth   400ms, no bounce    a panel or sheet arriving, content revealing
 *   soft     350ms, bounce 0.1   a toggle or a chip's tick, and nothing else
 *   exit     150ms, the curve    anything leaving: quicker than arriving
 *
 * `tokens.css` carries the same three springs as CSS `linear()` curves, for a shadcn part that
 * only needs a transition (the switch's thumb). Reduced motion: pass INSTANT instead (useStill).
 */
import type { Transition } from 'motion/react'

/** The one curve (DESIGN.md "Motion"), for colour, opacity and leaving. */
export const EASE = [0.4, 0, 0.2, 1] as const

export const springs = {
  snappy: { type: 'spring', duration: 0.25, bounce: 0 },
  smooth: { type: 'spring', duration: 0.4, bounce: 0 },
  soft: { type: 'spring', duration: 0.35, bounce: 0.1 },
  exit: { duration: 0.15, ease: EASE },
} as const satisfies Record<string, Transition>

export type SpringName = keyof typeof springs

/** No motion at all: everything changes at once. */
export const INSTANT: Transition = { duration: 0 }

/** Reveal: at most this many items one after another, this far apart. */
export const REVEAL_MAX = 8
export const REVEAL_STAGGER = 0.04
