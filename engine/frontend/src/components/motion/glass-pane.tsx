/**
 * One pane of the menu's glass (Improvements 1, #7). See `glass.tsx` for how it looks and moves.
 * The hover pane fades in once when the pointer first meets the menu, slides from row to row, and
 * fades out once when the pointer leaves. The selected pane only slides. With reduced motion
 * (`still`) a pane is a plain span: it is simply there.
 */
import { m } from 'motion/react'
import { cn } from '@/lib/utils'
import { FADE_MS } from './glass-timing'
import { EASE, springs } from './springs'

/** The fade, 150ms on the one curve. */
const FADE = { duration: FADE_MS / 1000, ease: EASE } as const

const PANE_CLASSES = {
  hover: 'bg-(--glass-fill) shadow-(--glass-hover-shadow)',
  selected: 'bg-(--glass-selected-fill) shadow-(--glass-selected-shadow)',
} as const

export function GlassPane({
  kind,
  arriving = false,
  fading = false,
  still,
}: {
  kind: keyof typeof PANE_CLASSES
  arriving?: boolean
  fading?: boolean
  still: boolean
}) {
  const classes = cn(
    'pointer-events-none absolute inset-0 -z-10 rounded-[inherit]',
    PANE_CLASSES[kind],
  )
  if (still) {
    return <span data-slot="glass" data-kind={kind} aria-hidden="true" className={classes} />
  }
  return (
    <m.span
      data-slot="glass"
      data-kind={kind}
      aria-hidden="true"
      layoutId={`glass-${kind}`}
      // One pane that slides, never two that fade over each other as they travel.
      layoutCrossfade={false}
      className={classes}
      transition={springs.snappy}
      // The selected pane only slides. The hover pane fades in once, slides, then fades out.
      initial={kind === 'hover' && arriving ? { opacity: 0 } : false}
      animate={{ opacity: fading ? 0 : 1, transition: FADE }}
    />
  )
}
