/**
 * Runs `callback` once the browser has nothing better to do, or after a short wait where the
 * browser has no such call. For downloads that no one is waiting for yet (PLAN-V7 C2, D1).
 * Returns a function that cancels it, for a page that is left before the browser is idle.
 */
export function whenIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(callback, { timeout: 5000 })
    return () => {
      window.cancelIdleCallback(id)
    }
  }
  const id = window.setTimeout(callback, 3000)
  return () => {
    window.clearTimeout(id)
  }
}
