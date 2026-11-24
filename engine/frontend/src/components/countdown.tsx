/**
 * A countdown you can see: a bar that empties once over a real span of time, never a loop, and the
 * seconds left in words. The 5 second hold before a send uses it: the Assistant's toast
 * (PLAN-V22 T3-4) and Results' bulk add to HubSpot (PLAN-V27 T3-2).
 *
 * Only the bar's `scaleX` moves, at an even speed, because it is a clock. With reduced motion there
 * is no bar, and the words count the seconds.
 */
import { m } from 'motion/react'
import { useEffect, useState } from 'react'
import { useStill } from '@/components/motion/use-still'

/** A bar that empties once, at an even speed, over `ms`. Nothing with reduced motion. */
export function CountdownBar({ ms }: { ms: number }) {
  const still = useStill()
  if (still) return null
  return (
    <span aria-hidden="true" className="block h-1 w-full overflow-hidden rounded-sm bg-muted">
      <m.span
        data-slot="countdown-bar"
        className="block h-full w-full origin-left bg-progress"
        // As a whole transform, so the browser runs it, not a script every frame.
        initial={{ transform: 'scaleX(1)' }}
        animate={{ transform: 'scaleX(0)' }}
        transition={{ duration: ms / 1000, ease: 'linear' }}
      />
    </span>
  )
}

/**
 * The seconds left, in `words`, and the bar. A screen reader hears the time once, not every
 * second: the counting line is hidden from it.
 */
export function Countdown({
  ms,
  words,
  slot = 'hold',
}: {
  ms: number
  words: (seconds: number) => string
  slot?: string
}) {
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
    <span data-slot={slot} className="flex flex-col gap-2">
      <span className="sr-only">{words(Math.ceil(ms / 1000))}</span>
      <span aria-hidden="true" className="tabular-nums">
        {words(left)}
      </span>
      <CountdownBar ms={ms} />
    </span>
  )
}
