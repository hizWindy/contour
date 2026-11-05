/**
 * Runs `callback` once the browser has nothing better to do, or after a short wait where the
 * browser has no such call. For downloads that no one is waiting for yet (PLAN-V7 C2, D1).
 */
export function whenIdle(callback: () => void): void {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(callback, { timeout: 5000 })
  } else {
    window.setTimeout(callback, 3000)
  }
}
