/**
 * The call prep panel's title and description, for a panel with two views (the script, and Log
 * call's note view, PLAN-V17 T3-5). For a moment both views are on screen, the old one leaving
 * (`PushView`). Only the view that stays gives the panel its name: the leaving view's title turns
 * into a plain heading, so the panel never holds two titles with the same id.
 */
import { useIsPresent } from 'motion/react'
import type { ReactNode } from 'react'
import { SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

export function PanelTitle({ className, children }: { className?: string; children: ReactNode }) {
  const present = useIsPresent()
  return present ? (
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
  const present = useIsPresent()
  return present ? (
    <SheetDescription className={className}>{children}</SheetDescription>
  ) : (
    <p className={cn('text-ui text-muted-foreground', className)}>{children}</p>
  )
}
