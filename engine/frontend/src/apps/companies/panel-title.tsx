/**
 * The call prep panel's title and description, for a panel with two views (the script, and Log
 * call's note view, PLAN-V17 T3-5). The script stays in the panel under the note view, and for a
 * moment the note view stays while it leaves (`PushView`). Only the view on show gives the panel
 * its name: the other view's title turns into a plain heading, so the panel never holds two titles
 * with the same id.
 */
import type { ReactNode } from 'react'
import { useViewShown } from '@/components/motion/view-shown'
import { SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

export function PanelTitle({ className, children }: { className?: string; children: ReactNode }) {
  const shown = useViewShown()
  return shown ? (
    <SheetTitle className={className}>{children}</SheetTitle>
  ) : (
    <h2 className={cn('text-section font-semibold text-foreground', className)}>{children}</h2>
  )
}

export function PanelDescription({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  const shown = useViewShown()
  return shown ? (
    <SheetDescription className={className}>{children}</SheetDescription>
  ) : (
    <p className={cn('text-ui text-muted-foreground', className)}>{children}</p>
  )
}
