/**
 * Quiet preloading of page code (PLAN-V7 C2, the code part). A page's code downloads when its
 * route is opened, so the first click on a menu page waited for it. Once the first screen is up
 * and the browser is idle, this downloads the code of the pages people open next, so the click
 * finds it already there.
 *
 * Only the Lead Finder's menu pages and the lead and run pages: not the sign-in page, and not
 * Admin, whose chart library is big and which few people open. Never on a connection that asks to
 * save data or is slow. Calling a route's `lazy` early is safe: the browser keeps each module, so
 * the router's own call, later, finds it done.
 */
import { matchRoutes, type RouteObject } from 'react-router'
import { whenIdle } from '@/lib/idle'

/** Addresses that match a page, not real ones: "/leads/x" is the lead page. */
export const NEXT_PAGES: readonly string[] = [
  '/start',
  '/runs',
  '/results',
  '/rules',
  '/test-set',
  '/runs/x',
  '/leads/x',
]

interface NetworkInformation {
  saveData?: boolean
  effectiveType?: string
}

/** True on a connection that asked to save data, or is slow. */
export function sparing(): boolean {
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection
  return (
    connection?.saveData === true || ['slow-2g', '2g'].includes(connection?.effectiveType ?? '')
  )
}

/** Starts the downloads, one after another, so they never crowd out what a person clicked. */
export async function loadCode(routes: RouteObject[], pages: readonly string[]): Promise<void> {
  for (const page of pages) {
    for (const match of matchRoutes(routes, page) ?? []) {
      const { lazy } = match.route
      if (typeof lazy === 'function') {
        await lazy()
      }
    }
  }
}

/** Call once, after the first render. */
export function preloadNextPages(
  routes: RouteObject[],
  pages: readonly string[] = NEXT_PAGES,
): void {
  if (sparing()) {
    return
  }
  whenIdle(() => {
    void loadCode(routes, pages)
  })
}
