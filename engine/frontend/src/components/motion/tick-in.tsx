/**
 * A tick that draws itself once, when it mounts: each card in Activity as it lands in HubSpot
 * (PLAN-V17 T3-6). The line draws from its short end on the `soft` spring (350ms, bounce 0.1), and
 * fades in on the one curve over the first 150ms, so its round end never shows as a dot before the
 * line starts. Drawing the line of a 16px icon is the one change here that is not a transform or
 * an opacity; it is that small on purpose.
 *
 * It is hidden from screen readers, on purpose. The card says "Logged" in words beside it, so a
 * label on the tick would be read twice (DESIGN.md "Say it once"). Always put the word beside it:
 * the tick alone is a mark, not a status.
 *
 * It draws once: only a new mount draws it again, never a new render. With reduced motion the
 * tick is simply there.
 */
import { m } from 'motion/react'
import { cn } from '@/lib/utils'
import { INSTANT, springs } from './springs'
import { useStill } from './use-still'

export interface TickInProps {
  className?: string
}

export function TickIn({ className }: TickInProps) {
  const still = useStill()
  return (
    <svg
      data-slot="tick-in"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('size-4 shrink-0', className)}
    >
      {/* Lucide's check, drawn the way a hand draws it: the short stroke first. The fade is the
          one curve at 150ms, the same as `exit`. */}
      <m.path
        d="M4 12l5 5L20 6"
        initial={still ? false : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={still ? INSTANT : { ...springs.soft, opacity: springs.exit }}
      />
    </svg>
  )
}
