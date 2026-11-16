/**
 * Warming what a person is likely to switch to next (Improvements 1, #10: "no delay when switching
 * things"). A switch costs a round trip to the server whenever the list it opens isn't there yet: a
 * tab, Upcoming or Past, a page of the menu. So once the page someone is on has its own data, the
 * likely next switches are asked for quietly, and the click finds them in the cache (React Query
 * shows what it has at once, and refreshes it in the background).
 *
 * - `whenQuiet`: only when the browser is idle, and never on a connection that asks to save data
 *   or is slow.
 * - `warmAfter`: only after the page's own request is in, so nothing started here can slow what the
 *   person is looking at.
 *
 * Warming asks for the same things the pages ask for (the same query options), so a switch joins a
 * request that is already running or finds the answer. It changes nothing a person can see.
 * `warm-module.ts` does the same for the other pages of the project someone is working in.
 */
import { whenIdle } from '@/lib/idle'
import { sparing } from './preload'

/** Runs `work` once the browser is idle, unless the connection is sparing. Returns a way to stop it. */
export function whenQuiet(work: () => void): () => void {
  if (sparing()) {
    return () => undefined
  }
  return whenIdle(work)
}

/**
 * Runs `next` once `own` (the request the page is waiting for, joined and not repeated) has
 * finished and the browser is idle. Returns a way to stop it, for a page that is left first.
 */
export function warmAfter(own: Promise<unknown>, next: () => void): () => void {
  let stopped = false
  let cancel = (): void => undefined
  const go = (): void => {
    if (!stopped) {
      cancel = whenQuiet(next)
    }
  }
  // A failed request ends the wait too, but `prefetchQuery` never fails: it keeps the error in the
  // query, where the page reads it.
  void own.then(go, () => undefined)
  return () => {
    stopped = true
    cancel()
  }
}
