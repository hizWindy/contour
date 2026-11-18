/**
 * When V belongs to the voice bar (PLAN-V22 T3-1, "Decided in chat" 2). In the first visit, with
 * the key listener, so it stays small.
 *
 * V starts the bar only when no Ctrl, Cmd, Alt or Shift is held, it isn't a held key's repeat,
 * nobody is typing in a box or through an input method, and no other dialog, menu or list box is
 * open. So V in a box types a "v", Ctrl+V pastes, and Ctrl+K's list keeps its own keys.
 */
import { isTyping } from '@/lib/is-typing'

/** The bar itself, as its element is marked. */
export const VOICE_BAR = '[data-slot="voice-bar"]'

/** Things that hold the keys while they are open. */
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

/** True while a dialog, a menu or a list box other than the voice bar is open. */
export function somethingElseOpen(): boolean {
  for (const element of document.querySelectorAll(OVERLAY)) {
    if (element.closest(VOICE_BAR) === null) return true
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
    !isTyping(event) &&
    !somethingElseOpen()
  )
}
