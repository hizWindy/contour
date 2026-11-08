/**
 * The Companies page keeps its state in the address, so a link or Back shows the same list: the
 * filter, the sort, the page and the open company. A filter change goes back to page 1. The
 * prep box is not here: it preps a call and never filters the list (PLAN-V10 B4).
 */
import type { DealState, QueryOf } from '@/api/types'

export const PAGE_SIZE = 50

export const SORT_KEYS = ['name', 'staff', 'lease', 'last_talk'] as const
export type SortKey = (typeof SORT_KEYS)[number]
export type SortOrder = 'asc' | 'desc'

/** How each sort starts: A to Z, the biggest first, the soonest lease end, the latest talk. */
export const FIRST_ORDER: Record<SortKey, SortOrder> = {
  name: 'asc',
  staff: 'desc',
  lease: 'asc',
  last_talk: 'desc',
}

export const DEALS: readonly DealState[] = ['open', 'customer', 'none']
export const SOURCES = ['hubspot', 'lead'] as const
export type Source = (typeof SOURCES)[number]

export interface CompanyFilters {
  /** Words in the name, the website or the industry. */
  q: string
  city: string | null
  owner: string | null
  deal: DealState | null
  /** Only for people with the Lead Finder tick: HubSpot's companies, or its leads. */
  source: Source | null
}

export interface CompaniesState {
  filters: CompanyFilters
  sort: SortKey
  order: SortOrder
  /** The page, from 0. The address shows it from 1. */
  page: number
  /** The company open in the panel, by its key. */
  company: string | null
}

export const NO_FILTERS: CompanyFilters = {
  q: '',
  city: null,
  owner: null,
  deal: null,
  source: null,
}

const MAX_TEXT = 200

function pick<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null
}

function text(value: string | null): string | null {
  const trimmed = (value ?? '').trim().slice(0, MAX_TEXT)
  return trimmed === '' ? null : trimmed
}

export function readCompanies(params: URLSearchParams): CompaniesState {
  const sort = pick(params.get('sort'), SORT_KEYS) ?? 'name'
  const order = pick(params.get('order'), ['asc', 'desc'] as const) ?? FIRST_ORDER[sort]
  const page = Number.parseInt(params.get('page') ?? '1', 10)
  return {
    filters: {
      q: (params.get('q') ?? '').slice(0, MAX_TEXT),
      city: text(params.get('city')),
      owner: text(params.get('owner')),
      deal: pick(params.get('deal'), DEALS),
      source: pick(params.get('source'), SOURCES),
    },
    sort,
    order,
    page: Number.isFinite(page) && page > 1 ? page - 1 : 0,
    company: text(params.get('company')),
  }
}

/** The address for a state. Defaults are left out, so a plain list has a plain address. */
export function writeCompanies(state: CompaniesState): URLSearchParams {
  const params = new URLSearchParams()
  const { filters } = state
  if (filters.q.trim() !== '') params.set('q', filters.q)
  if (filters.city) params.set('city', filters.city)
  if (filters.owner) params.set('owner', filters.owner)
  if (filters.deal) params.set('deal', filters.deal)
  if (filters.source) params.set('source', filters.source)
  if (state.sort !== 'name') params.set('sort', state.sort)
  if (state.order !== FIRST_ORDER[state.sort]) params.set('order', state.order)
  if (state.page > 0) params.set('page', String(state.page + 1))
  if (state.company) params.set('company', state.company)
  return params
}

/** What the list asks the backend for. The page and its prefetch build it the same way. */
export function listQuery(state: CompaniesState): NonNullable<QueryOf<'list_companies'>> {
  const { filters } = state
  const query: NonNullable<QueryOf<'list_companies'>> = {
    sort: state.sort,
    order: state.order,
    limit: PAGE_SIZE,
    offset: state.page * PAGE_SIZE,
  }
  const q = filters.q.trim()
  if (q !== '') query.q = q
  if (filters.city) query.city = filters.city
  if (filters.owner) query.owner = filters.owner
  if (filters.deal) query.deal = filters.deal
  if (filters.source) query.source = filters.source
  return query
}

export function activeFilterCount(filters: CompanyFilters): number {
  return [
    filters.q.trim() !== '',
    filters.city !== null,
    filters.owner !== null,
    filters.deal !== null,
    filters.source !== null,
  ].filter(Boolean).length
}
