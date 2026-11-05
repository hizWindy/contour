import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { melbourneDate } from '@/lib/format'
import { api, unwrap, type ApiProblem } from '../client'
import { CACHE_TIMES, queryKeys } from '../query'
import type { LeadDetail, LeadPatch, QueryOf, Run } from '../types'

/** A page of leads for the results table. */
export function leadsQueryOptions(query: QueryOf<'list_leads'> = {}) {
  return queryOptions({
    queryKey: queryKeys.leads.list(query),
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/lead-finder/leads', { params: { query }, signal })),
  })
}

/** A page of leads for the results table. The previous page stays while the next one loads. */
export function useLeads(query: QueryOf<'list_leads'> = {}) {
  return useQuery({ ...leadsQueryOptions(query), placeholderData: keepPreviousData })
}

/** Filter options with counts. Pass the same filters as the table. */
export function leadFacetsQueryOptions(query: QueryOf<'lead_facets'> = {}) {
  return queryOptions({
    queryKey: queryKeys.leads.facets(query),
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/lead-finder/leads/facets', { params: { query }, signal })),
    ...CACHE_TIMES.counts,
  })
}

export function useLeadFacets(query: QueryOf<'lead_facets'> = {}) {
  return useQuery({ ...leadFacetsQueryOptions(query), placeholderData: keepPreviousData })
}

/** The pins for the map (up to 2000, with approximate places). */
export function leadMapQueryOptions(query: QueryOf<'lead_map'> = {}) {
  return queryOptions({
    queryKey: queryKeys.leads.map(query),
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/lead-finder/leads/map', { params: { query }, signal })),
  })
}

export function useLeadMap(query: QueryOf<'lead_map'> = {}) {
  return useQuery({ ...leadMapQueryOptions(query), placeholderData: keepPreviousData })
}

/**
 * A lead changed, or a run found more: the lists, the filter counts and the map read again the
 * next time they are shown (or now, if they are on screen).
 */
export function refreshLeads(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.leads.lists() })
  void queryClient.invalidateQueries({ queryKey: queryKeys.leads.allFacets() })
  void queryClient.invalidateQueries({ queryKey: queryKeys.leads.allMaps() })
}

export interface LeadsCsv {
  blob: Blob
  filename: string
}

/**
 * The leads that match, as a CSV file (`GET /leads/export`, at most 2000 rows). It goes through
 * fetch, not a link, so a problem (a 413 `too_many_rows`) is thrown as an `ApiProblem` and can be
 * shown as a toast. The file name comes from the backend, or `leads-YYYY-MM-DD.csv`.
 */
export async function fetchLeadsCsv(query: QueryOf<'export_leads'> = {}): Promise<LeadsCsv> {
  const result = await api.GET('/lead-finder/leads/export', { params: { query }, parseAs: 'blob' })
  const blob = unwrap(result)
  return { blob, filename: csvName(result.response.headers.get('content-disposition')) }
}

/** The file name in a `Content-Disposition` header, kept to safe characters. */
export function csvName(header: string | null): string {
  const named = /filename="?([^";]+)"?/i.exec(header ?? '')?.[1] ?? ''
  const safe = named.replace(/[^\w.-]/g, '').replace(/^\.+/, '')
  return safe.endsWith('.csv') && safe.length > 4 ? safe : `leads-${melbourneDate()}.csv`
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
      refreshLeads(queryClient)
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
