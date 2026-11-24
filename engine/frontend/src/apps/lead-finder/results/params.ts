/**
 * The Results page keeps everything in the address: the filters, the sort, the page, the view
 * (table or map) and the open lead. So a link shows the same list, Back works, and the run page can
 * link to `/results?run_id=...`.
 *
 * The address uses the API's own names (`result`, `city`, `min_score`, repeated keys for lists),
 * plus `view`, `sort`, `order`, `page` (from 1) and `lead`. A value that can't be read is ignored,
 * so a bad link still opens the page. Defaults are left out of the address.
 *
 * The tier (PLAN-V21 T3-5): the default view is Tier A, B and C and the leads with no tier yet, so
 * every lead shows but the Discards, which are one click away. An address with no `tier` shows
 * that view, and `tier=all` shows every tier, Discard and "no tier yet" too. The API gets the
 * tiers spelled out either way, so the list never depends on what the server does with no tier.
 * (Before PLAN-V21 the default was A and B, and "every tier" sent the four named tiers, so a lead
 * judged before tiers existed showed in no view.)
 *
 * New leads only (PLAN-V27 choice 6): by default the API is asked for new, quiet and possible-match
 * leads, so the companies HubSpot has hide behind the "In HubSpot (8)" chip. The chip sets
 * `show_in_hubspot=true`, which drops that filter. A person's own pick in the HubSpot filter wins:
 * then it is sent as picked, and the chip doesn't apply.
 */
