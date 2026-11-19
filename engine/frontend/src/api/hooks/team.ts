/**
 * The team list (`GET /companies/team`): active HubSpot owners by name, with whether each has a
 * Contour account and which one is me, never an email. It has a file of its own, so a page that
 * needs only the list (Call logs, to keep a follow-up's teammate: PLAN-V23 T3-4) doesn't bring all
 * of Meetings' requests with it. `meetings.ts` passes it on, as before.
 */
import { queryOptions, useQuery } from '@tanstack/react-query'
import { api, unwrap } from '../client'
import { queryKeys } from '../query'
import type { TeamMember } from '../types'

/** GET /companies/team: active HubSpot owners ordered by name, with Contour status (never emails). */
export function teamQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.companies.team(),
    queryFn: async ({ signal }): Promise<TeamMember[]> =>
      unwrap(await api.GET('/companies/team', { signal })),
    staleTime: 60_000,
  })
}

export function useTeam({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({ ...teamQueryOptions(), enabled })
}
