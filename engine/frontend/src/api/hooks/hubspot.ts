import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap, uploadHubspotExport, type ApiProblem } from '../client'
import { queryKeys } from '../query'
import type {
  HubSpotBatchPair,
  HubSpotBatchPreview,
  HubSpotBatchSent,
  HubSpotConnection,
  HubSpotSync,
  HubSpotWrite,
  ImportResult,
  Schemas,
} from '../types'

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

const SYNCS_POLL_MS = 2000

/**
 * The newest syncs, newest first. While one runs they are read again every 2 seconds, so its
 * counts climb on screen. Reading them is free: it asks our database, not HubSpot.
 */
export function useHubSpotSyncs(limit = 10, enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.hubspot.syncs(), limit],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/hubspot/syncs', { params: { query: { limit } }, signal })),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.some((sync) => sync.status === 'running') ? SYNCS_POLL_MS : false,
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

/**
 * Stops a running sync (PLAN-V15 T2-6, `POST /hubspot/syncs/{id}/cancel`). The answer is the sync:
 * `cancelled` once it stopped (within about 5 seconds), or still `running` with
 * `cancel_requested_at` while the other backend stops it during a deploy. A sync that already
 * finished answers 409 `not_running`. The last of its `warnings` says what was kept.
 */
export function useCancelHubSpotSync() {
  const queryClient = useQueryClient()
  return useMutation<HubSpotSync, ApiProblem, number>({
    mutationFn: async (syncId) =>
      unwrap(
        await api.POST('/hubspot/syncs/{sync_id}/cancel', {
          params: { path: { sync_id: syncId } },
        }),
      ),
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
export function useLeadHubSpot(leadId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.hubspot.lead(leadId),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/lead-finder/leads/{lead_id}/hubspot', {
          params: { path: { lead_id: leadId } },
          signal,
        }),
      ),
    enabled,
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

/**
 * Works out what adding up to 25 leads would write, one preview for the batch (PLAN-V27 T3-2,
 * `preview-many`): each lead's write, or `already_sent`, or its `problem`, with the owner and
 * whether writing is on. It reads HubSpot and writes nothing.
 */
export function usePreviewManyHubSpot() {
  return useMutation<HubSpotBatchPreview, ApiProblem, string[]>({
    mutationFn: async (leadIds) =>
      unwrap(
        await api.POST('/lead-finder/leads/hubspot/preview-many', { body: { lead_ids: leadIds } }),
      ),
  })
}

/**
 * Sends the previewed leads, each once, one at a time (`send-many`). Each has its own result:
 * `sent`, `already_sent` or `failed` with plain words. Writing switched off refuses the whole
 * batch (409 `hubspot_write_off`) and nothing is written. The leads are read again after.
 */
export function useSendManyHubSpot() {
  const queryClient = useQueryClient()
  return useMutation<HubSpotBatchSent, ApiProblem, HubSpotBatchPair[]>({
    mutationFn: async (items) =>
      unwrap(await api.POST('/lead-finder/leads/hubspot/send-many', { body: { items } })),
    onSuccess: (out) => {
      for (const item of out.items) {
        if (item.write) queryClient.setQueryData(queryKeys.hubspot.lead(item.lead_id), item.write)
      }
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