import type {
  CityGroup,
  Confidence,
  HubSpotStatus,
  LeadFacets,
  LeadOrigin,
  LeadResult,
  LeadStatus,
  QueryOf,
} from '@/api/types'
import {
  CITY_GROUP_LABELS,
  CONFIDENCE_LABELS,
  HUBSPOT_STATUS_LABELS,
  IN_HUBSPOT_STATUSES,
  LEAD_STATUS_LABELS,
  NEW_LEAD_STATUSES,
  ORIGIN_LABELS,
  RESULT_LABELS,
  TIER_LABELS,
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
  tier: 'desc',
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

/** A tier as the leads filter takes it: A, B, C, Discard, or `none`, a lead with no tier yet. */
export type TierPick = NonNullable<NonNullable<QueryOf<'list_leads'>>['tier']>[number]

/** Every tier the filter offers, in the facets' order. */
export const TIER_PICK_ORDER: readonly TierPick[] = ['A', 'B', 'C', 'discard', 'none']

export const TIER_PICK_LABELS: Record<TierPick, string> = { ...TIER_LABELS, none: 'No tier yet' }

/** The default view (PLAN-V21 choice 9): Tier A, B and C, and the leads with no tier yet. */
export const DEFAULT_TIERS: readonly TierPick[] = ['A', 'B', 'C', 'none']

/** A city group a lead can be in. "All of Australia" is a way to search, not a lead's place. */
export type LeadCityGroup = Exclude<CityGroup, 'national'>

const LEAD_CITY_GROUPS: Record<LeadCityGroup, string> = {
  priority: CITY_GROUP_LABELS.priority,
  secondary: CITY_GROUP_LABELS.secondary,
  capital: CITY_GROUP_LABELS.capital,
  regional: CITY_GROUP_LABELS.regional,
}

export interface LeadFilters {
  /** Tier A, B, C, Discard or no tier yet. Empty is every tier; the default is all but Discard. */
  tier: TierPick[]
  confidence: Confidence[]
  city_group: LeadCityGroup[]
  /** Only leads with something from Property Daily or Arealytics. */
  has_property: boolean
  /** Only the leads an exclusion left out. */
  excluded: boolean
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
  /**
   * Show the leads HubSpot has too (the "In HubSpot" chip is pressed). Off by default: Results shows
   * new leads only. Ignored while `hubspot_status` has a pick.
   */
  show_in_hubspot: boolean
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
  tier: [...DEFAULT_TIERS],
  confidence: [],
  city_group: [],
  has_property: false,
  excluded: false,
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
  show_in_hubspot: false,
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
  'confidence',
  'city_group',
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
  const tiers = oneOf(params.getAll('tier'), TIER_PICK_LABELS)
  const filters: LeadFilters = {
    ...NO_FILTERS,
    tier: params.getAll('tier').includes('all')
      ? []
      : tiers.length > 0
        ? TIER_PICK_ORDER.filter((tier) => tiers.includes(tier))
        : [...DEFAULT_TIERS],
    confidence: oneOf(params.getAll('confidence'), CONFIDENCE_LABELS),
    city_group: oneOf(params.getAll('city_group'), LEAD_CITY_GROUPS),
    has_property: params.get('has_property') === 'true',
    excluded: params.get('excluded') === 'true',
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
    show_in_hubspot: params.get('show_in_hubspot') === 'true',
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
  if (filters.tier.length === 0) {
    params.set('tier', 'all')
  } else if (!isDefaultTiers(filters.tier)) {
    for (const tier of filters.tier) {
      params.append('tier', tier)
    }
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
  if (filters.has_property) {
    params.set('has_property', 'true')
  }
  if (filters.excluded) {
    params.set('excluded', 'true')
  }
  if (filters.show_in_hubspot) {
    params.set('show_in_hubspot', 'true')
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

/** True for the default view's tiers, A, B, C and no tier yet, in any order. */
export function isDefaultTiers(tiers: readonly TierPick[]): boolean {
  return (
    tiers.length === DEFAULT_TIERS.length && DEFAULT_TIERS.every((tier) => tiers.includes(tier))
  )
}

/** True when the "In HubSpot" chip decides what shows: no HubSpot label is picked by hand. */
export function hubspotChipApplies(filters: LeadFilters): boolean {
  return filters.hubspot_status.length === 0
}

/** True when the leads HubSpot has are hidden: the default, until the chip is pressed. */
export function hidesInHubSpot(filters: LeadFilters): boolean {
  return hubspotChipApplies(filters) && !filters.show_in_hubspot
}

/**
 * How many leads the chip hides, or shows when pressed: the facets' count of In HubSpot, Open deal
 * and Dissolved deal. Those counts leave out the HubSpot filter itself, so the number is the same
 * pressed or not, and follows every other filter. Undefined until the facets arrive.
 */
export function inHubSpotCount(facets: LeadFacets | undefined): number | undefined {
  if (!facets) {
    return undefined
  }
  // A partial answer (an older server, a test stand-in) may leave the list out: none hidden then.
  const counts = (facets.hubspot_status as LeadFacets['hubspot_status'] | undefined) ?? []
  return counts
    .filter((item) => (IN_HUBSPOT_STATUSES as readonly string[]).includes(item.value))
    .reduce((sum, item) => sum + item.count, 0)
}

/** How many filters are set (a list with values counts once). For "Clear filters". */
export function activeFilterCount(filters: LeadFilters): number {
  let count = isDefaultTiers(filters.tier) ? 0 : 1
  if (filters.has_property) count += 1
  if (filters.excluded) count += 1
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

/** The filters every leads route takes, with PLAN-V16's. */
export type FilterQuery = NonNullable<QueryOf<'lead_facets'>>

/** The filters as the API takes them: empty values left out. Facets and the map use these. */
export function filterQuery(filters: LeadFilters): FilterQuery {
  const query: FilterQuery = {}
  // Every tier is spelled out too, so "every tier" never depends on the server's default: all five,
  // so a lead with no tier yet is in it.
  query.tier = filters.tier.length > 0 ? [...filters.tier] : [...TIER_PICK_ORDER]
  if (filters.confidence.length > 0) query.confidence = [...filters.confidence]
  if (filters.city_group.length > 0) query.city_group = [...filters.city_group]
  if (filters.has_property) query.has_property = true
  if (filters.excluded) query.excluded = true
  if (filters.result.length > 0) query.result = [...filters.result]
  if (filters.city.length > 0) query.city = [...filters.city]
  if (filters.trigger.length > 0) query.trigger = [...filters.trigger]
  if (filters.industry.length > 0) query.industry = [...filters.industry]
  if (filters.industry_group.length > 0) query.industry_group = [...filters.industry_group]
  if (filters.hubspot_status.length > 0) query.hubspot_status = [...filters.hubspot_status]
  else if (!filters.show_in_hubspot) query.hubspot_status = [...NEW_LEAD_STATUSES]
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
