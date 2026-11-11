import { waitFor } from '@testing-library/react'
import type { ComponentType } from 'react'
import { Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/api/query'
import { routes } from '@/router'
import { prefetchPage } from '@/shell/prefetch'
import { createTestQueryClient, renderWithProviders } from '@/test/render'

/** Counts every request by its address and never answers, so a request stays "in flight". */
function stalledBackend(): Map<string, number> {
  const calls = new Map<string, number>()
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request) => {
      const url = new URL(request.url)
      const key = `${url.pathname.replace('/api/v1', '')}${url.search}`
      calls.set(key, (calls.get(key) ?? 0) + 1)
      return new Promise<Response>(() => undefined)
    }),
  )
  return calls
}

interface PageCase {
  name: string
  /** The address a person opens. */
  address: string
  /** The route pattern the page sits at. */
  pattern: string
  page: () => Promise<{ default: ComponentType }>
}

const PAGES: PageCase[] = [
  { name: 'Home', address: '/', pattern: '/', page: () => import('@/shell/home') },
  { name: 'Start', address: '/start', pattern: '/start', page: () => import('./start') },
  { name: 'Runs', address: '/runs', pattern: '/runs', page: () => import('./run/list') },
  { name: 'A run', address: '/runs/r1', pattern: '/runs/:runId', page: () => import('./run') },
  {
    name: 'Results',
    address: '/results',
    pattern: '/results',
    page: () => import('./results'),
  },
  {
    name: 'Results with filters, a sort, a page and a lead open',
    address: '/results?result=fit&city=Perth&sort=name&order=asc&page=3&lead=l1',
    pattern: '/results',
    page: () => import('./results'),
  },
  {
    name: 'Results in the map view, which also asks for the map',
    address: '/results?view=map&city=Perth',
    pattern: '/results',
    page: () => import('./results'),
  },
  {
    name: 'A lead',
    address: '/leads/l1',
    pattern: '/leads/:leadId',
    page: () => import('./lead'),
  },
  { name: 'Rules', address: '/rules', pattern: '/rules', page: () => import('./rules') },
]

describe('a page uses what is started for it while its code downloads (PLAN-V7 C1)', () => {
  it.each(PAGES)('$name', async ({ address, pattern, page }) => {
    const calls = stalledBackend()
    const client = createTestQueryClient()
    // Every page sits behind the sign-in guard, so who is signed in is known before it draws
    // (PLAN-V15 T2-5: Home offers no project while it isn't). Here: sign-in is off.
    client.setQueryData(queryKeys.auth.me(), { state: 'off' })
    const Page = (await page()).default
    const [pathname = '/', search = ''] = address.split(/(?=\?)/)

    // The click: the navigation starts, and the early requests go out.
    prefetchPage(routes, { pathname, search }, client)
    const early = [...calls.keys()]
    expect(early.length).toBeGreaterThan(0)

    // The code has arrived and the page draws.
    renderWithProviders(
      <Routes>
        <Route path={pattern} element={<Page />} />
      </Routes>,
      { route: address, queryClient: client },
    )

    // Every early request was joined by the page, so each was made once, not twice...
    await waitFor(() => {
      for (const key of early) {
        expect(calls.get(key), key).toBe(1)
      }
    })
    // ...and the page uses all of them: nothing was started for nothing. (Who is signed in was
    // known before the page, so it isn't one of them.)
    for (const query of client.getQueryCache().getAll()) {
      if (query.queryKey[0] === 'auth') continue
      expect(query.getObserversCount(), JSON.stringify(query.queryKey)).toBeGreaterThan(0)
    }
  })
})
