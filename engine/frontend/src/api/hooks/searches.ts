import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, unwrap } from '../client'
import { queryKeys } from '../query'
import type { QueryOf } from '../types'

/** The search log: every Claude request with its model, tokens, sources and cost. */
export function useSearches(query: QueryOf<'get_searches'> = {}) {
  return useQuery({
    queryKey: queryKeys.searches.list(query),
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/searches', { params: { query }, signal })),
    placeholderData: keepPreviousData,
  })
}
