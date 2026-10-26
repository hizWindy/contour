import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { api, unwrap, type ApiProblem } from '../client'
import { queryKeys } from '../query'
import type { LeadDetail, LeadPatch, QueryOf, Run } from '../types'

/** A page of leads for the results table. The previous page stays while the next one loads. */
export function useLeads(query: QueryOf<'list_leads'> = {}) {
  return useQuery({
    queryKey: queryKeys.leads.list(query),
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/lead-finder/leads', { params: { query }, signal })),
    placeholderData: keepPreviousData,
  })
}

/** Filter options with counts. Pass the same filters as the table. */
export function useLeadFacets(query: QueryOf<'lead_facets'> = {}) {
  return useQuery({
    queryKey: queryKeys.leads.facets(query),
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/lead-finder/leads/facets', { params: { query }, signal })),
    placeholderData: keepPreviousData,
  })
}

/** The pins for the map (up to 2000, with approximate places). */
export function useLeadMap(query: QueryOf<'lead_map'> = {}) {
  return useQuery({
    queryKey: queryKeys.leads.map(query),
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/lead-finder/leads/map', { params: { query }, signal })),
    placeholderData: keepPreviousData,
  })
}

/** One lead with its card. The key is `queryKeys.leads.detail(leadId)`. */
export function leadQueryOptions(leadId: string) {
  return queryOptions({
    queryKey: queryKeys.leads.detail(leadId),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/lead-finder/leads/{lead_id}', {
          params: { path: { lead_id: leadId } },
          signal,
        }),
      ),
  })
}

export function useLead(leadId: string | undefined) {
  return useQuery({
    ...leadQueryOptions(leadId ?? ''),
    enabled: leadId !== undefined && leadId !== '',
  })
}

/** Look-alike deals and leads. `basis: "none"` means the lead has no profile yet. */
export function useLeadSimilar(leadId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.leads.similar(leadId ?? ''),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/lead-finder/leads/{lead_id}/similar', {
          params: { path: { lead_id: leadId ?? '' } },
          signal,
        }),
      ),
    enabled: leadId !== undefined && leadId !== '',
  })
}

export interface PatchLeadVariables {
  leadId: string
  /** A merge patch: a field left out is unchanged, and `null` clears it. */
  patch: LeadPatch
}

/**
 * Changes a lead (status, reject reason, note, useful). It returns the updated lead and puts it
 * in the cache. For an Undo, send the exact previous values.
 */
export function usePatchLead() {
  const queryClient = useQueryClient()
  return useMutation<LeadDetail, ApiProblem, PatchLeadVariables>({
    mutationFn: async ({ leadId, patch }) =>
      unwrap(
        await api.PATCH('/lead-finder/leads/{lead_id}', {
          params: { path: { lead_id: leadId } },
          body: patch,
        }),
      ),
    onSuccess: (lead) => {
      queryClient.setQueryData(queryKeys.leads.detail(lead.id), lead)
      void queryClient.invalidateQueries({ queryKey: queryKeys.leads.lists() })
      void queryClient.invalidateQueries({ queryKey: ['leads', 'facets'] })
      void queryClient.invalidateQueries({ queryKey: ['leads', 'map'] })
    },
  })
}

/** Researches the company again. It starts a one-company run and returns it. Costs money. */
export function useRecheckLead() {
  const queryClient = useQueryClient()
  return useMutation<Run, ApiProblem, string>({
    mutationFn: async (leadId) =>
      unwrap(
        await api.POST('/lead-finder/leads/{lead_id}/recheck', {
          params: { path: { lead_id: leadId } },
        }),
      ),
    onSuccess: (run) => {
      queryClient.setQueryData(queryKeys.runs.detail(run.id), run)
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs.lists() })
    },
  })
}
