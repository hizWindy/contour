/**
 * Starting a page's first requests early (PLAN-V7 C1). A page's code is its own file, and its data
 * used to be asked for only after that file had arrived and the page had drawn, so a click waited
 * twice. A route's `handle.prefetch` says what its page asks for first (see shell/crumbs.ts). When
 * a navigation starts, this runs it, so the code and the data download at the same time.
 *
 * It only starts the requests and never waits for them. The page still opens as soon as its code is
 * there, shows its skeleton, and fills in when the data arrives. The page asks with the same query
 * options, so its own request joins the one already running (TanStack Query makes one request for
 * one key). If an early request fails, the page simply asks again.
 */
import type { QueryClient } from '@tanstack/react-query'
import { matchRoutes, type DataRouter, type Location, type RouteObject } from 'react-router'
import { routeHandle } from './crumbs'

/** The part of an address a page's requests depend on. */
export type PageAddress = Pick<Location, 'pathname' | 'search'>

/** Starts the first requests of the page at `address`, if its route says what they are. */
export function prefetchPage(
  routes: RouteObject[],
  address: PageAddress,
  client: QueryClient,
): void {
  const search = new URLSearchParams(address.search)
  for (const match of matchRoutes(routes, address.pathname) ?? []) {
    try {
      routeHandle(match.route.handle)?.prefetch?.({ client, params: match.params, search })
    } catch {
      // A hint must never break a navigation. The page asks for its own data anyway.
    }
  }
}

/**
 * Runs `prefetchPage` for the page that is open now (a page opened by its address) and for every
 * page a navigation starts to open, at the moment it starts. Returns a function that stops it.
 */
export function prefetchOnNavigation(router: DataRouter, client: QueryClient): () => void {
  let lastKey: string | null = null
  const start = (address: Location): void => {
    if (address.key !== lastKey) {
      lastKey = address.key
      prefetchPage(router.routes, address, client)
    }
  }
  start(router.state.location)
  return router.subscribe((state) => {
    if (state.navigation.state !== 'idle') {
      start(state.navigation.location)
    }
  })
}
