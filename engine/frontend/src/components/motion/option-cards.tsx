/**
 * Option cards: one choice from a few, each with a title and one line on what it does, like the
 * Start page's "What to do" (PLAN-V21 T3-1). `Segmented` stays for 2 or 3 short choices; these are
 * for choices whose names are long or need their line, which a sliding row would cut.
 *
 * - **Layout:** one column on a phone, two from 640px wide, as long as the cards' own box has room
 *   for two (30rem). On a laptop the form beside the cost card can be narrow, and two cards of
 *   about 160px would wrap every word, so they stay in one column there.
 * - **Keyboard:** it is a radio group. Tab lands on the picked card. The arrows (and Home and End)
 *   move the focus between the cards without picking, and Space or Enter picks the focused card.
 *   Picking swaps the form below, so it waits for the person's own key, never for an arrow.
 * - **Look:** a picked card takes the accent's tint and ink, with a tick that grows in on the
 *   `soft` spring, like a picked chip (DESIGN.md "The accent"). A card shrinks to 0.98 while it is
 *   held (`usePress`). With reduced motion the tick simply appears, and nothing presses.
 * - **Words:** a screen reader hears the title as the card's name and the line as its description.
 */
import { Check } from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { useId, useRef } from 'react'
import { cn } from '@/lib/utils'
import { focusRadio, handleRovingKey } from './roving'
import { INSTANT, springs } from './springs'
import { usePress } from './use-press'
import { useStill } from './use-still'

export interface OptionCard<T extends string = string> {
  value: T
  title: string
  /** One line on what the choice does. */
  description: string
  disabled?: boolean
}

export interface OptionCardsProps<T extends string = string> {
  options: readonly OptionCard<T>[]
  value: T | null
  onChange: (value: T) => void
  /** One of these names the group for a screen reader. */
  'aria-label'?: string
  'aria-labelledby'?: string
  className?: string
}

export function OptionCards<T extends string = string>({
  options,
  value,
  onChange,
  className,
  ...labels
}: OptionCardsProps<T>) {
  const id = useId()
  const still = useStill()
  const press = usePress()
  const group = useRef<HTMLDivElement>(null)
  const disabled = options.map((option) => Boolean(option.disabled))
  const hasChecked = options.some((option) => option.value === value)
  const firstEnabled = disabled.indexOf(false)

  return (
    <div className="@container">
      <div
        ref={group}
        role="radiogroup"
        aria-label={labels['aria-label']}
        aria-labelledby={labels['aria-labelledby']}
        data-slot="option-cards"
        className={cn('grid gap-2 sm:@min-[30rem]:grid-cols-2', className)}
      >
        {options.map((option, index) => {
          const checked = option.value === value
          const titleId = `${id}-${String(index)}-title`
          const lineId = `${id}-${String(index)}-line`
          return (
            <m.button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-labelledby={titleId}
              aria-describedby={lineId}
              tabIndex={checked || (!hasChecked && index === firstEnabled) ? 0 : -1}
              disabled={option.disabled}
              onClick={() => {
                onChange(option.value)
              }}
              onKeyDown={(event) => {
                // The arrows only move the focus. Space and Enter press the button, which picks.
                handleRovingKey(event, index, disabled, (target) => {
                  focusRadio(group.current, target)
                })
              }}
              {...press}
              data-slot="option-card"
              className={cn(
                'flex min-w-0 flex-col gap-1 rounded-lg border px-4 py-3 text-left transition-colors',
                checked
                  ? 'border-accent-strong bg-accent-soft'
                  : 'border-input bg-card hover:bg-muted',
                'disabled:pointer-events-none disabled:opacity-50',
              )}
            >
              <span className="flex items-start justify-between gap-2">
                <span
                  id={titleId}
                  className={cn(
                    'min-w-0 text-ui font-semibold',
                    checked ? 'text-accent-ink' : 'text-foreground',
                  )}
                >
                  {option.title}
                </span>
                <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center">
                  <AnimatePresence initial={false}>
                    {checked ? (
                      <m.span
                        key="tick"
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{
                          scale: 1,
                          opacity: 1,
                          transition: still ? INSTANT : springs.soft,
                        }}
                        exit={{ scale: 0, opacity: 0, transition: still ? INSTANT : springs.exit }}
                        className="grid place-items-center text-accent-ink"
                      >
                        <Check className="size-4 stroke-2" />
                      </m.span>
                    ) : null}
                  </AnimatePresence>
                </span>
              </span>
              <span id={lineId} className="text-caption text-pretty text-muted-foreground">
                {option.description}
              </span>
            </m.button>
          )
        })}
      </div>
    </div>
  )
}
