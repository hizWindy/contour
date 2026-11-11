import { useEffect, useState } from 'react'
import { RETRY_EVERY_MS } from '@/api/connection'

/**
 * Whole seconds until `at` (ms since 1970), ticking once a second; `null` when nothing waits. The
 * clock may be up to a second behind when `at` changes, so the count never shows more than the
 * wait between two checks.
 */
export function useSecondsLeft(at: number | null): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (at === null) return
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => {
      clearInterval(timer)
    }
  }, [at])
  if (at === null) return null
  const left = Math.ceil((at - now) / 1000)
  return Math.max(0, Math.min(left, RETRY_EVERY_MS / 1000))
}

/** "Checking again in 7 seconds." or "Checking now." */
export function checkingWords(seconds: number | null): string | null {
  if (seconds === null) return null
  if (seconds <= 0) return 'Checking now.'
  return `Checking again in ${String(seconds)} ${seconds === 1 ? 'second' : 'seconds'}.`
}
