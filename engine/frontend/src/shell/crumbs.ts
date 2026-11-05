/**
 * Breadcrumbs. A route names itself with `handle.crumb`, a word or a function of the address's
 * values, and the top bar shows the crumbs of every route that matches, in order.
 *
 * The same `handle` can also say what the page asks for first (`prefetch`, run by
 * shell/prefetch.ts), so the data downloads while the page's code does.
 */
import type { QueryClient } from '@tanstack/react-query'
import type { Params, UIMatch } from 'react-router'

/** What `handle.prefetch` is given: the query client, the address's route values, its search. */
export interface PrefetchArgs {
  client: QueryClient
  params: Params
  search: URLSearchParams
}

export interface RouteHandle {
  crumb?: string | ((params: Params) => string)
  /**
   * Starts the requests this page makes first (`client.prefetchQuery(...)`). It must use the same
   * query options as the page, so the page's own request joins the one already running, and it
   * must not wait for anything: the page opens as soon as its code is there.
   */
  prefetch?: (args: PrefetchArgs) => void
}

export interface Crumb {
  /** Where the crumb links to. */
  to: string
  label: string
}

/** A route's `handle` as a `RouteHandle`, or nothing when the route has none. */
export function routeHandle(handle: unknown): RouteHandle | undefined {
  // Every key of RouteHandle is optional, so any object fits; each key is checked where it is read.
  return typeof handle === 'object' && handle !== null ? handle : undefined
}

function handleOf(match: UIMatch): RouteHandle | undefined {
  return routeHandle(match.handle)
}

/** The crumbs for the routes that match now. A route with no crumb adds none. */
export function crumbsOf(matches: readonly UIMatch[]): Crumb[] {
  const crumbs: Crumb[] = []
  for (const match of matches) {
    const crumb = handleOf(match)?.crumb
    if (crumb === undefined) {
      continue
    }
    const label = typeof crumb === 'function' ? crumb(match.params) : crumb
    const last = crumbs.at(-1)
    if (last?.label === label) {
      last.to = match.pathname // an index route repeats its parent: keep one
      continue
    }
    crumbs.push({ to: match.pathname, label })
  }
  return crumbs
}
