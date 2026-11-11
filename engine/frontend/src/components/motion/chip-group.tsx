/**
 * Chips you tap to pick: cities, weekdays, a run's signs. A picked chip gets the accent's tint,
 * its ink and a tick that grows in on the `soft` spring (the one place with a very small bounce).
 * A chip shrinks to 0.98 while it is held (`usePress`). Unpicking fades the tick in 150ms.
 *
 * Two modes. `many` (the default) picks any number: each chip is a button with `aria-pressed`,
 * and Tab moves between them. `one` picks exactly one, like radio buttons: the arrows move the
 * choice, and only the chosen chip is in the Tab order. In both, `value` is the list of picked
 * values (one item at most in `one` mode), so a page keeps one shape of state.
 *
 * With reduced motion the tick simply appears, and nothing presses.
 */
import { Check, type LucideIcon } from 'lucide-react'
import { m } from 'motion/react'
import { useRef } from 'react'
import { cn } from '@/lib/utils'
import { focusRadio, handleRovingKey } from './roving'
import { INSTANT, springs } from './springs'
import { usePress } from './use-press'
import { useStill } from './use-still'

export interface ChipOption<T extends string = string> {
  value: T
  label: string
  icon?: LucideIcon
  disabled?: boolean
  /** A short hint, read by a screen reader with the label. */
  description?: string
}

export interface ChipGroupProps<T extends string = string> {
  options: readonly ChipOption<T>[]
  value: readonly T[]
  onChange: (value: T[]) => void
  mode?: 'many' | 'one'
  'aria-label'?: string
  'aria-labelledby'?: string
  className?: string
  id?: string
}

export function ChipGroup<T extends string = string>({
  options,
  value,
  onChange,
  mode = 'many',
  className,
  id,
  ...labels
}: ChipGroupProps<T>) {
  const still = useStill()
  const press = usePress()
  const group = useRef<HTMLDivElement>(null)
  const disabled = options.map((option) => Boolean(option.disabled))
  const one = mode === 'one'
  // In `one` mode with nothing picked yet, the first enabled chip holds the Tab stop.
  const firstEnabled = disabled.indexOf(false)

  function toggle(option: ChipOption<T>) {
    if (one) {
      onChange([option.value])
      return
    }
    onChange(
      value.includes(option.value)
        ? value.filter((v) => v !== option.value)
        : [...value, option.value],
    )
  }

  return (
    <div
      ref={group}
      id={id}
      role={one ? 'radiogroup' : 'group'}
      aria-label={labels['aria-label']}
      aria-labelledby={labels['aria-labelledby']}
      data-slot="chip-group"
      className={cn('flex flex-wrap gap-2', className)}
    >
      {options.map((option, index) => {
        const picked = value.includes(option.value)
        const Icon = option.icon
        const tabStop = one
          ? picked || (value.length === 0 && index === firstEnabled)
            ? 0
            : -1
          : undefined
        return (
          <m.button
            key={option.value}
            type="button"
            role={one ? 'radio' : undefined}
            aria-checked={one ? picked : undefined}
            aria-pressed={one ? undefined : picked}
            aria-description={option.description}
            tabIndex={tabStop}
            disabled={option.disabled}
            onClick={() => toggle(option)}
            onKeyDown={
              one
                ? (event) =>
                    handleRovingKey(event, index, disabled, (target) => {
                      const next = options[target]
                      if (next) {
                        onChange([next.value])
                        focusRadio(group.current, target)
                      }
                    })
                : undefined
            }
            {...press}
            className={cn(
              'inline-flex min-h-8 items-center gap-1.5 rounded-md border pr-3 pl-2.5 text-ui whitespace-nowrap transition-colors touch:min-h-11',
              picked
                ? 'border-accent-strong bg-accent-soft font-semibold text-accent-ink'
                : 'border-input bg-card text-foreground hover:bg-muted',
              'disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            {/* The tick keeps its room when hidden, so a chip never changes width. */}
            <m.span
              aria-hidden="true"
              initial={false}
              animate={{ scale: picked ? 1 : 0, opacity: picked ? 1 : 0 }}
              transition={still ? INSTANT : picked ? springs.soft : springs.exit}
              className="grid size-3.5 shrink-0 place-items-center"
            >
              <Check className="size-3.5 stroke-2" />
            </m.span>
            {Icon ? <Icon aria-hidden="true" className="size-4" /> : null}
            {option.label}
          </m.button>
        )
      })}
    </div>
  )
}
