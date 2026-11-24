/**
 * The tick boxes' state, handed to the table's cells through context, not through the columns.
 *
 * A column's cell is drawn as a component, so a column built again on every tick would draw its
 * cells afresh: the box just pressed would lose the keyboard's focus. The columns stay the same
 * objects (`columns.tsx`), and the boxes read the ticks from here (PLAN-V27 T3-2).
 */
import { createContext } from 'react'
import type { Tick } from './company-cell'

export const TickContext = createContext<Tick | undefined>(undefined)
