import { useEffect, useState } from 'react'

/**
 * How long a page waits before it shows loading shapes (PLAN-V7 B1). Most answers come faster, and
 * grey blocks that flash for 100 ms look worse than nothing.
 */
export const SKELETON_DELAY_MS = 200

/** False for `ms`, then true. */
export function useAfter(ms: number = SKELETON_DELAY_MS): boolean {
  const [done, setDone] = useState(ms <= 0)
  useEffect(() => {
    if (ms <= 0) {
      return undefined
    }
    const timer = window.setTimeout(() => {
      setDone(true)
    }, ms)
    return () => {
      window.clearTimeout(timer)
    }
  }, [ms])
  return done
}
