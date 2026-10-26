import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, unwrap } from '../client'
import { queryKeys } from '../query'
import type { QueryOf } from '../types'

/** The HubSpot companies a watchlist run would research, with the counts. */
export function useWatchlist(query: QueryOf<'get_watchlist'> = {}) {
  return useQuery({
    queryKey: queryKeys.watchlist.list(query),
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/lead-finder/watchlist', { params: { query }, signal })),
    placeholderData: keepPreviousData,
  })
}
