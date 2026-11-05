import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RouteObject } from 'react-router'
import { preloadNextPages } from './preload'

function routes() {
  const start = vi.fn(() => Promise.resolve({ Component: () => null }))
  const lead = vi.fn(() => Promise.resolve({ Component: () => null }))
  const login = vi.fn(() => Promise.resolve({ Component: () => null }))
  const tree: RouteObject[] = [
    { path: '/login', lazy: login },
    {
      path: '/',
      children: [
        { path: 'start', lazy: start },
        { path: 'leads/:leadId', lazy: lead },
      ],
    },
  ]
  return { tree, start, lead, login }
}

const idleNow = () => {
  vi.stubGlobal('requestIdleCallback', (run: () => void) => {
    run()
    return 0
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('preloading the pages people open next', () => {
  it('downloads the code of those pages once the browser is idle, and not the login page', async () => {
    idleNow()
    const { tree, start, lead, login } = routes()

    preloadNextPages(tree)

    await vi.waitFor(() => {
      expect(start).toHaveBeenCalledTimes(1)
      expect(lead).toHaveBeenCalledTimes(1)
    })
    expect(login).not.toHaveBeenCalled()
  })

  it('waits for the browser to be idle', () => {
    const waiting = vi.fn()
    vi.stubGlobal('requestIdleCallback', waiting)
    const { tree, start } = routes()

    preloadNextPages(tree)

    expect(waiting).toHaveBeenCalledTimes(1)
    expect(start).not.toHaveBeenCalled()
  })

  it('does nothing on a connection that asks to save data, or is slow', () => {
    idleNow()
    const { tree, start } = routes()
    for (const connection of [{ saveData: true }, { effectiveType: '2g' }]) {
      vi.stubGlobal('navigator', { ...navigator, connection })
      preloadNextPages(tree)
    }
    expect(start).not.toHaveBeenCalled()
  })
})
