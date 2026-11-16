/**
 * One row of the menu's glass (Improvements 1, #7): the hook a row calls, the panes it draws, and
 * the context the menu (`GlassMenu`, `glass.tsx`) shares with its rows. See `glass.tsx` for how the
 * glass looks and moves. It is in a file of its own because a file that exports a component and a
 * hook cannot refresh in place (the lint rule), and the menu is the component.
 */
import {
  createContext,
  useContext,
  useId,
  type FocusEventHandler,
  type PointerEventHandler,
  type ReactNode,
} from 'react'
import { GlassPane } from './glass-pane'
import { useStill } from './use-still'

export interface Hover {
  /** The row the pointer or the keyboard is on, or null. */
  hovered: string | null
  /** The glass was not showing just before this row: it fades in instead of sliding. */
  arriving: boolean
  /** The pointer left the menu: the pane is fading out, and goes in 150ms. */
  fading: boolean
}

export interface GlassMenuState extends Hover {
  on: (row: string) => void
  /** The keyboard left a row. Only the row that holds the pane clears it. */
  off: (row: string) => void
  /** The pointer left the whole menu. */
  leave: () => void
}

export const GlassContext = createContext<GlassMenuState | null>(null)

export interface GlassHandlers<T extends HTMLElement = HTMLElement> {
  onPointerEnter?: PointerEventHandler<T>
  onFocus?: FocusEventHandler<T>
  onBlur?: FocusEventHandler<T>
}

export interface GlassRow<T extends HTMLElement = HTMLElement> {
  /** Spread on the row. They run the row's own handlers first. */
  handlers: Required<GlassHandlers<T>>
  /** Draw these first inside the row. */
  layers: ReactNode
}

/**
 * One row of the menu. `selected` is true for the page you are on. Pass the row's own handlers so
 * the glass adds to them and never replaces them.
 */
export function useGlassRow<T extends HTMLElement = HTMLElement>(
  selected: boolean,
  own: GlassHandlers<T> = {},
): GlassRow<T> {
  const row = useId()
  const menu = useContext(GlassContext)
  const still = useStill()
  const hovered = menu !== null && menu.hovered === row
  return {
    handlers: {
      onPointerEnter: (event) => {
        own.onPointerEnter?.(event)
        // A finger has no hover: it never calls the glass up.
        if (menu && event.pointerType !== 'touch') menu.on(row)
      },
      onFocus: (event) => {
        own.onFocus?.(event)
        menu?.on(row)
      },
      onBlur: (event) => {
        own.onBlur?.(event)
        menu?.off(row)
      },
    },
    layers: (
      <>
        {selected ? <GlassPane kind="selected" still={still} /> : null}
        {hovered ? (
          <GlassPane kind="hover" arriving={menu.arriving} fading={menu.fading} still={still} />
        ) : null}
      </>
    ),
  }
}
