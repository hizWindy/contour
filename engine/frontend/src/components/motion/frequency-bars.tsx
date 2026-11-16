/**
 * Bars that follow the mic's own sound inside the mic card (PLAN-V18 T3-4, "How it should look
 * and move": "Speak now"). 24 bars, each one band of the voice, from low to high. The caller hands
 * in a `BarSource`, which reads the mic's frequencies (an AnalyserNode) into 24 levels from 0 to 1.
 *
 * - **Transform only, up to 30 times a second.** A frame loop reads the source at most every 33ms
 *   and writes each bar's `scaleY` straight onto its element, so React doesn't draw 24 parts 30
 *   times a second. Nothing else changes: no height, no colour.
 * - **It follows a real signal, so it isn't a loop.** Below a small gate a band counts as silence,
 *   and a bar that has settled isn't written again: at silence the bars are still and low, and the
 *   frame loop only reads. A bar rises fast and falls slower, like a meter, so a voice reads as one
 *   shape, not a flicker. With no source (the mic isn't open yet) the bars sit still at the floor.
 * - **The loop runs only while there is a source** and stops the moment the card lets the mic go.
 * - **Reduced motion:** one still bar and the word ("Listening"), and nothing moves.
 *
 * The bars are hidden from screen readers: the card says the state in words. They take the
 * accent, the colour of what is live (DESIGN.md "The accent").
 */
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { BAR_COUNT, BAR_FLOOR, BAR_FPS, stepBars, type BarSource } from './bar-levels'
import { useStill } from './use-still'

export interface FrequencyBarsProps {
  /** The mic's sound, or null while it isn't open: the bars then sit still at the floor. */
  source: BarSource | null
  /** The word shown with reduced motion, beside the one still bar. */
  label?: string
  className?: string
}

function scaleOf(value: number): string {
  return `scaleY(${value.toFixed(3)})`
}

export function FrequencyBars({ source, label = 'Listening', className }: FrequencyBarsProps) {
  const still = useStill()
  const bars = useRef<(HTMLSpanElement | null)[]>([])

  useEffect(() => {
    if (still || !source) return undefined
    const scales = new Float32Array(BAR_COUNT).fill(BAR_FLOOR)
    const levels = new Float32Array(BAR_COUNT)
    const elements = bars.current
    const frame = 1000 / BAR_FPS
    let last = -Infinity
    let handle = 0
    const draw = (now: number): void => {
      // A frame comes every 16ms or so; the bars take every other one (the 1ms is the clock's
      // own wobble, so a 60 Hz screen doesn't skip two frames in three).
      if (now - last >= frame - 1) {
        last = now
        source.read(levels)
        for (const bar of stepBars(scales, levels)) {
          const element = elements[bar]
          if (element) element.style.transform = scaleOf(scales[bar] ?? BAR_FLOOR)
        }
      }
      handle = window.requestAnimationFrame(draw)
    }
    handle = window.requestAnimationFrame(draw)
    return () => {
      window.cancelAnimationFrame(handle)
      // The mic is let go: the bars settle back to the floor at once, still.
      for (const element of elements) {
        if (element) element.style.transform = scaleOf(BAR_FLOOR)
      }
    }
  }, [source, still])

  if (still) {
    return (
      <span
        data-slot="frequency-bars"
        className={cn('inline-flex items-center gap-2 text-ui text-foreground', className)}
      >
        <span aria-hidden="true" className="block h-4 w-1 shrink-0 rounded-xs bg-accent-strong" />
        <span>{label}</span>
      </span>
    )
  }
  return (
    <span
      data-slot="frequency-bars"
      aria-hidden="true"
      className={cn('flex h-10 items-end justify-center gap-[3px]', className)}
    >
      {Array.from({ length: BAR_COUNT }, (_, bar) => (
        <span
          // 24 bars that never change: the place is the bar.
          key={bar}
          ref={(element) => {
            bars.current[bar] = element
          }}
          data-slot="frequency-bar"
          className="block h-full w-[3px] origin-bottom rounded-xs bg-accent-strong will-change-transform"
          style={{ transform: scaleOf(BAR_FLOOR) }}
        />
      ))}
    </span>
  )
}
