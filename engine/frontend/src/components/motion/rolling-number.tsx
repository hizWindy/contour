/**
 * A number that rolls to its new value: each digit is a column of 0 to 9 that slides to the new
 * digit on the `smooth` spring, in table digits so nothing shifts sideways. The first render shows
 * the value with no roll; only a change rolls. A screen reader reads the plain text, once.
 *
 * `format` makes the text (the site's number format by default, or a money format). Every
 * character that is not a digit (a comma, a point, "US$") is shown as it is.
 *
 * Beside words, the digits sit on the words' baseline ("Send 3 to HubSpot"). Each column holds an
 * unseen copy of its digit in the flow, which gives the column a baseline where its digit is, and
 * clips with `overflow: clip`. A column with only the moving strip in it has no line of its own,
 * and `overflow: hidden` moves an inline-block's baseline to its bottom edge: either way the
 * number rode above the words (found in PLAN-V17 T3-8).
 *
 * With reduced motion the digits simply change.
 */
import { m } from 'motion/react'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { INSTANT, springs } from './springs'
import { useStill } from './use-still'

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

export interface RollingNumberProps {
  value: number
  format?: (value: number) => string
  className?: string
}

export function RollingNumber({ value, format = formatNumber, className }: RollingNumberProps) {
  const still = useStill()
  const text = format(value)
  const chars = [...text]
  return (
    <span data-slot="rolling-number" className={cn('inline-flex tabular-nums', className)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="inline-flex leading-none">
        {chars.map((char, index) => {
          // Keyed from the right, so a new digit on the left does not re-roll the others.
          const key = chars.length - index
          if (!/\d/.test(char)) {
            return <span key={key}>{char}</span>
          }
          const digit = Number(char)
          return (
            <span
              key={key}
              data-slot="rolling-digit"
              className="relative inline-block h-[1em] w-[1ch] overflow-clip"
            >
              {/* In the flow and unseen: it puts the column's baseline where its digit is. */}
              <span className="invisible">{char}</span>
              <m.span
                className="absolute inset-x-0 top-0 flex flex-col"
                initial={false}
                animate={{ y: `${-digit * 10}%` }}
                transition={still ? INSTANT : springs.smooth}
              >
                {DIGITS.map((d) => (
                  <span key={d} className="block h-[1em] text-center">
                    {d}
                  </span>
                ))}
              </m.span>
            </span>
          )
        })}
      </span>
    </span>
  )
}
