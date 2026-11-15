import { queryOptions, useQuery } from '@tanstack/react-query'
import { api, unwrap } from '../client'
import { CACHE_TIMES, queryKeys } from '../query'
import type { LeadFinderRules } from '../types'

/**
 * Everything the Start page needs: cities, triggers, modes, caps and the default parameters. The
 * caps hold "left today", which each run changes, so it keeps the normal 15 seconds.
 */
export function runOptionsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.runOptions.all,
    queryFn: async ({ signal }) =>
      // Until PLAN-V16 M1: the city groups, the goal and the sources are in `v16.ts`.
      unwrap(await api.GET('/lead-finder/run-options', { signal })),
  })
}

export function useRunOptions() {
  return useQuery(runOptionsQueryOptions())
}

/** The rules in use, read only. They change only when the team publishes new ones. */
export function rulesQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.rules.all,
    queryFn: async ({ signal }) =>
      // Until PLAN-V16 M1: the city groups, exclusions, sign strengths and dampeners are in v16.ts.
      unwrap(await api.GET('/lead-finder/rules', { signal })) as unknown as LeadFinderRules,
    ...CACHE_TIMES.rules,
  })
}

export function useRules() {
  return useQuery(rulesQueryOptions())
}
