/**
 * An icon that turns once for each press (PLAN-V18 T2-2): Meetings' Sync turns its refresh icon
 * one full turn when it is pressed, and never in a loop. `turns` counts the presses, and each new
 * one adds one turn on the `smooth` spring (400ms, no bounce).
 *
 * A second press while it turns carries on from where the icon is, at the speed it has, and ends
 * one turn further on: it never jumps back or starts again from the top. A spring that gets a new
 * target mid-way does this by itself.
 *
 * Only the icon's `transform` changes: its place, size and colour stay. It is hidden from screen
 * readers, so the words beside it say what is going on ("Checking HubSpot"). With reduced motion
 * it stays still, and only those words change.
 */
import { m } from 'motion/react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { springs } from './springs'
import { useStill } from './use-still'

/** One full turn, in degrees. */
export const TURN = 360

export interface SpinOnceProps {
  /** How many times it was pressed. Each new press turns it once more. */
  turns: number
  /** The icon, like `<RefreshCw />`. */
  children: ReactNode
  className?: string
}

/** The angle for a count of presses: whole turns only, and none for a count that isn't one. */
function turnAngle(turns: number): number {
  return Number.isFinite(turns) && turns > 0 ? Math.floor(turns) * TURN : 0
}

export function SpinOnce({ turns, children, className }: SpinOnceProps) {
  const still = useStill()
  const classes = cn('inline-flex shrink-0', className)
  if (still) {
    return (
      <span data-slot="spin-once" aria-hidden="true" className={classes}>
        {children}
      </span>
    )
  }
  return (
    <m.span
      data-slot="spin-once"
      aria-hidden="true"
      className={classes}
      // Already turned when it first shows: a page that opens never turns it by itself.
      initial={false}
      animate={{ rotate: turnAngle(turns) }}
      transition={springs.smooth}
    >
      {children}
    </m.span>
  )
}
