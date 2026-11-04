/**
 * The Results page keeps everything in the address: the filters, the sort, the page, the view
 * (table or map) and the open lead. So a link shows the same list, Back works, and the run page can
 * link to `/results?run_id=...`.
 *
 * The address uses the API's own names (`result`, `city`, `min_score`, repeated keys for lists),
 * plus `view`, `sort`, `order`, `page` (from 1) and `lead`. A value that can't be read is ignored,
 * so a bad link still opens the page. Defaults are left out of the address.
 */
import type { HubSpotStatus, LeadOrigin, LeadResult, LeadStatus, QueryOf } from '@/api/types'
import {
  HUBSPOT_STATUS_LABELS,
  LEAD_STATUS_LABELS,
  ORIGIN_LABELS,
  RESULT_LABELS,
} from '@/lib/labels'

export type ResultsView = 'table' | 'map'
export type SortKey = NonNullable<NonNullable<QueryOf<'list_leads'>>['sort']>
export type SortOrder = 'asc' | 'desc'

export const PAGE_SIZE = 50

/** The columns the server sorts by, from `GET /leads`. */
export const SORT_KEYS: readonly SortKey[] = [
  'score',
  'created_at',
  'updated_at',
  'company',
  'city',
  'result',
  'status',
  'hubspot_status',
  'trigger_date',
  'office_m2',
  'cost_usd',
]

/** A column's first click: words A to Z, numbers and dates biggest or newest first. */
export const FIRST_ORDER: Record<SortKey, SortOrder> = {
  score: 'desc',
  created_at: 'desc',
  updated_at: 'desc',
  company: 'asc',
  city: 'asc',
  result: 'asc',
  status: 'asc',
  hubspot_status: 'asc',
  trigger_date: 'desc',
  office_m2: 'desc',
  cost_usd: 'desc',
}

export interface LeadFilters {
  result: LeadResult[]
  city: string[]
  trigger: string[]
  industry: string[]
  industry_group: string[]
  hubspot_status: HubSpotStatus[]
  status: LeadStatus[]
  /** Where the company came from: the HubSpot watchlist, found on the web, or typed. */
  origin: LeadOrigin[]
  run_id: string | null
  min_score: number | null
  office_m2_min: number | null
  office_m2_max: number | null
  /** `YYYY-MM-DD`, read as Melbourne dates by the backend. */
  created_since: string | null
  created_until: string | null
  trigger_since: string | null
  q: string
  include_tests: boolean
  /** Only leads whose facts are missing because Claude couldn't fill in the answer form. */
  facts_missing: boolean
}

export interface ResultsState {
  view: ResultsView
  sort: SortKey
  order: SortOrder
  /** From 0. The address shows it from 1. */
  page: number
  /** The lead open in the side panel. */
  lead: string | null
  filters: LeadFilters
}

export const NO_FILTERS: LeadFilters = {
  result: [],
  city: [],
  trigger: [],
  industry: [],
  industry_group: [],
  hubspot_status: [],
  status: [],
  origin: [],
  run_id: null,
  min_score: null,
  office_m2_min: null,
  office_m2_max: null,
  created_since: null,
  created_until: null,
  trigger_since: null,
  q: '',
  include_tests: false,
  facts_missing: false,
}

export const DEFAULT_STATE: ResultsState = {
  view: 'table',
  sort: 'score',
  order: 'desc',
  page: 0,
  lead: null,
  filters: NO_FILTERS,
}

const LIST_KEYS = [
  'result',
  'city',
  'trigger',
  'industry',
  'industry_group',
  'hubspot_status',
  'status',
  'origin',
] as const
const NUMBER_KEYS = ['min_score', 'office_m2_min', 'office_m2_max'] as const
const DATE_KEYS = ['created_since', 'created_until', 'trigger_since'] as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/
/** Matches the backend's limit on one text value. */
const MAX_TEXT = 200

/** The values that are keys of `known`, once each, in order. */
export function oneOf<T extends string>(values: readonly string[], known: Record<T, string>): T[] {
  const found: T[] = []
  for (const value of values) {
    if (value in known && !found.includes(value as T)) {
      found.push(value as T)
    }
  }
  return found
}

function texts(values: readonly string[]): string[] {
  const found: string[] = []
  for (const raw of values) {
    const value = raw.trim().slice(0, MAX_TEXT)
    if (value !== '' && !found.includes(value)) {
      found.push(value)
    }
  }
  return found
}

function wholeNumber(value: string | null): number | null {
  if (value === null || !/^\d{1,9}$/.test(value.trim())) {
    return null
  }
  return Number(value.trim())
}

function day(value: string | null): string | null {
  if (value === null || !DAY.test(value)) {
    return null
  }
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value
}

function uuid(value: string | null): string | null {
  return value !== null && UUID.test(value) ? value.toLowerCase() : null
}

