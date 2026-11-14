/**
 * Five bars that follow the mic's level while it listens (PLAN-V17 T3-4). The caller reads the
 * level from the mic itself (an AnalyserNode) about 12 times a second and passes it in, from 0
 * (silence) to 1. Each bar grows from the bottom as a `scaleY` transform on the `snappy` spring,
 * so a new level carries on from where the bar is and nothing jumps.
 *
 * It follows a real signal, so it is not a loop: at 0 the bars are still, and they never move by
 * themselves (no idle wobble, nothing that repeats). Each bar takes its own share of the level
 * (0.5, 0.8, 1, 0.8, 0.5), so it reads as a voice, and none drops below 15% of its height, so a
 * bar never vanishes. Keep the level in a small part of its own, so only the meter draws again 12
 * times a second.
 *
 * The word beside the bars ("Listening") says the state, so it is never motion or colour alone:
 * don't add the word again next to it. The bars are hidden from screen readers, and the level is
 * never announced (no live region here). The bars take the colour of the text. With reduced
 * motion the bars become a still dot (the live run's dot), with the same word.
 */
import { CircleDot } from 'lucide-react'
import { m } from 'motion/react'
import { cn } from '@/lib/utils'
import { springs } from './springs'
import { useStill } from './use-still'

/** Each bar's share of the level, left to right. */
const WEIGHTS = [0.5, 0.8, 1, 0.8, 0.5] as const

/** The smallest a bar gets, as a share of its height. */
const FLOOR = 0.15

/** Each bar's scaleY for a level. The level is held to 0 to 1, and anything else (NaN) is 0. */
function barScales(level: number): number[] {
  const held = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0
  return WEIGHTS.map((weight) => FLOOR + (1 - FLOOR) * held * weight)
}

export interface LevelMeterProps {
  /** The mic's level now, from 0 (silence) to 1. A value outside that range is held to it. */
  level: number
  /** The word that says the state, always shown. */
  label?: string
  className?: string
}

export function LevelMeter({ level, label = 'Listening', className }: LevelMeterProps) {
  const still = useStill()
  return (
    <span data-slot="level-meter" className={cn('inline-flex items-center gap-2', className)}>
      {still ? (
        <CircleDot aria-hidden="true" className="size-4 shrink-0" />
      ) : (
        <span aria-hidden="true" className="flex h-4 shrink-0 gap-0.5">
          {barScales(level).map((scale, bar) => (
            <m.span
              // Five bars that never change: the place is the bar.
              key={bar}
              data-slot="level-bar"
              className="block h-full w-0.5 origin-bottom bg-current"
              initial={false}
              animate={{ scaleY: scale }}
              transition={springs.snappy}
            />
          ))}
        </span>
      )}
      <span>{label}</span>
    </span>
  )
}
