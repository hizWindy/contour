/**
 * Breadcrumbs. A route names itself with `handle.crumb`, a word or a function of the address's
 * values, and the top bar shows the crumbs of every route that matches, in order.
 */
import type { Params, UIMatch } from 'react-router'

export interface RouteHandle {
  crumb?: string | ((params: Params) => string)
}

export interface Crumb {
  /** Where the crumb links to. */
  to: string
  label: string
}

function handleOf(match: UIMatch): RouteHandle | undefined {
  const handle: unknown = match.handle
  // Every key of RouteHandle is optional, so any object fits; `crumb` is checked where it is read.
  return typeof handle === 'object' && handle !== null ? handle : undefined
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
