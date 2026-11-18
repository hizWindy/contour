/**
 * Warming the rest of a project's pages (Improvements 1, #10: "no delay when switching things").
 * A person working in the Assistant moves between Today, Meetings and Call logs all day. Each
 * page is its own file of code and asks the server for its first lists, so the first click on a
 * page waited for both. While someone is on one page of a project that opts in (`AppModule.warm`),
 * this fetches the code and the first reads of its other pages, one page at a time, when the
 * browser is idle, so the click finds them.
 *
 * - **Only the project they are in,** and only one they may use (`visibleModules`), so it never
 *   asks for a page that would answer "Not open to you".
 * - **On Home, only the code** of the pages of the projects they may use, once. Home is where a day
 *   starts, and the first click into a project is the one that waits for code. Their first reads
 *   wait until a page of the project is open, because a page's first reads run on the server
 *   whether or not the person opens it.
 * - **Only for a project that opts in.** A project whose first reads are costly (the Lead Finder's
 *   lead counts) doesn't. It still has the preload on a point or a press (`intent.ts`).
 * - **Once, not on every page change:** the cache keeps an unused answer for 5 minutes, so the
 *   pages count as warm for 4. Moving on to a page of the same project inside that time asks nothing
 *   more. A page whose answer is older than 15 seconds shows what the cache has and refreshes it
 *   quietly, as it always does (React Query), so a warm page is never wrong for long.
 * - **Never on a connection that asks to save data or is slow,** and it stops when the person
 *   leaves the project.
 *
 * It does what a point on each link would do (`prefetchPage` and `loadCode`), so it needs no
 * knowledge of any page.
 */
import type { QueryClient } from '@tanstack/react-query'
import type { DataRouter } from 'react-router'
import { meQueryOptions, type SignIn } from '@/api/hooks/auth'
import { whenIdle } from '@/lib/idle'
import { HOME, isHere, type AppModule } from './nav'
import { prefetchPage } from './prefetch'
import { loadCode, sparing } from './preload'
import { visibleModules, visiblePages } from './visible-modules'

/** How long a project's pages count as warm: the cache keeps an unused answer for 5 minutes. */
export const WARM_FOR_MS = 4 * 60_000

/** The browser's next idle moment, to wait for between pages, so the downloads never crowd out what the person is doing. */
function quietly() {
  let cancel = (): void => undefined
  return {
    turn: (): Promise<void> =>
      new Promise((resolve) => {
        cancel = whenIdle(resolve)
      }),
    stop: (): void => {
      cancel()
    },
  }
}

/** Fetches the code, then the first reads, of each visible page of `module` but the one that is open. */
function warmPages(
  router: DataRouter,
  client: QueryClient,
  module: AppModule,
  signIn: SignIn,
): () => void {
  let stopped = false
  const idle = quietly()
  const pages = visiblePages(signIn, module.pages)
  const here = (): string => router.state.location.pathname
  const inModule = (): boolean => pages.some((page) => isHere(here(), page))

  void (async () => {
    for (const page of pages) {
      await idle.turn()
      if (stopped || !inModule()) return
      if (isHere(here(), page)) continue // the page on screen now
      // The code first: a page's data hooks live in it, and a click needs both.
      await loadCode(router.routes, [page.to]).catch(() => undefined)
      if (stopped || !inModule()) return
      prefetchPage(router.routes, { pathname: page.to, search: '' }, client)
    }
  })()

  return () => {
    stopped = true
    idle.stop()
  }
}

/** Fetches the code of these pages, and nothing else, one at a time. */
function warmCode(router: DataRouter, pages: readonly string[]): () => void {
  let stopped = false
  const idle = quietly()

  void (async () => {
    for (const to of pages) {
      await idle.turn()
      if (stopped) return
      await loadCode(router.routes, [to]).catch(() => undefined)
    }
  })()

  return () => {
    stopped = true
    idle.stop()
  }
}

/**
 * Starts watching the router: whenever a page of a warm project opens (the first page too), its
 * other pages are warmed, unless they were not long ago; and on Home, the code of those pages is.
 * Call once, after the first render. Returns a function that stops it.
 */
export function warmModulePages(
  router: DataRouter,
  client: QueryClient,
  modules: readonly AppModule[],
): () => void {
  let closed = false
  let seen: string | null = null
  let warmed: { id: string; at: number } | null = null
  let codeWarmed = false
  let stop = (): void => undefined
  let stopCode = (): void => undefined

  const look = (): void => {
    const pathname = router.state.location.pathname
    if (pathname === seen || sparing()) return
    seen = pathname
    // Who this is decides which projects they may use. It is asked once, at the start, and this
    // waits for that answer instead of asking again.
    void client
      .ensureQueryData(meQueryOptions())
      .then((signIn) => {
        if (closed) return
        const here = router.state.location.pathname
        const allowed = visibleModules(signIn, modules).filter((module) => module.warm === true)
        const module = allowed.find((candidate) =>
          visiblePages(signIn, candidate.pages).some((page) => isHere(here, page)),
        )
        if (module) {
          if (warmed?.id === module.id && Date.now() - warmed.at < WARM_FOR_MS) return
          warmed = { id: module.id, at: Date.now() }
          stop()
          stop = warmPages(router, client, module, signIn)
        } else if (here === HOME.to && !codeWarmed && allowed.length > 0) {
          codeWarmed = true
          stopCode = warmCode(
            router,
            allowed.flatMap((candidate) =>
              visiblePages(signIn, candidate.pages).map((page) => page.to),
            ),
          )
        }
      })
      .catch(() => undefined)
  }

  look()
  const unsubscribe = router.subscribe((state) => {
    // Once a navigation has settled: the page it opened is the one that is open.
    if (state.navigation.state === 'idle') look()
  })
  return () => {
    closed = true
    stop()
    stopCode()
    unsubscribe()
  }
}
