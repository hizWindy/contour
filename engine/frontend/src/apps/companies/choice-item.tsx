/**
 * A menu row that is one choice of a few, like a mic or the person to call (PLAN-V18 T3-4, T3-7):
 * a screen reader hears it as a radio item of the menu, and the one picked has a tick.
 *
 * It is the menu's plain item underneath, on purpose: the account menu is in the first visit, so
 * the dropdown's code is shared with it, and the menu's own radio parts would join the first
 * visit (found by T3-9's speed check). This keeps them out.
 */
import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export function ChoiceItem({
  checked,
  onPick,
  children,
  className,
}: {
  checked: boolean
  onPick: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <DropdownMenuItem
      role="menuitemradio"
      aria-checked={checked}
      className={cn('relative pl-8 touch:min-h-11', className)}
      onSelect={onPick}
    >
      <span aria-hidden="true" className="absolute left-2 flex size-4 items-center justify-center">
        {checked ? <Check className="size-4" /> : null}
      </span>
      {children}
    </DropdownMenuItem>
  )
}
