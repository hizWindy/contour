import { queryOptions, useQuery } from '@tanstack/react-query'
import { api, unwrap } from '../client'
import { CACHE_TIMES, queryKeys } from '../query'

/**
 * Everything the Start page needs: cities, triggers, modes, caps and the default parameters. The
 * caps hold "left today", which each run changes, so it keeps the normal 15 seconds.
 */
export function runOptionsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.runOptions.all,
    queryFn: async ({ signal }) => unwrap(await api.GET('/lead-finder/run-options', { signal })),
  })
}

export function useRunOptions() {
  return useQuery(runOptionsQueryOptions())
}

/** The rules in use, read only. They change only when the team publishes new ones. */
export function rulesQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.rules.all,
    queryFn: async ({ signal }) => unwrap(await api.GET('/lead-finder/rules', { signal })),
    ...CACHE_TIMES.rules,
  })
}

export function useRules() {
  return useQuery(rulesQueryOptions())
}
