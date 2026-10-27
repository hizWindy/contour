import { useEffect, useState } from 'react'

/**
 * `value`, but only after it has stayed the same for `delayMs`. A form that asks the server as
 * the person types (the Start page's estimate) uses it, so one request goes out per pause, not
 * per key. The first value is returned at once.
 */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value)
    }, delayMs)
    return () => {
      clearTimeout(timer)
    }
  }, [value, delayMs])
  return settled
}
