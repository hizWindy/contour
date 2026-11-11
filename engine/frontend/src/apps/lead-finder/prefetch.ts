/**
 * What each Lead Finder page asks for first, started while the page's code downloads (PLAN-V7 C1).
 * Each function is the `handle.prefetch` of a route in module.tsx. It must ask with the same query
 * options, built from the same address, as its page does, so the page's own request joins the one
 * already running. prefetch.test.tsx checks that each page uses what is started here.
 */
import type { QueryClient } from '@tanstack/react-query'
import {
  leadFacetsQueryOptions,
  leadMapQueryOptions,
  leadQueryOptions,
  leadsQueryOptions,
  rulesQueryOptions,
  runOptionsQueryOptions,
  runQueryOptions,
  runsQueryOptions,
} from '@/api/hooks'
import type { QueryOf } from '@/api/types'
import type { PrefetchArgs } from '@/shell/crumbs'
import { filterQuery, listQuery, readResults } from './results/params'
import { FIRST_RUNS_PAGE } from './run/runs-query'

/** The newest run, for the line under the greeting and the "Last run" line on Home. */
export const LAST_RUN = { app: 'lead_finder', limit: 1 } as const

/**
 * The best good leads nobody has acted on yet, for "Start with these" on Home: a Pass or a
 * Director review whose status is still new, highest score first.
 */
export const TOP_LEADS = {
  result: ['pass', 'director_review'],
  status: ['new'],
  sort: 'score',
  order: 'desc',
  limit: 3,
} satisfies QueryOf<'list_leads'>

/**
 * What the Lead Finder asks for on Home: the newest run, the lead counts (by result and by sign)
 * and the best new good leads.
 */
export function prefetchLeadFinderSummary(client: QueryClient): void {
  void client.prefetchQuery(runsQueryOptions(LAST_RUN))
  void client.prefetchQuery(leadFacetsQueryOptions())
  void client.prefetchQuery(leadsQueryOptions(TOP_LEADS))
}

export function prefetchStart({ client }: PrefetchArgs): void {
  void client.prefetchQuery(runOptionsQueryOptions())
}

export function prefetchRuns({ client }: PrefetchArgs): void {
  void client.prefetchQuery(runsQueryOptions(FIRST_RUNS_PAGE))
}

export function prefetchRun({ client, params }: PrefetchArgs): void {
  if (params.runId) {
    void client.prefetchQuery(runQueryOptions(params.runId))
  }
}

/**
 * The page and the filter counts, for the filters in the address; the map only in the map view
 * (it is up to 2,000 pins and the table view never shows it); and the open lead.
 */
export function prefetchResults({ client, search }: PrefetchArgs): void {
  const state = readResults(search)
  const filters = filterQuery(state.filters)
  void client.prefetchQuery(leadsQueryOptions(listQuery(state)))
  void client.prefetchQuery(leadFacetsQueryOptions(filters))
  if (state.view === 'map') {
    void client.prefetchQuery(leadMapQueryOptions(filters))
  }
  if (state.lead) {
    void client.prefetchQuery(leadQueryOptions(state.lead))
  }
}

export function prefetchLead({ client, params }: PrefetchArgs): void {
  if (params.leadId) {
    void client.prefetchQuery(leadQueryOptions(params.leadId))
  }
}

export function prefetchRules({ client }: PrefetchArgs): void {
  void client.prefetchQuery(rulesQueryOptions())
}
