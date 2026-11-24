/**
 * The 5 second hold before a send, as plain code with no screen of its own (PLAN-V22 choice 22,
 * shared since PLAN-V27 T3-2). The Assistant's card shows it in a toast (`apps/assistant/card/
 * hold.tsx`), and Results' bulk add to HubSpot in its preview dialog. Both run this one clock.
 *
 * - **Undo** stops it, and nothing is sent.
 * - **If the page closes in those 5 seconds, nothing is sent.** The timer dies with the page, and
 *   `pagehide` stops it too, so a page the browser keeps and brings back later (Back) never sends
 *   late.
 * - **Only the person who started it:** `stillSignedIn` is asked before `send` or `onUndo` runs,
 *   so a sign-out meanwhile stops it quietly.
 */

/** How long a send waits (PLAN-V22 choice 22, PLAN-V27 choice 14). */
export const HOLD_MS = 5000

export interface HoldTimerOptions {
  /** Runs once, after the hold, unless it was stopped. */
  send: () => void
  /** Runs once, when Undo stops it. */
  onUndo: () => void
  /** False once the person who started it has signed out: nothing more happens then. */
  stillSignedIn?: () => boolean
  /** Runs once when the hold ends, for any reason: to take its screen away. */
  onEnd?: () => void
  ms?: number
}

export interface HoldTimer {
  /** Stops it without sending, and without `onUndo` (the page or card is going). */
  stop: () => void
  /** Undo: stops it without sending, then `onUndo`. */
  undo: () => void
}

/** Starts the hold. Each way out runs once: the send, Undo or a stop. */
export function runHold({
  send,
  onUndo,
  stillSignedIn = () => true,
  onEnd,
  ms = HOLD_MS,
}: HoldTimerOptions): HoldTimer {
  let over = false
  const onPageHide = (): void => {
    stop()
  }
  function stop(): void {
    if (over) return
    over = true
    window.clearTimeout(timer)
    window.removeEventListener('pagehide', onPageHide)
    onEnd?.()
  }
  function undo(): void {
    if (over) return
    stop()
    if (stillSignedIn()) onUndo()
  }
  const timer = window.setTimeout(() => {
    if (over) return
    stop()
    if (stillSignedIn()) send()
  }, ms)
  window.addEventListener('pagehide', onPageHide)
  return { stop, undo }
}
