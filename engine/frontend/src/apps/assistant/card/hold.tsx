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
 * starts.
 */
import { toast } from 'sonner'
import { HoldCountdown } from './countdown'
import type { CardAction } from './draft'
import { HOLD_TITLES, UNDO } from './words'

/** How long a send waits (choice 22). */
export const HOLD_MS = 5000

export interface HoldOptions {
  action: CardAction
  /** Runs once, after the hold, unless it was stopped. */
  send: () => void
  /** Undo: nothing goes, and the card opens again. */
  onUndo: () => void
  /** False once the person who started it has signed out: nothing more happens then. */
  stillSignedIn?: () => boolean
  ms?: number
}

/** Starts the hold. The returned function stops it without sending (the card's own tests). */
export function startHold({
  action,
  send,
  onUndo,
  stillSignedIn = () => true,
  ms = HOLD_MS,
}: HoldOptions): () => void {
  let over = false
  let timer = 0
  let id: string | number = ''
  // The page is going: nothing is sent, and the draft is already kept.
  const onPageHide = (): void => {
    stop()
  }
  function stop(): void {
    if (over) return
    over = true
    window.clearTimeout(timer)
    window.removeEventListener('pagehide', onPageHide)
    toast.dismiss(id)
  }
  id = toast(HOLD_TITLES[action], {
    description: <HoldCountdown ms={ms} />,
    // The hold keeps its own time: a toast's own timer stops while it is pointed at.
    duration: Infinity,
    action: {
      label: UNDO,
      onClick: () => {
        if (over) return
        stop()
        if (stillSignedIn()) onUndo()
      },
    },
  })
  timer = window.setTimeout(() => {
    if (over) return
    stop()
    if (stillSignedIn()) send()
  }, ms)
  window.addEventListener('pagehide', onPageHide)
  return stop
}
