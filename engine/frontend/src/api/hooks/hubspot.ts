import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap, uploadHubspotExport, type ApiProblem } from '../client'
import { queryKeys } from '../query'
import type { HubSpotConnection, HubSpotSync, HubSpotWrite, ImportResult, Schemas } from '../types'

const SYNC_POLL_MS = 3000

/**
 * The HubSpot connection: whether the key is set, each permission, each project, the syncs and
 * our copy's counts. While a sync runs it is read again every few seconds.
 */
export function useHubSpotStatus() {
  return useQuery({
    queryKey: queryKeys.hubspot.status(),
    queryFn: async ({ signal }) => unwrap(await api.GET('/hubspot/status', { signal })),
    refetchInterval: (query) => (query.state.data?.running_sync ? SYNC_POLL_MS : false),
  })
}

/** Checks the key's permissions with HubSpot again now (free, and it changes nothing). */
export function useRecheckHubSpot() {
  const queryClient = useQueryClient()
  return useMutation<HubSpotConnection, ApiProblem, void>({
    mutationFn: async () =>
      unwrap(await api.GET('/hubspot/status', { params: { query: { refresh: true } } })),
    onSuccess: (status) => {
      queryClient.setQueryData(queryKeys.hubspot.status(), status)
    },
  })
}

/** Starts a sync in the background. The status then shows it running. */
export function useStartHubSpotSync() {
  const queryClient = useQueryClient()
  return useMutation<HubSpotSync, ApiProblem, 'auto' | 'full' | 'changes'>({
    mutationFn: async (mode) =>
      unwrap(await api.POST('/hubspot/sync', { params: { query: { mode } } })),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hubspot.all })
    },
  })
}

/** The log of writes to HubSpot, newest first. */
export function useHubSpotWrites(limit = 50) {
  return useQuery({
    queryKey: [...queryKeys.hubspot.writes(), limit],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/hubspot/writes', { params: { query: { limit } }, signal })),
  })
}

/** One lead's HubSpot send, if it has one (null when it has none). */
export function useLeadHubSpot(leadId: string) {
  return useQuery({
    queryKey: queryKeys.hubspot.lead(leadId),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/lead-finder/leads/{lead_id}/hubspot', {
          params: { path: { lead_id: leadId } },
          signal,
        }),
      ),
  })
}

/** Works out what sending a lead would write. It reads HubSpot and writes nothing. */
export function usePreviewLeadHubSpot(leadId: string) {
  const queryClient = useQueryClient()
  return useMutation<HubSpotWrite, ApiProblem, void>({
    mutationFn: async () =>
      unwrap(
        await api.POST('/lead-finder/leads/{lead_id}/hubspot/preview', {
          params: { path: { lead_id: leadId } },
        }),
      ),
    onSuccess: (write) => {
      queryClient.setQueryData(queryKeys.hubspot.lead(leadId), write)
    },
  })
}

/** Sends the lead as previewed, once only. The lead becomes `sent` when it is done. */
export function useSendLeadHubSpot(leadId: string) {
  const queryClient = useQueryClient()
  return useMutation<HubSpotWrite, ApiProblem, string>({
    mutationFn: async (writeId) =>
      unwrap(
        await api.POST('/lead-finder/leads/{lead_id}/hubspot/send', {
          params: { path: { lead_id: leadId } },
          body: { write_id: writeId },
        }),
      ),
    onSuccess: (write) => {
      queryClient.setQueryData(queryKeys.hubspot.lead(leadId), write)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.leads.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.hubspot.writes() })
    },
  })
}

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
