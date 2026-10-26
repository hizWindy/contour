// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { FakeEventSource } from './fake-event-source'
import { RELATIVE_URLS } from './relative-urls'

/*
  A test file that starts with the line above runs with no window and no document. setup.ts is
  still loaded for it, and used to crash on `window.matchMedia`. This file loads, so the guard
  in setup.ts works. It also checks what a node test does and does not get.
*/
describe('setup.ts in the node environment', () => {
  it('has no window and no document', () => {
    expect(typeof window).toBe('undefined')
    expect(typeof document).toBe('undefined')
  })

  it('leaves the browser polyfills out', () => {
    expect(globalThis.EventSource).not.toBe(FakeEventSource)
    expect(RELATIVE_URLS in globalThis.fetch).toBe(false)
    expect(RELATIVE_URLS in globalThis.Request).toBe(false)
  })

  it('still gives the jest-dom matchers and the vitest mocks', () => {
    const spy = vi.fn()
    spy('a')

    expect(spy).toHaveBeenCalledWith('a')
    // A missing matcher would throw "is not a function". The real one complains about the value.
    expect(() => expect(null).toBeInTheDocument()).toThrow(/HTMLElement/)
  })

  it('puts the real timers back after a test that forgot to', () => {
    vi.useFakeTimers()

    expect(vi.isFakeTimers()).toBe(true)
  })

  it('starts the next test with real timers', () => {
    expect(vi.isFakeTimers()).toBe(false)
  })
})
