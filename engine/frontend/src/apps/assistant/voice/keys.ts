/**
 * When V belongs to the voice bar (PLAN-V22 T3-1, "Decided in chat" 2). In the first visit, with
 * the key listener, so it stays small.
 *
 * V starts the bar only when no Ctrl, Cmd, Alt or Shift is held, it isn't a held key's repeat,
 * nobody is typing in a box or through an input method, and no other dialog, menu or list box is
 * open. So V in a box types a "v", Ctrl+V pastes, and Ctrl+K's list keeps its own keys.
 *
 * Two changes in PLAN-V23 T4-1: V works over call prep's panel (right after a call is when a rep
 * needs it most), which marks itself with the company it preps (`data-voice-company`); and V does
 * nothing at all while "Use V to speak" is off (`v-switch.ts`).
 */
import { isTyping } from '@/lib/is-typing'
import { isVKeyOn } from './v-switch'

/** The bar itself, as its element is marked. */
export const VOICE_BAR = '[data-slot="voice-bar"]'

/**
 * A panel V works over, marked with the company it shows: call prep's, on a laptop (on a phone it
 * fills the screen and holds the page). The bar uses that company when a command names none.
 */
export const VOICE_PANEL = '[data-voice-company]'

/** Things that hold the keys while they are open. */
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

/** True while a dialog, a menu or a list box other than the voice bar or call prep is open. */
export function somethingElseOpen(): boolean {
  for (const element of document.querySelectorAll(OVERLAY)) {
    if (element.closest(VOICE_BAR) === null && !element.matches(VOICE_PANEL)) return true
  }
  return false
}

/** True for a plain V that is the voice bar's to take. */
export function isPlainV(event: KeyboardEvent): boolean {
  return (
    (event.key === 'v' || event.key === 'V') &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.repeat &&
    !event.defaultPrevented &&
    isVKeyOn() &&
    !isTyping(event) &&
    !somethingElseOpen()
  )
}
