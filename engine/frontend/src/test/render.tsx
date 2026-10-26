/**
 * Test helpers for components: `renderWithProviders`, `createTestQueryClient` and
 * `startManualClock`.
 *
 * `renderWithProviders(ui, options)` renders `ui` the way the app does: inside a QueryClient
 * (retries off), a memory router, the tooltip provider that shadcn parts need and the toast host.
 * It returns everything from Testing Library's `render`, plus `queryClient` and `user` (a
 * user-event instance made for this render).
 *
 * Options
 *   route, initialEntries   where the memory router starts (ignored when `withRouter` is false)
 *   queryClient             your own client, to prefill the cache or to inspect it afterwards
 *   userEventOptions        passed to `userEvent.setup()`, for example `{ delay: null }`
 *   withRouter              default true. Pass false to skip the MemoryRouter, so the test can
 *                           bring its own router. A data router needs this:
 *
 *     const router = createMemoryRouter([{ path: '/', lazy: async () => ({ Component: Page }) }])
 *     renderWithProviders(<RouterProvider router={router} />, { withRouter: false })
 *     expect(await screen.findByText('Page loaded')).toBeInTheDocument()
 *
 *   Two routers cannot be nested, so `<RouterProvider>` inside the default MemoryRouter throws.
 *   `lazy` routes, loaders, actions and `router.navigate()` all need a data router.
 *
 * Fake timers (a debounce, a poll, a reconnect backoff). Testing Library only knows Jest's fake
 * timers. With plain `vi.useFakeTimers()` its own `setTimeout(0)` pauses never fire, so
 * `user.type`, `findBy*` and `waitFor` hang until the test times out. Use one of two ways. Both
 * are tried in harness.test.tsx, and setup.ts puts the real timers back after every test.
 *
 * Where to start the clock: call `vi.useFakeTimers()` or `startManualClock()` inside each test,
 * or in a `beforeEach`, and before `renderWithProviders`. Never in `beforeAll` (or at the top of a
 * `describe`): setup.ts resets the clock after every test, so a clock started once would be gone
 * from the second test on.
 *
 *   1. Easy, and the one to use unless you need an exact edge: the fake clock also moves with
 *      the real one.
 *
 *        vi.useFakeTimers({ shouldAdvanceTime: true })
 *        const { user } = renderWithProviders(<Search />)
 *        await user.type(screen.getByRole('textbox'), 'abc')
 *        await act(async () => {
 *          await vi.advanceTimersByTimeAsync(300)
 *        })
 *        expect(screen.getByText('Results for abc')).toBeInTheDocument()
 *
 *      user-event, `waitFor` and `findBy*` keep working. Because the clock also runs by itself,
 *      do not assert an exact edge such as "nothing has happened at 299 ms".
 *
 *   2. Exact: the clock moves only when the test says so (`startManualClock`, below).
 *
 *        startManualClock()
 *        const { user } = renderWithProviders(<Search />)
 *        await user.type(screen.getByRole('textbox'), 'abc')
 *        await act(async () => {
 *          await vi.advanceTimersByTimeAsync(299)
 *        })
 *        // Not yet. Advance 1 more ms and it is. Read with getBy*: findBy* and waitFor push
 *        // the clock forward in steps while they wait, so they work but are no longer exact.
 *
 *      `renderWithProviders` gives its `user` `advanceTimers: vi.advanceTimersByTime` whenever
 *      fake timers are on at the moment it is called, so user-event's own pauses run on the fake
 *      clock and `user.*` does not hang. That is why the clock must start BEFORE the render. A
 *      `userEventOptions.advanceTimers` of your own wins over the default.
 *      `fireEvent` needs neither `advanceTimers` nor a helper, because it never waits.
 *
 * In both: wrap every clock move in `await act(async () => { await vi.advanceTimersByTimeAsync(ms) })`.
 * `act` lets React apply the state change a timer caused, and the async form lets promise
 * callbacks (a mocked fetch, a query result) run between timers. Without `act`, React logs a
 * warning and the page may not have updated yet when the next line reads it.
 *
 * No theme provider: the theme is a data-theme attribute on <html>, and the tokens switch by
 * themselves.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import userEvent, {
  type Options as UserEventOptions,
  type UserEvent,
} from '@testing-library/user-event'
import type { ReactElement, ReactNode } from 'react'
import { MemoryRouter, type InitialEntry } from 'react-router'
import { vi } from 'vitest'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

/** A QueryClient for tests: no retries, and nothing is garbage collected on a timer. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: 0 },
      mutations: { retry: false },
    },
  })
}

/**
 * Fake timers that stand still until the test moves them with `vi.advanceTimersByTimeAsync`,
 * for exact edges (nothing at 299 ms, the result at 300 ms).
 *
 * Call it inside the test or in a `beforeEach`, before `renderWithProviders`, never in
 * `beforeAll`: setup.ts puts the real timers back after every test.
 *
 * It calls `vi.useFakeTimers()`, then gives Testing Library a stand-in for Jest's
 * `advanceTimersByTime`. Testing Library looks for a global named `jest` to learn that timers are
 * fake, and without it `findBy*`, `waitFor` and every `user.*` call hang. The stand-in is added
 * with `vi.stubGlobal`, so vite.config.ts (`unstubGlobals`) removes it after the test, and
 * setup.ts puts the real timers back. `renderWithProviders` then passes `advanceTimers` to
 * user-event by itself, so user-event's own pauses run too.
 */
