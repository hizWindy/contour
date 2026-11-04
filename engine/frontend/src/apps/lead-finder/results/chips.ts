/**
 * The filters in use, as chips under the filter bar (PLAN-V6, E3): one chip for each value, so one
 * city of three can go on its own, and one for each other filter. Each chip says what it does in
 * words ("City: Perth", "Score: 60 or more") and knows the change that removes it.
 *
 * Plain functions, so they are tested on their own (chips.test.ts).
 */
import type { LeadFacets } from '@/api/types'
import { formatDate, formatDateTime, formatNumber, humanise } from '@/lib/format'
import {
  HUBSPOT_STATUS_LABELS,
  LEAD_STATUS_LABELS,
  ORIGIN_LABELS,
  RESULT_LABELS,
  RUN_MODE_LABELS,
} from '@/lib/labels'
import { NO_FILTERS, type LeadFilters } from './params'

export interface FilterChip {
  /** Unique among the chips, stable while the filter stays. */
  key: string
  /** What the chip says, like "City: Perth". */
  label: string
  /** The change that takes this one filter (or value) away. */
  remove: Partial<LeadFilters>
}

type ListKey = 'result' | 'city' | 'origin' | 'trigger' | 'industry' | 'industry_group'
type ListKeyWithStatus = ListKey | 'hubspot_status' | 'status'

const LIST_TITLES: Record<ListKeyWithStatus, string> = {
  result: 'Result',
  city: 'City',
  origin: 'Source',
  trigger: 'Sign',
  industry: 'Industry',
  industry_group: 'Industry group',
  hubspot_status: 'HubSpot',
  status: 'Status',
}

/** The order the chips sit in: the bar's own filters first, then the panel's, as they appear. */
const LIST_ORDER: readonly ListKeyWithStatus[] = [
  'result',
  'city',
  'origin',
  'trigger',
  'industry',
  'industry_group',
  'hubspot_status',
  'status',
]

function wordFor(key: ListKeyWithStatus, value: string, facets: LeadFacets | undefined): string {
  switch (key) {
    case 'result':
      return value in RESULT_LABELS ? RESULT_LABELS[value as keyof typeof RESULT_LABELS] : value
    case 'origin':
      return value in ORIGIN_LABELS ? ORIGIN_LABELS[value as keyof typeof ORIGIN_LABELS] : value
    case 'hubspot_status':
      return value in HUBSPOT_STATUS_LABELS
        ? HUBSPOT_STATUS_LABELS[value as keyof typeof HUBSPOT_STATUS_LABELS]
        : value
    case 'status':
      return value in LEAD_STATUS_LABELS
        ? LEAD_STATUS_LABELS[value as keyof typeof LEAD_STATUS_LABELS]
        : value
    case 'trigger':
      return facets?.trigger.find((item) => item.id === value)?.label ?? humanise(value)
    default:
      return value
  }
}

function runLabel(runId: string, facets: LeadFacets | undefined): string {
  const run = facets?.runs.find((item) => item.id === runId)
  if (!run) {
    return 'Run: one run'
  }
  return `Run: ${formatDateTime(run.created_at)}, ${RUN_MODE_LABELS[run.mode] ?? humanise(run.mode)}`
}

function rangeLabel(
  title: string,
  from: string | null,
  until: string | null,
  show: (value: string) => string,
  /** "until" for dates, "up to" for sizes. */
  upTo = 'until',
): string {
  if (from !== null && until !== null) return `${title}: ${show(from)} to ${show(until)}`
  if (from !== null) return `${title}: from ${show(from)}`
  return `${title}: ${upTo} ${show(until ?? '')}`
}

/** Every filter in use, as chips, in the order of the bar and then the panel. */
export function activeChips(filters: LeadFilters, facets?: LeadFacets): FilterChip[] {
  const chips: FilterChip[] = []
  const q = filters.q.trim()
  if (q !== '') {
    chips.push({ key: 'q', label: `Name: ${q}`, remove: { q: '' } })
  }
  for (const key of LIST_ORDER) {
    const picked: readonly string[] = filters[key]
    for (const value of picked) {
      chips.push({
        key: `${key}:${value}`,
        label: `${LIST_TITLES[key]}: ${wordFor(key, value, facets)}`,
        // The filtered list holds values of the same field, so it fits that field's type.
        remove: { [key]: picked.filter((item) => item !== value) },
      })
    }
  }
  if (filters.run_id) {
    chips.push({ key: 'run', label: runLabel(filters.run_id, facets), remove: { run_id: null } })
  }
  if (filters.created_since !== null || filters.created_until !== null) {
    chips.push({
      key: 'created',
      label: rangeLabel('Researched', filters.created_since, filters.created_until, formatDate),
      remove: { created_since: null, created_until: null },
    })
  }
  if (filters.trigger_since !== null) {
    chips.push({
      key: 'trigger_since',
      label: `Sign since ${formatDate(filters.trigger_since)}`,
      remove: { trigger_since: null },
    })
  }
  if (filters.min_score !== null) {
    chips.push({
      key: 'min_score',
      label: `Score: ${formatNumber(filters.min_score)} or more`,
      remove: { min_score: null },
    })
  }
  if (filters.office_m2_min !== null || filters.office_m2_max !== null) {
    const m2 = (value: string): string => `${formatNumber(Number(value))} m²`
    chips.push({
      key: 'office_m2',
      label: rangeLabel(
        'Office',
        filters.office_m2_min === null ? null : String(filters.office_m2_min),
        filters.office_m2_max === null ? null : String(filters.office_m2_max),
        m2,
        'up to',
      ),
      remove: { office_m2_min: null, office_m2_max: null },
    })
  }
  if (filters.include_tests) {
    chips.push({
      key: 'include_tests',
      label: 'Test set leads shown',
      remove: { include_tests: false },
    })
  }
  if (filters.facts_missing) {
    chips.push({
      key: 'facts_missing',
      label: 'Only leads with facts missing',
      remove: { facts_missing: false },
    })
  }
  return chips
}

/**
 * How many filters sit in the Filters panel and are in use (a list with values counts once), for
 * the number on the Filters button. On a laptop the bar shows the search, Result, City and Source
 * itself, so `inBar` leaves them out; on a phone every filter but the search is in the panel.
 */
export function panelFilterCount(filters: LeadFilters, inBar: boolean): number {
  const barKeys: readonly (keyof LeadFilters)[] = inBar ? ['result', 'city', 'origin'] : []
  let count = 0
  for (const key of Object.keys(NO_FILTERS) as (keyof LeadFilters)[]) {
    if (key === 'q' || barKeys.includes(key)) continue
    if (key === 'created_until' && filters.created_since !== null) continue // one date range
    if (key === 'office_m2_max' && filters.office_m2_min !== null) continue // one size range
    const value = filters[key]
    const used = Array.isArray(value) ? value.length > 0 : value !== null && value !== false
    if (used) count += 1
  }
  return count
}
