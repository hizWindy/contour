/**
 * A view pushed over another inside a box that keeps its size, like a phone app's next screen:
 * Log call's note view comes over the call prep panel's script, and Back returns to it
 * (PLAN-V17 T3-5, T3-8).
 *
 *   push   the base view slides 24px left and fades out (`exit`, 150ms), and the pushed view
 *          comes from 24px right and fades in (`smooth`, 400ms, no bounce)
 *   back   the same the other way, and quicker: both on `exit`
 *
 *   <PushView pushed={noting ? <NoteView /> : null} className="min-h-0 flex-1">
 *     <Script />
 *   </PushView>
 *
 * The base view (the children) stays mounted the whole time, so nothing in it is lost: a rep who
 * ticks the guided questions, logs the call and goes Back finds the ticks and the scroll as they
 * were, and Back has nothing to build (found in T3-8: building the script again took one long
 * frame, about 85ms, and over 800ms at 4x CPU slowdown). While it is covered it is inert, so Tab,
 * a click and a screen reader skip it, and once its leave has ended it is `visibility: hidden`,
 * so it doesn't paint. It keeps its place in the layout, so nothing shifts. The pushed view
 * mounts as it comes and unmounts once it has left: keep outside it whatever it must not lose
 * (the note view keeps its draft in the browser).
 *
 * The box takes its size from the page (in the panel, the room between the header and the
 * footer). The base view fills it (`h-full`) and the pushed view lies over it (`absolute
 * inset-0`), so a long view scrolls inside itself. The box clips the 24px sideways, so a panel
 * that scrolls never shows a sideways scrollbar. Give each view its own padding, so a focus ring
 * at its edge is never clipped.
 *
 * A second press half way never jumps: each view is the same element all along, and its move
 * carries on from where it is.
 *
 * Focus is the caller's job, and it moves at once, not when the move ends. Push: the pushed view
 * focuses its first field as it mounts (the rep types straight after L, and waiting 400ms would
 * lose the first keys). Back: focus returns to what opened the view. The base view is shown in the
 * same render as Back, so it can take the focus at once. If focus was in a view that turns inert,
 * the browser drops it, so always move it.
 *
 * `useViewShown` (in `view-shown.ts`) tells a part whether its view is the one on show.
 *
 * With reduced motion the views simply swap: the covered view is hidden at once, and the pushed
 * view is there.
 */
import { AnimatePresence, m, useIsPresent, type Variants } from 'motion/react'
import { useState, type ReactElement, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { INSTANT, springs } from './springs'
import { useStill } from './use-still'
import { ViewShown } from './view-shown'

export interface PushViewProps {
  /** The base view. It stays mounted under the pushed one. */
  children: ReactNode
  /** The view pushed over the base, or null for none. */
  pushed: ReactElement | null
  /** The box. Give it its size, like `min-h-0 flex-1` in the panel's column. */
  className?: string
}

/** How far a view slides as it comes or goes. */
const SHIFT = 24

/** The base view: it slides left and fades as it is covered, and comes back the same way. */
const BASE_MOVING: Variants = {
  shown: { x: 0, opacity: 1, transition: springs.exit },
  covered: { x: -SHIFT, opacity: 0, transition: springs.exit },
}

/** The pushed view: it comes from the right, and goes back there. */
const PUSHED_MOVING: Variants = {
  enter: { x: SHIFT, opacity: 0 },
  shown: { x: 0, opacity: 1, transition: springs.smooth },
  leave: { x: SHIFT, opacity: 0, transition: springs.exit },
}

/** Reduced motion: nothing slides or fades. The covered view is hidden instead. */
const BASE_STILL: Variants = {
  shown: { x: 0, opacity: 1, transition: INSTANT },
  covered: { x: 0, opacity: 1, transition: INSTANT },
}

const PUSHED_STILL: Variants = {
  enter: { x: 0, opacity: 1 },
  shown: { x: 0, opacity: 1, transition: INSTANT },
  leave: { opacity: 0, transition: INSTANT },
}

export function PushView({ children, pushed, className }: PushViewProps) {
  const still = useStill()
  const covered = pushed !== null
  // The base view is out of sight once its leave has ended. A box that starts covered starts so.
  const [settled, setSettled] = useState(covered)
  if (settled && !covered) {
    setSettled(false)
  }
  const unseen = covered && (settled || still)
  return (
    <div data-slot="push-view" className={cn('relative overflow-x-clip', className)}>
      <ViewShown.Provider value={!covered}>
        <m.div
          data-view="base"
          inert={covered}
          variants={still ? BASE_STILL : BASE_MOVING}
          initial={false}
          animate={covered ? 'covered' : 'shown'}
          // Only a leave that ran to its end hides it: one cut short by Back never ends.
          onAnimationComplete={(definition) => {
            if (definition === 'covered') setSettled(true)
          }}
          style={unseen ? { visibility: 'hidden' } : undefined}
          className="h-full"
        >
          {children}
        </m.div>
      </ViewShown.Provider>
      {/* A view there from the start is simply there: the panel itself slides in. */}
      <AnimatePresence initial={false}>
        {pushed === null ? null : (
          <PushedPane key="pushed" still={still}>
            {pushed}
          </PushedPane>
        )}
      </AnimatePresence>
    </div>
  )
}

/** The pushed view. While it leaves it is inert; with reduced motion it is hidden at once. */
function PushedPane({ still, children }: { still: boolean; children: ReactNode }) {
  const present = useIsPresent()
  return (
    <ViewShown.Provider value={present}>
      <m.div
        data-view="pushed"
        inert={!present}
        hidden={still && !present}
        variants={still ? PUSHED_STILL : PUSHED_MOVING}
        initial={still ? false : 'enter'}
        animate="shown"
        exit="leave"
        className="absolute inset-0"
      >
        {children}
      </m.div>
    </ViewShown.Provider>
  )
}
