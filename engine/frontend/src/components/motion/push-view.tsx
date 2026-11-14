/**
 * One view replaces another inside a box that keeps its size, like a phone app's next screen: the
 * Log call view comes into the call prep panel, and Back returns to the script (PLAN-V17 T3-5).
 *
 *   forward  the old view slides 24px left and fades out (`exit`, 150ms), and the new one comes
 *            from 24px right and fades in (`smooth`, 400ms, no bounce)
 *   back     the same the other way, and quicker: both on `exit`
 *
 *   <PushView viewKey={view} direction={direction} className="min-h-0 flex-1">
 *     {view === 'script' ? <Script /> : <LogCall />}
 *   </PushView>
 *
 * The box takes its size from the page (in the panel, the room between the header and the
 * footer), and each view fills it (`h-full`), so a long view scrolls inside itself. The leaving
 * view is taken out of the layout at once (AnimatePresence's `popLayout` pins it where it was, at
 * its size), so the box never holds both views and nothing around it moves. The box clips the
 * 24px sideways, so a panel that scrolls never shows a sideways scrollbar. Give each view its own
 * padding, so a focus ring at its edge is never clipped.
 *
 * A second press half way never jumps: a view that comes back is the same element, and its spring
 * carries on from where it is. The leaving view is inert while it goes, so Tab, a click and a
 * screen reader skip it.
 *
 * Focus is the caller's job, and it moves at once, not when the move ends. Forward: the new view
 * focuses its first field as it mounts (the rep types straight after L, and waiting 400ms would
 * lose the first keys). Back: focus returns to what opened the view. If focus was in the leaving
 * view, the browser drops it when that view turns inert, so always move it.
 *
 * With reduced motion the views simply swap: the old one is hidden at once, and the new one is
 * there.
 */
import { AnimatePresence, m, useIsPresent, type Variants } from 'motion/react'
import type { ReactNode, Ref } from 'react'
import { cn } from '@/lib/utils'
import { INSTANT, springs } from './springs'
import { useStill } from './use-still'

export type PushDirection = 'forward' | 'back'

export interface PushViewProps {
  /** Names the view on show. A new key brings that view in; the same key keeps it. */
  viewKey: string
  /** `forward` opens the next view (Log call); `back` returns (Back to the script). */
  direction?: PushDirection
  /** The view on show. */
  children: ReactNode
  /** The box. Give it its size, like `min-h-0 flex-1` in the panel's column. */
  className?: string
}

/** How far a view slides as it comes or goes. */
const SHIFT = 24

/**
 * The views move. The direction comes from `custom`, so a view that is already leaving follows
 * the latest press too (AnimatePresence hands it the new one).
 */
const MOVING: Variants = {
  enter: (direction: PushDirection) => ({ x: direction === 'back' ? -SHIFT : SHIFT, opacity: 0 }),
  shown: (direction: PushDirection) => ({
    x: 0,
    opacity: 1,
    transition: direction === 'back' ? springs.exit : springs.smooth,
  }),
  leave: (direction: PushDirection) => ({
    x: direction === 'back' ? SHIFT : -SHIFT,
    opacity: 0,
    transition: springs.exit,
  }),
}

/** Reduced motion: nothing slides or fades. */
const STILL: Variants = {
  enter: { x: 0, opacity: 1 },
  shown: { x: 0, opacity: 1, transition: INSTANT },
  leave: { opacity: 0, transition: INSTANT },
}

export function PushView({ viewKey, direction = 'forward', children, className }: PushViewProps) {
  const still = useStill()
  return (
    <div data-slot="push-view" className={cn('relative overflow-x-clip', className)}>
      {/* The first view is simply there: the panel itself slides in. */}
      <AnimatePresence mode="popLayout" initial={false} custom={direction}>
        <PushPane key={viewKey} viewKey={viewKey} direction={direction} still={still}>
          {children}
        </PushPane>
      </AnimatePresence>
    </div>
  )
}

interface PushPaneProps {
  viewKey: string
  direction: PushDirection
  still: boolean
  children: ReactNode
  /** Given by AnimatePresence, so `popLayout` can pin the leaving view where it was. */
  ref?: Ref<HTMLDivElement>
}

/** One view. While it leaves it is inert; with reduced motion it is hidden at once. */
function PushPane({ viewKey, direction, still, children, ref }: PushPaneProps) {
  const present = useIsPresent()
  return (
    <m.div
      ref={ref}
      data-view={viewKey}
      inert={!present}
      hidden={still && !present}
      custom={direction}
      variants={still ? STILL : MOVING}
      initial={still ? false : 'enter'}
      animate="shown"
      exit="leave"
      className="h-full"
    >
      {children}
    </m.div>
  )
}
