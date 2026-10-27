import { vi } from 'vitest'

/**
 * Makes the test window a phone: every `max-width` media query matches (the phone, the tablet and
 * the under-a-laptop ones) and no `min-width` query does, and the pointer is a finger. The spy
 * goes away after the test (vite.config.ts restores mocks).
 *
 *     asPhone()
 *     renderWithProviders(<Page />)
 */
export function asPhone(): void {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string): MediaQueryList => ({
    matches: query.includes('max-width') || query.includes('pointer: coarse'),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }))
}

/** A wide screen: every `min-width` query matches (a laptop), no `max-width` one does. */
export function asLaptop(): void {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string): MediaQueryList => ({
    matches: query.includes('min-width'),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }))
}
