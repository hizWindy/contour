import '@testing-library/jest-dom/vitest'
import { randomUUID } from 'node:crypto'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { FakeEventSource } from './fake-event-source'
import { withRelativeUrlsFetch, withRelativeUrlsRequest } from './relative-urls'

/*
  Test setup, run before every test file (see `test.setupFiles` in vite.config.ts).
  jsdom has no layout, no media queries and no EventSource, and several parts we use (Radix,
  cmdk, Recharts, the sidebar) call those. Each polyfill below is the smallest stub that makes
  them work. Nothing here changes how the code behaves in a real browser.

  Browser only. All of the polyfills sit behind `typeof window !== 'undefined'`. A test file that
  starts with `// @vitest-environment node` (for example one that drives ESLint or reads files)
  has no window, so it gets the jest-dom matchers and the clean-up of timers, and nothing else:
  no polyfills, no fake EventSource and no relative URL support. src/test/node-environment.test.ts
  proves that such a file loads.

  Timers. A test that calls `vi.useFakeTimers()` and forgets `vi.useRealTimers()` would leave the
  next test with a frozen clock. The afterEach below always puts the real timers back, after every
  test. So call `vi.useFakeTimers()` or `startManualClock()` inside each test or in a `beforeEach`,
  never in a `beforeAll`: a clock started once is gone after the first test. How to use fake
  timers in a test is written at the top of render.tsx.

  Relative API URLs. The site calls the API on the relative base "/api/v1". Node's Request and
  fetch cannot resolve that (they throw "Failed to parse URL"), and openapi-fetch builds a Request
  before it calls any custom fetch, so a mocked fetch does not help. This file wraps both so a
  string that is not an absolute URL is resolved against the page URL, as a browser does. Write
  tests with the real client and baseUrl "/api/v1", never an absolute URL. Details in
  relative-urls.ts.

  Uploads (for the HubSpot upload test). A file inside a FormData does not survive being turned
  into a Request under jsdom (checked with vitest 5.0.5 and jsdom 30.1.3). On the Request, the part
  is named "blob" instead of its file name, its bytes are empty, and request.formData() throws. So
  do not read the upload back from the Request that a mock fetch receives. Instead, test the
  bodySerializer by itself: it returns a FormData, and form.get('file') still has the right name,
  size and text. At the client level, assert the method, the URL and a content-type that starts
  with multipart/form-data (see relative-urls.test.ts).

  Leaks between tests. vite.config.ts sets `restoreMocks`, `clearMocks`, `unstubGlobals` and
  `unstubEnvs`, so a `vi.spyOn`, a `vi.stubGlobal` and a `vi.stubEnv` never outlive their test.
  Assigning to `globalThis` by hand is not covered: use `vi.stubGlobal` instead.
*/

const inBrowserEnvironment = typeof window !== 'undefined'

function installBrowserPolyfills(): void {
  // matchMedia: always "no match" (light, motion allowed). Used by the sidebar and by theme code.
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })
  }

  // ResizeObserver: Radix, cmdk and Recharts' ResponsiveContainer need one. It never fires.
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
  }

  // IntersectionObserver: same idea.
  if (typeof globalThis.IntersectionObserver === 'undefined') {
    globalThis.IntersectionObserver = class IntersectionObserver {
      readonly root = null
      readonly rootMargin = ''
      readonly thresholds: readonly number[] = []
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return []
      }
    }
  }

  // PointerEvent: Radix reads pointerId and pointerType. user-event sends these.
  if (typeof globalThis.PointerEvent === 'undefined') {
    globalThis.PointerEvent = class PointerEvent extends MouseEvent {
      readonly pointerId: number
      readonly pointerType: string
      readonly isPrimary: boolean
      readonly width: number
      readonly height: number
      readonly pressure: number
      readonly tangentialPressure: number
      readonly tiltX: number
      readonly tiltY: number
      readonly twist: number
      readonly altitudeAngle: number
      readonly azimuthAngle: number

      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init)
        this.pointerId = init.pointerId ?? 0
        this.pointerType = init.pointerType ?? 'mouse'
        this.isPrimary = init.isPrimary ?? true
        this.width = init.width ?? 1
        this.height = init.height ?? 1
        this.pressure = init.pressure ?? 0
        this.tangentialPressure = init.tangentialPressure ?? 0
        this.tiltX = init.tiltX ?? 0
        this.tiltY = init.tiltY ?? 0
        this.twist = init.twist ?? 0
        this.altitudeAngle = init.altitudeAngle ?? 0
        this.azimuthAngle = init.azimuthAngle ?? 0
      }

      getCoalescedEvents(): PointerEvent[] {
        return []
      }

      getPredictedEvents(): PointerEvent[] {
        return []
      }
    }
  }

  // Element methods that jsdom leaves out. Radix Select and cmdk call these.
  Element.prototype.scrollIntoView = function scrollIntoView(): void {}
  Element.prototype.hasPointerCapture = function hasPointerCapture(): boolean {
    return false
  }
  Element.prototype.setPointerCapture = function setPointerCapture(): void {}
  Element.prototype.releasePointerCapture = function releasePointerCapture(): void {}
  window.scrollTo = function scrollTo(): void {}

  // Blob URLs, for the CSV download (fetch, then a blob, then a link).
  if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = () => 'blob:http://localhost/test'
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    URL.revokeObjectURL = () => undefined
  }

  // randomUUID: the Idempotency-Key for "Start run". Node has it, and jsdom may hide it.
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: randomUUID,
      configurable: true,
    })
  }

  // The fake EventSource (see fake-event-source.ts). Tests read FakeEventSource.instances.
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource

  // Relative URLs: the API base is "/api/v1", and Node's Request and fetch cannot resolve it.
  // The wrappers resolve against document.baseURI, so they belong to the browser side only.
  // See relative-urls.ts.
  globalThis.Request = withRelativeUrlsRequest(globalThis.Request)
  globalThis.fetch = withRelativeUrlsFetch(globalThis.fetch)
}

if (inBrowserEnvironment) {
  installBrowserPolyfills()
}

beforeEach(() => {
  FakeEventSource.reset()
})

afterEach(() => {
  if (inBrowserEnvironment) {
    cleanup()
    FakeEventSource.reset()
    document.documentElement.removeAttribute('data-theme')
    document.body.removeAttribute('style')
  }
  // A test that turned on fake timers and did not turn them off must not freeze the next one.
  vi.useRealTimers()
})
