import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap, type ApiProblem } from '../client'
import { queryKeys } from '../query'
import type { HealthDetails } from '../types'

/** The backend keeps the answer this long, so asking sooner only returns the same one. */
const FRESH_MS = 60_000

/**
 * Every system's health for Admin's Health tab (`GET /health/details`, PLAN-V13 T1-2). For an
 * Admin only. The backend checks at most once a minute, and every check is free.
 */
export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health.all,
    queryFn: async ({ signal }) => unwrap(await api.GET('/health/details', { signal })),
    staleTime: FRESH_MS,
  })
}

/** "Check again": every system now, not the answer kept for a minute. */
export function useCheckHealthAgain() {
  const queryClient = useQueryClient()
  return useMutation<HealthDetails, ApiProblem>({
    mutationFn: async () =>
      unwrap(await api.GET('/health/details', { params: { query: { refresh: true } } })),
    onSuccess: (details) => {
      queryClient.setQueryData(queryKeys.health.all, details)
    },
  })
}
