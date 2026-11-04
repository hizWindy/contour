import { useSyncExternalStore } from 'react'

/** A phone: narrower than Tailwind's `sm` (640px). */
export const PHONE = '(max-width: 639px)'

/** The computer asks for less motion. CSS animations stop by themselves (index.css); `motion`'s
 * animations in JavaScript check this. */
export const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

/**
 * True while the screen matches a CSS media query, and it updates when the window changes. For
 * what CSS alone can't do: a different set of controls on a phone, not just a different size.
 * Server rendering (none here) and tests with no `matchMedia` count as "no match".
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => {
        list.removeEventListener('change', onChange)
      }
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
