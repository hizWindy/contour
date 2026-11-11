/**
 * What the Companies pages ask for first, started while the page's code downloads (as the Lead
 * Finder's pages do, PLAN-V7 C1). Each function is the `handle.prefetch` of a route in module.tsx,
 * and asks with the same query options, built from the same address, as its page does.
 */
import { companiesQueryOptions, companyFacetsQueryOptions, companyQueryOptions } from '@/api/hooks'
import type { QueryClient } from '@tanstack/react-query'
import type { PrefetchArgs } from '@/shell/crumbs'
import { listQuery, readCompanies } from './params'

/**
 * The Companies card on Home asks for the plain list's first page, the same request the Companies
 * page makes first, so the page opens from Home with its list already there.
 */
export const HOME_COMPANIES = listQuery(readCompanies(new URLSearchParams()))

/** What the Companies card on Home asks for first. */
export function prefetchCompaniesHome(client: QueryClient): void {
  void client.prefetchQuery(companiesQueryOptions(HOME_COMPANIES))
}

/** The page of companies for the address, the filter values, and the open company. */
export function prefetchCompanies({ client, search }: PrefetchArgs): void {
  const state = readCompanies(search)
  void client.prefetchQuery(companiesQueryOptions(listQuery(state)))
  void client.prefetchQuery(companyFacetsQueryOptions())
  if (state.company) {
    void client.prefetchQuery(companyQueryOptions(state.company))
  }
}

export function prefetchCompany({ client, params }: PrefetchArgs): void {
  if (params.key) {
    void client.prefetchQuery(companyQueryOptions(params.key))
  }
}
