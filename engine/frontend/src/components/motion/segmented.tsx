/**
 * A segmented control: one choice from a few, side by side, like "Every 2 weeks, Every 30 days,
 * Custom" or a chart's range. The highlight behind the chosen segment slides to the new one
 * (a layout animation on the `snappy` spring). It works as a radio group: the arrows move the
 * choice, Home and End jump to the ends, and only the chosen segment is in the Tab order.
 *
 * On a phone the row scrolls sideways rather than wrapping (`scroll`), and the chosen segment is
 * scrolled into view.
 *
 * The highlight is the accent's tint with the accent's ink on it (DESIGN.md "The accent"). With
 * reduced motion the highlight simply appears under the new choice.
 */
import type { LucideIcon } from 'lucide-react'
import { m } from 'motion/react'
import { useEffect, useId, useRef } from 'react'
import { cn } from '@/lib/utils'
import { focusRadio, handleRovingKey } from './roving'
import { springs } from './springs'
import { useStill } from './use-still'

export interface SegmentedOption<T extends string = string> {
  value: T
  label: string
  icon?: LucideIcon
  disabled?: boolean
}

export interface SegmentedProps<T extends string = string> {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** One of these names the group for a screen reader. */
  'aria-label'?: string
  'aria-labelledby'?: string
  /** `sm` for a toolbar; the default is the control height (36px, 44px on touch). */
  size?: 'default' | 'sm'
  /** The row scrolls sideways when it is too wide for the screen, instead of wrapping. */
  scroll?: boolean
  className?: string
  id?: string
}

export function Segmented<T extends string = string>({
  options,
  value,
  onChange,
  size = 'default',
  scroll = true,
  className,
  id,
  ...labels
}: SegmentedProps<T>) {
  const still = useStill()
  const layoutId = `segmented-${useId()}`
  const group = useRef<HTMLDivElement>(null)
  const disabled = options.map((option) => Boolean(option.disabled))

  // The chosen segment stays in view when the row scrolls sideways.
  useEffect(() => {
    group.current
      ?.querySelector('[aria-checked=true]')
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [value])

  return (
    <div
      ref={group}
      id={id}
      role="radiogroup"
      aria-label={labels['aria-label']}
      aria-labelledby={labels['aria-labelledby']}
      data-slot="segmented"
      className={cn(
        'inline-flex max-w-full gap-0.5 rounded-lg border bg-card p-0.5',
        scroll && 'overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {options.map((option, index) => {
        const checked = option.value === value
        const Icon = option.icon
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) =>
              handleRovingKey(event, index, disabled, (target) => {
                const next = options[target]
                if (next) {
                  onChange(next.value)
                  focusRadio(group.current, target)
                }
              })
            }
            className={cn(
              'relative inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-ui whitespace-nowrap transition-colors touch:min-h-10',
              size === 'sm' ? 'min-h-7' : 'min-h-8',
              checked
                ? 'font-semibold text-accent-ink'
                : 'text-muted-foreground hover:text-foreground',
              'disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            {checked ? (
              still ? (
                <span aria-hidden="true" className="absolute inset-0 rounded-md bg-accent-soft" />
              ) : (
                <m.span
                  aria-hidden="true"
                  layoutId={layoutId}
                  transition={springs.snappy}
                  className="absolute inset-0 rounded-md bg-accent-soft"
                />
              )
            ) : null}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {Icon ? <Icon aria-hidden="true" className="size-4" /> : null}
              {option.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
