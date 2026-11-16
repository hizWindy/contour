import { vi } from 'vitest'

/**
 * A browser whose idle moments a test hands out, one `idle()` at a time, and that remembers what
 * was cancelled (`requestIdleCallback`, as the quiet preloading and warming use it). The globals
 * are put back after each test (`unstubGlobals` in vite.config.ts).
 */
export function fakeIdle() {
  const waiting = new Map<number, () => void>()
  let next = 1
  vi.stubGlobal('requestIdleCallback', (run: () => void): number => {
    waiting.set(next, run)
    return next++
  })
  vi.stubGlobal('cancelIdleCallback', (id: number): void => {
    waiting.delete(id)
  })
  return {
    /** How many idle moments are being waited for. */
    waiting: (): number => waiting.size,
    /** The browser has nothing better to do: everything waiting for it runs. */
    idle: (): void => {
      for (const [id, run] of [...waiting]) {
        waiting.delete(id)
        run()
      }
    },
  }
}
