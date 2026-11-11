/**
 * Reloading the page (PLAN-V15 T2-4).
 *
 * After a deploy, a page that was already open asks for code files the new version no longer has.
 * One reload fixes that: it fetches the new version. So the first time a page's code fails to
 * load, the page reloads by itself. A mark in `sessionStorage` (this tab only) says it just did,
 * so a page whose code still fails doesn't reload forever: it says "Contour was updated" instead,
 * with a Reload button.
 *
 * `browser.reload` is an object method, so a test can stand in for it (jsdom can't reload).
 */
export const browser = {
  reload(): void {
    window.location.reload()
  },
}

const MARK = 'contour.reloaded-for-new-code'

/** A mark older than this is from an earlier deploy, not from the reload just done. */
const MARK_FRESH_MS = 60_000

function readMark(): number | null {
  try {
    const value = Number(window.sessionStorage.getItem(MARK))
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null // storage blocked: treat it as no mark
  }
}

/**
 * True when a reload for a new version may happen now: none was done in the last minute, and the
 * mark can be kept (with storage blocked it couldn't tell, so it never reloads by itself).
 */
export function mayReloadForNewCode(now: number = Date.now()): boolean {
  const mark = readMark()
  if (mark !== null && now - mark < MARK_FRESH_MS) {
    return false
  }
  try {
    window.sessionStorage.setItem(`${MARK}-check`, '1')
    window.sessionStorage.removeItem(`${MARK}-check`)
    return true
  } catch {
    return false
  }
}

/** Marks the reload, then reloads. Call it only for the page on screen, never from a preload. */
export function reloadForNewCode(now: number = Date.now()): void {
  try {
    window.sessionStorage.setItem(MARK, String(now))
  } catch {
    return
  }
  browser.reload()
}

/** What browsers and Vite say when a code file can't be fetched. */
const CODE_LOAD =
  /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk|Unable to preload CSS/i

/**
 * True when this error is a page's code that couldn't be fetched (not a bug inside it). The
 * browser's error may come wrapped in another one (`cause`), so those are read too.
 */
export function isCodeLoadError(error: unknown, depth = 0): boolean {
  if (!(error instanceof Error) || depth > 3) {
    return false
  }
  return CODE_LOAD.test(error.message) || isCodeLoadError(error.cause, depth + 1)
}
