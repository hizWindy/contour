/**
 * TanStack Query setup, and the shared query keys.
 *
 * Every server call goes through a query or a mutation, so each page shows loading, empty and
 * error states the same way. The hooks for each group of routes are in `src/api/hooks/`. A page
 * adds its own queries inside its own folder, and uses the keys below when it reads or
 * invalidates what another page may also show (a run, a lead, the settings).
 */
import { QueryClient } from '@tanstack/react-query'
import { isAbort, isApiProblem } from './client'
import type { QueryOf } from './types'

const MAX_RETRIES = 2

/** Retry a read only when trying again could help: the backend was out of reach, or it broke. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES || isAbort(error)) {
    return false
  }
  if (!isApiProblem(error)) {
    return false
  }
  // 0 is "could not reach the backend". 501 means "not built", which a retry cannot fix.
  return error.status === 0 || (error.status >= 500 && error.status !== 501)
}

/** The wait before retry number `failureCount`: 1 s, then 2 s. */
export function retryDelay(failureCount: number): number {
  return Math.min(1000 * 2 ** failureCount, 5000)
}

/**
 * The app's query client. A read counts as fresh for 15 seconds. A change (a mutation) is never
 * repeated by itself, because a repeated "start run" or "reject" is not safe.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        retryDelay,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  })
}

/*
  The shared keys. Keep this list small and stable: pages build on it.
  A key starts with its group, so `invalidateQueries({ queryKey: queryKeys.runs.all })` refreshes
  every run query (lists, details, logs, summaries) and nothing else.
*/
export const queryKeys = {
  runs: {
    all: ['runs'] as const,
    lists: () => ['runs', 'list'] as const,
    list: (query: QueryOf<'list_runs'>) => ['runs', 'list', query ?? {}] as const,
    detail: (runId: string) => ['runs', 'detail', runId] as const,
    log: (runId: string, after: number) => ['runs', 'log', runId, after] as const,
    summary: (since: string | undefined) => ['runs', 'summary', since ?? null] as const,
    estimate: (body: unknown) => ['runs', 'estimate', body] as const,
  },
  settings: {
    all: ['settings'] as const,
  },
  leads: {
    all: ['leads'] as const,
    lists: () => ['leads', 'list'] as const,
    list: (query: QueryOf<'list_leads'>) => ['leads', 'list', query ?? {}] as const,
    facets: (query: QueryOf<'lead_facets'>) => ['leads', 'facets', query ?? {}] as const,
    map: (query: QueryOf<'lead_map'>) => ['leads', 'map', query ?? {}] as const,
    detail: (leadId: string) => ['leads', 'detail', leadId] as const,
    similar: (leadId: string) => ['leads', 'similar', leadId] as const,
  },
  runOptions: {
    all: ['run-options'] as const,
  },
  rules: {
    all: ['rules'] as const,
  },
  watchlist: {
    all: ['watchlist'] as const,
    list: (query: QueryOf<'get_watchlist'>) => ['watchlist', query ?? {}] as const,
  },
  tests: {
    all: ['tests'] as const,
    report: (runId: string) => ['tests', 'report', runId] as const,
  },
  searches: {
    all: ['searches'] as const,
    list: (query: QueryOf<'get_searches'>) => ['searches', query ?? {}] as const,
  },
  memory: {
    all: ['memory'] as const,
    search: (query: QueryOf<'search_memory'>) => ['memory', 'search', query] as const,
  },
  hubspot: {
    all: ['hubspot'] as const,
    summary: () => ['hubspot', 'summary'] as const,
  },
}
