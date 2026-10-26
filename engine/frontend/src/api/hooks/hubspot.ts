import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap, uploadHubspotExport, type ApiProblem } from '../client'
import { queryKeys } from '../query'
import type { ImportResult, Schemas } from '../types'

/** How much HubSpot data is loaded, and when it was last imported. */
export function useHubspotSummary() {
  return useQuery({
    queryKey: queryKeys.hubspot.summary(),
    queryFn: async ({ signal }) => unwrap(await api.GET('/hubspot/summary', { signal })),
  })
}

/** Loads a HubSpot export (.xlsx). The watchlist and the profiles change with it. */
export function useImportHubspot() {
  const queryClient = useQueryClient()
  return useMutation<ImportResult, ApiProblem, File>({
    mutationFn: async (file) => unwrap(await uploadHubspotExport(file)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hubspot.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.watchlist.all })
    },
  })
}

/** Builds the company profiles in memory again from the loaded HubSpot data. */
export function useRebuildProfiles() {
  const queryClient = useQueryClient()
  return useMutation<Schemas['RebuildResult'], ApiProblem, void>({
    mutationFn: async () => unwrap(await api.POST('/hubspot/profiles/rebuild')),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.memory.all })
    },
  })
}
