import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import type { ReactElement, ReactNode } from 'react'
import { MemoryRouter, type InitialEntry } from 'react-router'
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

export interface RenderWithProvidersOptions {
  /** Where the memory router starts. Default "/". */
  route?: InitialEntry
  /** Several entries, for back and forward. Wins over `route`. */
  initialEntries?: InitialEntry[]
  /** Pass your own to prefill the cache or to inspect it after the test. */
  queryClient?: QueryClient
}

export interface RenderWithProvidersResult extends RenderResult {
  queryClient: QueryClient
  user: UserEvent
}

/**
 * Renders a component the way the app does: with a QueryClient (retries off), a memory router,
 * the tooltip provider that shadcn parts need, and the toast host. No theme provider: the theme
 * is a data-theme attribute on <html>, and the tokens switch by themselves.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  const queryClient = options.queryClient ?? createTestQueryClient()
  const entries = options.initialEntries ?? [options.route ?? '/']

  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={entries}>
          <TooltipProvider delayDuration={0}>
            {children}
            <Toaster />
          </TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }

  const user = userEvent.setup()
  const result = render(ui, { wrapper: Providers })
  return { ...result, queryClient, user }
}
