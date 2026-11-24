/**
 * The 5 second hold before a send (PLAN-V22 T3-4, choice 22, "How it should look and move"): Enter
 * or "send it" on the card starts it. A toast says what goes, with a bar that empties once over
 * the 5 seconds (a real countdown, never a loop) and Undo. Undo stops it, and the card opens
 * again with the draft. Then the send runs once.
 *
 * - **If the page closes in those 5 seconds, nothing is sent** (choice 22). The timer dies with
 *   the page, and `pagehide` stops it too, so a page the browser keeps and brings back later
 *   (Back) never sends late. A task or an email is kept in this browser from the moment the hold
 *   starts (`drafts.ts`); a call's note waits in Call logs.
 * - **Only the rep who started it:** a sign-out meanwhile stops it, as a toast's Undo in call notes
 *   acts only for the person who saved.
 * - **Moves:** only the bar's `scaleX`, from full to empty, at an even speed, because it is a clock.
 *   With reduced motion there is no bar, and the words count the seconds.
 *
 * Plain code with one small toast part, so it outlives the card: the card closes as the hold
 * starts. The clock itself (the timer, `pagehide`, the sign-out check) is `lib/hold.ts`.
 */
import { toast } from 'sonner'
import { HOLD_MS, runHold } from '@/lib/hold'
import { HoldCountdown } from './countdown'
import type { CardAction } from './draft'
import { inTextBox } from './keys'
import { HOLD_TITLES, UNDO } from './words'

/** Things that keep Esc for themselves while they are open: a dialog, a menu or a list. */
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

export interface HoldOptions {
  action: CardAction
  /**
   * What goes, in the toast's title. Left out: the action's own ("Sending the call to HubSpot"). A
   * quick log says exactly what goes (PLAN-V25 T3-3): the toast is its preview.
   */
  title?: string
  /** Runs once, after the hold, unless it was stopped. */
  send: () => void
  /** Undo: nothing goes, and the card opens again. */
  onUndo: () => void
  /** False once the person who started it has signed out: nothing more happens then. */
  stillSignedIn?: () => boolean
  ms?: number
}

/**
 * Starts the hold, in a toast. The clock is the shared one (`lib/hold.ts`, also used by Results'
 * bulk add to HubSpot). The returned function stops it without sending (the card's own tests).
 */
export function startHold({
  action,
  title,
  send,
  onUndo,
  stillSignedIn,
  ms = HOLD_MS,
}: HoldOptions): () => void {
  let id: string | number = ''
  const hold = runHold({
    send,
    onUndo,
    stillSignedIn,
    ms,
    onEnd: () => {
      document.removeEventListener('keydown', onKey, true)
      toast.dismiss(id)
    },
  })
  // Esc undoes it from the keyboard (TBC at Al-khair's look): only while it runs, not in a box,
  // and not while a dialog, a menu or a list is open, whose own Esc it is.
  function onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented || inTextBox(event.target)) return
    if (document.querySelector(OVERLAY) !== null) return
    event.preventDefault()
    event.stopPropagation()
    hold.undo()
  }
  id = toast(title ?? HOLD_TITLES[action], {
    description: <HoldCountdown ms={ms} />,
    // The hold keeps its own time: a toast's own timer stops while it is pointed at.
    duration: Infinity,
    action: { label: UNDO, onClick: hold.undo },
  })
  document.addEventListener('keydown', onKey, true)
  return hold.stop
}