/** The page's state from the address. */
export function readResults(params: URLSearchParams): ResultsState {
  const sort = params.get('sort')
  const order = params.get('order')
  const page = wholeNumber(params.get('page'))
  const filters: LeadFilters = {
    ...NO_FILTERS,
    result: oneOf(params.getAll('result'), RESULT_LABELS),
    hubspot_status: oneOf(params.getAll('hubspot_status'), HUBSPOT_STATUS_LABELS),
    status: oneOf(params.getAll('status'), LEAD_STATUS_LABELS),
    origin: oneOf(params.getAll('origin'), ORIGIN_LABELS),
    city: texts(params.getAll('city')),
    trigger: texts(params.getAll('trigger')),
    industry: texts(params.getAll('industry')),
    industry_group: texts(params.getAll('industry_group')),
    run_id: uuid(params.get('run_id')),
    q: (params.get('q') ?? '').slice(0, MAX_TEXT),
    include_tests: params.get('include_tests') === 'true',
    facts_missing: params.get('facts_missing') === 'true',
  }
  for (const key of NUMBER_KEYS) {
    filters[key] = wholeNumber(params.get(key))
  }
  for (const key of DATE_KEYS) {
    filters[key] = day(params.get(key))
  }
  const sortKey = SORT_KEYS.find((key) => key === sort) ?? DEFAULT_STATE.sort
  return {
    view: params.get('view') === 'map' ? 'map' : 'table',
    sort: sortKey,
    order:
      order === 'asc' || order === 'desc'
        ? order
        : sort === sortKey
          ? FIRST_ORDER[sortKey]
          : DEFAULT_STATE.order,
    page: page !== null && page > 0 ? page - 1 : 0,
    lead: uuid(params.get('lead')),
    filters,
  }
}

/** The address for a state. Defaults are left out, so a plain page has a plain address. */
export function writeResults(state: ResultsState): URLSearchParams {
  const params = new URLSearchParams()
  const { filters } = state
  // Kept as typed (a space at the end too), so the search box doesn't lose it mid-word.
  if (filters.q.trim() !== '') {
    params.set('q', filters.q)
  }
  for (const key of LIST_KEYS) {
    for (const value of filters[key]) {
      params.append(key, value)
    }
  }
  if (filters.run_id) {
    params.set('run_id', filters.run_id)
  }
  for (const key of NUMBER_KEYS) {
    const value = filters[key]
    if (value !== null) {
      params.set(key, String(value))
    }
  }
  for (const key of DATE_KEYS) {
    const value = filters[key]
    if (value !== null) {
      params.set(key, value)
    }
  }
  if (filters.include_tests) {
    params.set('include_tests', 'true')
  }
  if (filters.facts_missing) {
    params.set('facts_missing', 'true')
  }
  if (state.sort !== DEFAULT_STATE.sort || state.order !== DEFAULT_STATE.order) {
    params.set('sort', state.sort)
    params.set('order', state.order)
  }
  if (state.page > 0) {
    params.set('page', String(state.page + 1))
  }
  if (state.view !== 'table') {
    params.set('view', state.view)
  }
  if (state.lead) {
    params.set('lead', state.lead)
  }
  return params
}

/** How many filters are set (a list with values counts once). For "Clear filters". */
export function activeFilterCount(filters: LeadFilters): number {
  let count = 0
  for (const key of LIST_KEYS) {
    if (filters[key].length > 0) {
      count += 1
    }
  }
  for (const key of [...NUMBER_KEYS, ...DATE_KEYS, 'run_id'] as const) {
    if (filters[key] !== null) {
      count += 1
    }
  }
  if (filters.q.trim() !== '') {
    count += 1
  }
  if (filters.include_tests) {
    count += 1
  }
  if (filters.facts_missing) {
    count += 1
  }
  return count
}

/** The filters as the API takes them: empty values left out. Facets and the map use these. */
export function filterQuery(filters: LeadFilters): NonNullable<QueryOf<'lead_facets'>> {
  const query: NonNullable<QueryOf<'lead_facets'>> = {}
  if (filters.result.length > 0) query.result = [...filters.result]
  if (filters.city.length > 0) query.city = [...filters.city]
  if (filters.trigger.length > 0) query.trigger = [...filters.trigger]
  if (filters.industry.length > 0) query.industry = [...filters.industry]
  if (filters.industry_group.length > 0) query.industry_group = [...filters.industry_group]
  if (filters.hubspot_status.length > 0) query.hubspot_status = [...filters.hubspot_status]
  if (filters.status.length > 0) query.status = [...filters.status]
  if (filters.origin.length > 0) query.origin = [...filters.origin]
  for (const key of NUMBER_KEYS) {
    const value = filters[key]
    if (value !== null) {
      query[key] = value
    }
  }
  for (const key of DATE_KEYS) {
    const value = filters[key]
    if (value !== null) {
      query[key] = value
    }
  }
  if (filters.run_id) {
    query.run_id = filters.run_id
  }
  if (filters.q.trim() !== '') {
    query.q = filters.q.trim()
  }
  if (filters.include_tests) {
    query.include_tests = true
  }
  if (filters.facts_missing) {
    query.facts_missing = true
  }
  return query
}

/** One page of the table, sorted. */
export function listQuery(state: ResultsState): NonNullable<QueryOf<'list_leads'>> {
  // The filters are the same on every leads route, so the facets' query fits the list's.
  return {
    ...filterQuery(state.filters),
    sort: state.sort,
    order: state.order,
    limit: PAGE_SIZE,
    offset: state.page * PAGE_SIZE,
  }
}

/** The CSV: every lead that matches, in the table's order. */
export function exportQuery(state: ResultsState): NonNullable<QueryOf<'export_leads'>> {
  return { ...filterQuery(state.filters), sort: state.sort, order: state.order }
}

/** A `Date` as the `YYYY-MM-DD` the address and the API use, from its local calendar day. */
export function dayOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const dayOfMonth = String(date.getDate()).padStart(2, '0')
  return `${String(date.getFullYear())}-${month}-${dayOfMonth}`
}

/** A `YYYY-MM-DD` as a local `Date` at midnight, for the calendar. */
export function dateOf(value: string): Date {
  const [year = 1970, month = 1, dayOfMonth = 1] = value.split('-').map(Number)
  return new Date(year, month - 1, dayOfMonth)
}
