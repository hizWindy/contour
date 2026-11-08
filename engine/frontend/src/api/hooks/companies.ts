/**
 * The Companies page (PLAN-V10): the list, its filter values, one company and the prep box's
 * matches. Everything comes from the HubSpot copy, plus the Lead Finder's good leads for people
 * with its tick (the backend decides what each person gets).
 */
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { api, unwrap } from '../client'
import { queryKeys } from '../query'
import type { PrepAsk, PrepOut, QueryOf } from '../types'

/** One company moves slowly (the HubSpot copy changes once a day), so a minute of fresh is fine. */
const COMPANY_FRESH_MS = 60_000

/** A page of companies. */
export function companiesQueryOptions(query: QueryOf<'list_companies'> = {}) {
  return queryOptions({
    queryKey: queryKeys.companies.list(query),
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/companies', { params: { query }, signal })),
  })
}

/** A page of companies. The rows on screen stay while the next page or filter loads. */
export function useCompanies(query: QueryOf<'list_companies'> = {}) {
  return useQuery({ ...companiesQueryOptions(query), placeholderData: keepPreviousData })
}

/** The cities and owners the filters offer. */
export function companyFacetsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.companies.facets(),
    queryFn: async ({ signal }) => unwrap(await api.GET('/companies/facets', { signal })),
    staleTime: 10 * 60_000,
  })
}

export function useCompanyFacets() {
  return useQuery(companyFacetsQueryOptions())
}

/** One company: what we know about it, for the panel and its full page. */
export function companyQueryOptions(key: string) {
  return queryOptions({
    queryKey: queryKeys.companies.detail(key),
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/companies/{key}', { params: { path: { key } }, signal })),
    staleTime: COMPANY_FRESH_MS,
  })
}

/** `undefined` asks for nothing (the panel is shut). */
export function useCompany(key: string | undefined) {
  return useQuery({
    ...companyQueryOptions(key ?? ''),
    enabled: key !== undefined && key !== '',
  })
}

/** The prep box's matches: up to 4 people and 4 companies. Under 2 letters asks for nothing. */
export function companySearchQueryOptions(q: string) {
  return queryOptions({
    queryKey: queryKeys.companies.search(q),
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/companies/search', { params: { query: { q } }, signal })),
    staleTime: COMPANY_FRESH_MS,
  })
}

export function useCompanySearch(q: string) {
  const text = q.trim()
  return useQuery({
    ...companySearchQueryOptions(text),
    enabled: text.length >= 2,
    placeholderData: keepPreviousData,
  })
}

// --- Call prep (PLAN-V10 D2 to D4) -----------------------------------------------------------

/** How often a prep that is still searching is asked for again. */
export const PREP_POLL_MS = 2000

/** What we already know about the company (and the person), free and at once. */
export function prepFactsQueryOptions(key: string, contactId: string | null) {
  return queryOptions({
    queryKey: queryKeys.companies.facts(key, contactId),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/companies/{key}/facts', {
          params: { path: { key }, query: contactId ? { contact_id: contactId } : {} },
          signal,
        }),
      ),
    staleTime: COMPANY_FRESH_MS,
  })
}

export function usePrepFacts(key: string | undefined, contactId: string | null) {
  return useQuery({
    ...prepFactsQueryOptions(key ?? '', contactId),
    enabled: key !== undefined && key !== '',
  })
}

/** One prep. While it is searching it is asked for again every 2 seconds. */
export function prepQueryOptions(id: string) {
  return queryOptions({
    queryKey: queryKeys.companies.prep(id),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/companies/preps/{prep_id}', { params: { path: { prep_id: id } }, signal }),
      ),
  })
}

export function usePrep(id: string | undefined) {
  return useQuery({
    ...prepQueryOptions(id ?? ''),
    enabled: id !== undefined && id !== '',
    refetchInterval: (query) => (query.state.data?.status === 'searching' ? PREP_POLL_MS : false),
  })
}

/** Starts a prep, or gets back a ready one from the last days (free). */
export function useStartPrep() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (body: PrepAsk): Promise<PrepOut> =>
      unwrap(await api.POST('/companies/preps', { body })),
    onSuccess: (prep) => {
      client.setQueryData(queryKeys.companies.prep(prep.id), prep)
      void client.invalidateQueries({ queryKey: queryKeys.companies.today() })
    },
  })
}

/** My preps from today, for the chips under the prep box. */
export function useTodayPreps() {
  return useQuery({
    queryKey: queryKeys.companies.today(),
    queryFn: async ({ signal }) => unwrap(await api.GET('/companies/preps/today', { signal })),
  })
}
