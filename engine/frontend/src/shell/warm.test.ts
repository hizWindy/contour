import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeIdle } from '@/test/fake-idle'
import { warmAfter, whenQuiet } from './warm'

/*
  Warming quietly (Improvements 1, #10): work that nobody is waiting for yet runs only when the
  browser is idle, never on a connection that asks to save data, and (for a page's next switches)
  only after the page's own request is in.
*/

/** A request that is on its way until the test says it is in. */
function onItsWay() {
  let arrive: () => void = () => undefined
  const request = new Promise<void>((resolve) => {
    arrive = resolve
  })
  return { request, arrive }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('quiet work', () => {
  it('runs when the browser is idle, and not before', () => {
    const browser = fakeIdle()
    const work = vi.fn()
    whenQuiet(work)
    expect(work).not.toHaveBeenCalled()
    browser.idle()
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('can be stopped before the browser is idle', () => {
    const browser = fakeIdle()
    const work = vi.fn()
    whenQuiet(work)()
    browser.idle()
    expect(work).not.toHaveBeenCalled()
  })

  it('is not done on a connection that asks to save data, or is slow', () => {
    const browser = fakeIdle()
    const work = vi.fn()
    for (const connection of [{ saveData: true }, { effectiveType: '2g' }]) {
      vi.stubGlobal('navigator', { ...navigator, connection })
      whenQuiet(work)
    }
    expect(browser.waiting()).toBe(0)
    browser.idle()
    expect(work).not.toHaveBeenCalled()
  })
})

describe("warming after a page's own request", () => {
  it('waits for the request, and then for the browser to be idle', async () => {
    const browser = fakeIdle()
    const next = vi.fn()
    const { request, arrive } = onItsWay()
    warmAfter(request, next)

    // Idle moments while the page's own request is still on its way are not taken.
    expect(browser.waiting()).toBe(0)
    arrive()
    await vi.waitFor(() => {
      expect(browser.waiting()).toBe(1)
    })
    expect(next).not.toHaveBeenCalled()
    browser.idle()
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('can be stopped before the request is in, and nothing is asked for', async () => {
    const browser = fakeIdle()
    const next = vi.fn()
    const { request, arrive } = onItsWay()
    const stop = warmAfter(request, next)
    stop()
    arrive()
    await request
    await Promise.resolve()
    expect(browser.waiting()).toBe(0)
    browser.idle()
    expect(next).not.toHaveBeenCalled()
  })

  it('can be stopped after the request is in, while it waits for the browser', async () => {
    const browser = fakeIdle()
    const next = vi.fn()
    const { request, arrive } = onItsWay()
    const stop = warmAfter(request, next)
    arrive()
    await vi.waitFor(() => {
      expect(browser.waiting()).toBe(1)
    })
    stop()
    expect(browser.waiting()).toBe(0)
    browser.idle()
    expect(next).not.toHaveBeenCalled()
  })

  it('asks for nothing when the page was left before the request was looked at', async () => {
    const browser = fakeIdle()
    const next = vi.fn()
    // A request that already finished: the stop comes before the first moment of the callback.
    const stop = warmAfter(Promise.resolve(), next)
    stop()
    await Promise.resolve()
    await Promise.resolve()
    browser.idle()
    expect(next).not.toHaveBeenCalled()
  })
})
