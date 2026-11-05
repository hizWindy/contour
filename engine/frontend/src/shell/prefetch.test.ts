import { QueryClient } from '@tanstack/react-query'
import { createMemoryRouter, type RouteObject } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { PrefetchArgs } from './crumbs'
import { prefetchOnNavigation, prefetchPage } from './prefetch'

describe("starting a page's first requests", () => {
  it('runs the prefetch of the page at an address, with its values and search', () => {
    const prefetch = vi.fn<(args: PrefetchArgs) => void>()
    const routes: RouteObject[] = [
      { path: '/', children: [{ path: 'leads/:leadId', handle: { prefetch } }] },
    ]
    const client = new QueryClient()

    prefetchPage(routes, { pathname: '/leads/abc', search: '?result=fit' }, client)

    expect(prefetch).toHaveBeenCalledTimes(1)
    const args = prefetch.mock.calls[0]?.[0]
    expect(args?.client).toBe(client)
    expect(args?.params).toEqual({ leadId: 'abc' })
    expect(args?.search.get('result')).toBe('fit')
  })

  it('runs the prefetch of every route that matches, parent first', () => {
    const order: string[] = []
    const routes: RouteObject[] = [
      {
        path: 'runs',
        handle: { prefetch: () => order.push('parent') },
        children: [{ path: ':runId', handle: { prefetch: () => order.push('child') } }],
      },
    ]

    prefetchPage(routes, { pathname: '/runs/r1', search: '' }, new QueryClient())

    expect(order).toEqual(['parent', 'child'])
  })

  it('does nothing for an address that no route has, or a route that has no prefetch', () => {
    const routes: RouteObject[] = [
      { path: '/plain', handle: { crumb: 'Plain' } },
      { path: '/bare' },
    ]
    const client = new QueryClient()

    expect(() => {
      prefetchPage(routes, { pathname: '/nowhere', search: '' }, client)
      prefetchPage(routes, { pathname: '/plain', search: '' }, client)
      prefetchPage(routes, { pathname: '/bare', search: '' }, client)
    }).not.toThrow()
  })

  it('keeps going when one prefetch fails: a hint must not break a navigation', () => {
    const later = vi.fn()
    const routes: RouteObject[] = [
      {
        path: 'a',
        handle: {
          prefetch: () => {
            throw new Error('a bug in a hint')
          },
        },
        children: [{ path: 'b', handle: { prefetch: later } }],
      },
    ]

    expect(() => {
      prefetchPage(routes, { pathname: '/a/b', search: '' }, new QueryClient())
    }).not.toThrow()
    expect(later).toHaveBeenCalledTimes(1)
  })
})

/** A route table with one page whose code arrives only when the test lets it. */
function pages() {
  let release: () => void = () => undefined
  const codeArrives = new Promise<void>((resolve) => {
    release = resolve
  })
  const home = vi.fn()
  const start = vi.fn()
  const routes: RouteObject[] = [
    { path: '/', handle: { prefetch: home }, Component: () => null },
    {
      path: '/start',
      handle: { prefetch: start },
      lazy: async () => {
        await codeArrives
        return { Component: () => null }
      },
    },
  ]
  return { routes, home, start, release }
}

describe('starting early when a navigation starts (PLAN-V7 C1)', () => {
  it('starts the page that is open now', () => {
    const { routes, home } = pages()
    const router = createMemoryRouter(routes, { initialEntries: ['/'] })

    prefetchOnNavigation(router, new QueryClient())

    expect(home).toHaveBeenCalledTimes(1)
  })

  it('starts a page when the navigation to it starts, before its code has arrived', async () => {
    const { routes, home, start, release } = pages()
    const router = createMemoryRouter(routes, { initialEntries: ['/'] })
    prefetchOnNavigation(router, new QueryClient())
    expect(start).not.toHaveBeenCalled()

    const arrived = router.navigate('/start')

    // The code is still on its way: the router has not moved yet, and the data has started.
    expect(router.state.location.pathname).toBe('/')
    expect(start).toHaveBeenCalledTimes(1)
    release()
    await arrived
    expect(router.state.location.pathname).toBe('/start')
    expect(start).toHaveBeenCalledTimes(1)
    expect(home).toHaveBeenCalledTimes(1)
  })

  it('starts a page that is opened by its address while its code downloads', () => {
    const { routes, start } = pages()
    const router = createMemoryRouter(routes, { initialEntries: ['/start'] })

    prefetchOnNavigation(router, new QueryClient())

    expect(start).toHaveBeenCalledTimes(1)
  })

  it('stops when told to', async () => {
    const { routes, start, release } = pages()
    const router = createMemoryRouter(routes, { initialEntries: ['/'] })
    const stop = prefetchOnNavigation(router, new QueryClient())

    stop()
    release()
    await router.navigate('/start')

    expect(start).not.toHaveBeenCalled()
  })
})
