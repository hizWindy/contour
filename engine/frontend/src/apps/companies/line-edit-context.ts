/**
 * What the script gives its editable lines (PLAN-V14 T3-6): the call the edits belong to, and what
 * to do after a save. In a file of its own, so the line editor's file holds only components.
 */
import { createContext } from 'react'
import type { ScriptCall } from './playbook'

export interface LineEditContextValue {
  /** The call the edits belong to, or null: then no line can be edited. */
  call: ScriptCall | null
  /** A line was saved. */
  onSaved: (slot: string, text: string) => void
  /** The slot that shows the "Make it my style" row, or null. */
  offerSlot: string | null
  onMakeStyle: () => void
  onDismissOffer: () => void
}

export const LineEditContext = createContext<LineEditContextValue>({
  call: null,
  onSaved: () => undefined,
  offerSlot: null,
  onMakeStyle: () => undefined,
  onDismissOffer: () => undefined,
})
