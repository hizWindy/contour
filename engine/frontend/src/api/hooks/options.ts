import { useQuery } from '@tanstack/react-query'
import { api, unwrap } from '../client'
import { queryKeys } from '../query'

/** Everything the Start page needs: cities, triggers, modes, caps and the default parameters. */
export function useRunOptions() {
  return useQuery({
    queryKey: queryKeys.runOptions.all,
    queryFn: async ({ signal }) => unwrap(await api.GET('/lead-finder/run-options', { signal })),
  })
}

/** The rules in use, read only. */
export function useRules() {
  return useQuery({
    queryKey: queryKeys.rules.all,
    queryFn: async ({ signal }) => unwrap(await api.GET('/lead-finder/rules', { signal })),
  })
}
