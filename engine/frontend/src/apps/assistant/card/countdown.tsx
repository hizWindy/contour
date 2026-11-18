/**
 * The countdowns of the review card (PLAN-V22 T3-4, "How it should look and move"): a bar that
 * empties once over a real span of time, never a loop. The 5 second hold's toast shows it with the
 * seconds left, and the card shows it while it listens for "send it".
 *
 * Only the bar's `scaleX` moves, at an even speed, because it is a clock. With reduced motion there
 * is no bar, and the words count the seconds.
 */
import { m } from 'motion/react'
import { useEffect, useState } from 'react'
import { useStill } from '@/components/motion/use-still'
import { holdWords } from './words'

/**
 * A bar that empties once, at an even speed, over `ms`: the hold's, and the card's while it
 * listens for "send it". Nothing with reduced motion.
 */
export function CountdownBar({ ms }: { ms: number }) {
  const still = useStill()
  if (still) return null
  return (
    <span aria-hidden="true" className="block h-1 w-full overflow-hidden rounded-sm bg-muted">
      <m.span
        data-slot="countdown-bar"
        className="block h-full w-full origin-left bg-progress"
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: ms / 1000, ease: 'linear' }}
      />
    </span>
  )
}

/** The toast's line and its bar: the seconds left, and a bar that empties once. */
export function HoldCountdown({ ms }: { ms: number }) {
  const [left, setLeft] = useState(Math.ceil(ms / 1000))
  useEffect(() => {
    if (left <= 1) return undefined
    const timer = window.setTimeout(() => {
      setLeft((now) => now - 1)
    }, 1000)
    return () => {
      window.clearTimeout(timer)
    }
  }, [left])
  return (
    <span data-slot="hold" className="flex flex-col gap-2">
      {/* A screen reader hears the time once, not every second. */}
      <span className="sr-only">{holdWords(Math.ceil(ms / 1000))}</span>
      <span aria-hidden="true" className="tabular-nums">
        {holdWords(left)}
      </span>
      <CountdownBar ms={ms} />
    </span>
  )
}