export function startManualClock(): void {
  vi.useFakeTimers()
  vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) })
}

export interface RenderWithProvidersOptions {
  /** Where the memory router starts. Default "/". Ignored when `withRouter` is false. */
  route?: InitialEntry
  /** Several entries, for back and forward. Wins over `route`. Ignored when `withRouter` is false. */
  initialEntries?: InitialEntry[]
  /** Pass your own to prefill the cache or to inspect it after the test. */
  queryClient?: QueryClient
  /**
   * Passed to `userEvent.setup()`, for example `{ delay: null }` to skip user-event's pauses.
   * When fake timers are on, `advanceTimers: vi.advanceTimersByTime` is already set for you, and
   * what you pass here wins over it.
   */
  userEventOptions?: UserEventOptions
  /**
   * Default true: wrap the UI in a MemoryRouter. Pass false when the test supplies a router,
   * such as `<RouterProvider router={createMemoryRouter(...)} />` for lazy routes and loaders.
   */
  withRouter?: boolean
}

export interface RenderWithProvidersResult extends RenderResult {
  queryClient: QueryClient
  user: UserEvent
}

/**
 * Renders a component the way the app does: with a QueryClient (retries off), a memory router
 * (unless `withRouter` is false), the tooltip provider that shadcn parts need, and the toast
 * host. See the top of this file for the options and for fake timers.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  const queryClient = options.queryClient ?? createTestQueryClient()
  const entries = options.initialEntries ?? [options.route ?? '/']
  const withRouter = options.withRouter ?? true

  function Providers({ children }: { children: ReactNode }) {
    const inner = (
      <TooltipProvider delayDuration={0}>
        {children}
        <Toaster />
      </TooltipProvider>
    )
    return (
      <QueryClientProvider client={queryClient}>
        {withRouter ? <MemoryRouter initialEntries={entries}>{inner}</MemoryRouter> : inner}
      </QueryClientProvider>
    )
  }

  // With fake timers on, user-event's own pauses (`setTimeout(0)` between keys) only fire if it is
  // told how to move the clock. Without this, `user.type` hangs after `startManualClock()`.
  const user = userEvent.setup({
    ...(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {}),
    ...options.userEventOptions,
  })
  const result = render(ui, { wrapper: Providers })
  return { ...result, queryClient, user }
}
