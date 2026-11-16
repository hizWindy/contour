/**
 * A count at the end of a row in the menu (`NavItem.count`), like Call logs' calls to confirm
 * (PLAN-V17 T3-7).
 *
 * It looks like shadcn's `SidebarMenuBadge` (13px, semibold, table digits, no fill, in the row's
 * own text colour) but sits inside the row's link, so the link's name says it for a screen reader:
 * "Call logs, 7 calls to confirm". `SidebarMenuBadge` sits beside the link instead, placed by the
 * classes of a main row, which a page under a project's name doesn't have. The number rolls when
 * it changes (`RollingNumber`, by its own file, so a count in the first visit pulls in no other
 * part of the motion kit). Folded to icons, the menu hides it.
 */
import { RollingNumber } from '@/components/motion/rolling-number'

export interface MenuCountProps {
  value: number
  /** The count in words, for a screen reader, like "7 calls to confirm". */
  words: string
}

export function MenuCount({ value, words }: MenuCountProps) {
  return (
    <span
      data-slot="menu-count"
      className="ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center px-1 text-caption font-semibold tabular-nums select-none group-data-[collapsible=icon]:hidden"
    >
      <span className="sr-only">, {words}</span>
      <span aria-hidden="true">
        <RollingNumber value={value} />
      </span>
    </span>
  )
}
