/**
 * The sliding underline under the selected tab. Put one inside every tab (a shadcn TabsTrigger,
 * or a NavLink that is a tab) with `active` set for the selected one, and the same `group` name
 * on all of them. When the selection changes, the underline slides from the old tab to the new
 * one (a layout animation with `layoutId`, on the `snappy` spring). The tab must be `relative`.
 *
 * A shadcn TabsTrigger (line variant) hides its own still underline when it holds one of these.
 * With reduced motion the underline simply appears under the new tab.
 */
import { m } from 'motion/react'
import { cn } from '@/lib/utils'
import { springs } from './springs'
import { useStill } from './use-still'

export interface TabIndicatorProps {
  active: boolean
  /** The same name on every tab of one tab list, and a different one for another list. */
  group: string
  /** Under the tab by default. `side` puts it at the right edge, for a vertical list. */
  side?: boolean
  className?: string
}

export function TabIndicator({ active, group, side = false, className }: TabIndicatorProps) {
  const still = useStill()
  if (!active) {
    return null
  }
  const classes = cn(
    'pointer-events-none absolute bg-accent-strong',
    side ? 'inset-y-0 -right-px w-0.5' : 'inset-x-0 -bottom-px h-0.5',
    className,
  )
  if (still) {
    return <span data-slot="tab-indicator" aria-hidden="true" className={classes} />
  }
  return (
    <m.span
      data-slot="tab-indicator"
      aria-hidden="true"
      layoutId={`tab-indicator-${group}`}
      transition={springs.snappy}
      className={classes}
    />
  )
}
