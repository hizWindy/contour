/**
 * The glass on the menu (Improvements 1, #7). Al-khair, 17 Nov 2026: "improve the hover effect, make
 * it look like glass, like on an iPhone, a smooth hover thing."
 *
 * - **One pane of glass follows the pointer** from row to row of the menu, and another sits under
 *   the page you are on. Each is a layout animation (`layoutId`, on the `snappy` spring): the pane
 *   slides from the row it left to the row it meets, as the highlight moves along an iOS menu. A
 *   transform and nothing else moves.
 * - **It fades in once,** when the pointer first meets the menu, and fades out once, 150ms, when it
 *   leaves. Moving between rows it never fades: it slides, so there is one pane, not two.
 * - **It looks like glass:** see-through white, a bright rim and a shine along the top edge, and a
 *   soft shadow under it (`--glass-*` in tokens.css). Nothing is blurred and no colour ramps: the
 *   menu behind it is one flat colour, so there is nothing to blur. The selected row's pane is the
 *   accent's tint with the 2px accent bar at its left edge, and slides when you go to another page.
 * - **Keyboard:** the pane follows the focus too, so Tab moves it along the menu. A touch screen
 *   has no hover, so a finger never calls it up.
 * - **Reduced motion:** the panes simply appear under the row, with no slide and no fade.
 *
 * `GlassMenu` (here) goes round the whole menu (it is a `nav`). Each row (a button or a link) calls
 * `useGlassRow` (`glass-row.tsx`), spreads the handlers on itself, and draws the `layers` as its
 * first child. The row must be `relative isolate` and must not clip its own box (no
 * `overflow-hidden`), or the pane would be cut off as it slides in. Outside a `GlassMenu` a row
 * still shows its selected pane, and never a hover one.
 *
 * This is the one agreed exception to "no glass, no blur" in DESIGN.md, and it is for the menu
 * only. The panes are decoration: they are hidden from screen readers.
 */
import { LayoutGroup } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { FADE_MS } from './glass-timing'
import { GlassContext, type GlassMenuState, type Hover } from './glass-row'
import { useStill } from './use-still'

const NONE: Hover = { hovered: null, arriving: true, fading: false }

/**
 * The menu: a `nav` that holds the glass. The pointer leaving it, not a row, is what clears the
 * pane, so the pane keeps its place while the pointer crosses the gap between two rows.
 */
export function GlassMenu({ children, onPointerLeave, ...props }: ComponentProps<'nav'>) {
  const still = useStill()
  const [state, setState] = useState<Hover>(NONE)
  const timer = useRef<number | undefined>(undefined)
  // The row that holds the pane now, for the keyboard's `off`, which must not clear another row's.
  const current = useRef<string | null>(null)
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
    },
    [],
  )
  const menu = useMemo<GlassMenuState>(() => {
    const clear = (): void => {
      current.current = null
      setState(NONE)
    }
    /** The pane fades out over 150ms, then goes. Meeting a row meanwhile cancels it. */
    const fade = (): void => {
      window.clearTimeout(timer.current)
      if (current.current === null) return
      if (still) {
        clear()
        return
      }
      setState((now) => ({ ...now, fading: true }))
      timer.current = window.setTimeout(clear, FADE_MS)
    }
    return {
      ...state,
      on: (row) => {
        window.clearTimeout(timer.current)
        setState((now) => {
          if (now.hovered === row && !now.fading) return now
          current.current = row
          return { hovered: row, arriving: now.hovered === null, fading: false }
        })
      },
      off: (row) => {
        if (current.current === row) fade()
      },
      leave: fade,
    }
  }, [state, still])
  return (
    <GlassContext value={menu}>
      <LayoutGroup id="glass-menu">
        <nav
          {...props}
          onPointerLeave={(event) => {
            onPointerLeave?.(event)
            menu.leave()
          }}
        >
          {children}
        </nav>
      </LayoutGroup>
    </GlassContext>
  )
}
