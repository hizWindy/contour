/**
 * The countdowns of the review card (PLAN-V22 T3-4, "How it should look and move"): a bar that
 * empties once over a real span of time, never a loop. The 5 second hold's toast shows it with the
 * seconds left, and the card shows it while it listens for "send it".
 *
 * The parts are shared (`components/countdown.tsx`, PLAN-V27 T3-2): this keeps the card's words.
 */
import { Countdown, CountdownBar } from '@/components/countdown'
import { holdWords } from './words'

export { CountdownBar }

/** The toast's line and its bar: the seconds left, and a bar that empties once. */
export function HoldCountdown({ ms }: { ms: number }) {
  return <Countdown ms={ms} words={holdWords} />
}
