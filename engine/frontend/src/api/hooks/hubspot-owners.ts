/**
 * Each person's HubSpot owner (PLAN-V17 T3-7, the contract part 4): the calls a rep sends to
 * HubSpot go in under their owner. Track 1 matches a person to an owner by email; an Admin can set
 * or clear it on the People tab.
 *
 * Only the People tab uses these, so they stay out of the hooks index and the first visit. Owners
 * come with ids and names only, never an email.
 */
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap, type ApiProblem } from '../client'
import { queryKeys } from '../query'
import type { HubSpotOwnerLink, HubSpotOwnerOption } from '@/api/types'
import type { Person } from './review'

/** The owners change only with a HubSpot sync, once a day. */
const OWNERS_FRESH_MS = 5 * 60_000

/** A person's HubSpot owner, or null. */
export function ownerOf(person: Person): HubSpotOwnerLink | null {
  return person.hubspot_owner ?? null
}

/** GET /hubspot/owners (Admin): the owners' ids and names, for the pick list. */
export function hubSpotOwnersQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.hubspot.owners(),
    queryFn: async ({ signal }): Promise<HubSpotOwnerOption[]> =>
      unwrap(await api.GET('/hubspot/owners', { signal })).owners,
    staleTime: OWNERS_FRESH_MS,
  })
}

export function useHubSpotOwners() {
  return useQuery(hubSpotOwnersQueryOptions())
}

export interface SetOwnerVariables {
  userId: string
  /** The owner picked, or null to clear it. */
  owner: HubSpotOwnerOption | null
}

/**
 * PUT /people/{user_id}/hubspot-owner (Admin): sets a person's owner, or clears it. The person comes
 * back with the new link, so the row changes at once, before the list is read again.
 */
export function useSetHubSpotOwner() {
  const queryClient = useQueryClient()
  return useMutation<Person, ApiProblem, SetOwnerVariables>({
    mutationFn: async ({ userId, owner }) =>
      unwrap(
        await api.PUT('/people/{user_id}/hubspot-owner', {
          params: { path: { user_id: userId } },
          body: { owner_id: owner?.id ?? null },
        }),
      ),
    onSuccess: (saved) => {
      queryClient.setQueryData<Person[]>(queryKeys.people.all, (people) =>
        people?.map((person) => (person.id === saved.id ? { ...person, ...saved } : person)),
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.people.all })
    },
  })
}
