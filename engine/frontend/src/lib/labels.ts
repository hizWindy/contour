/**
 * The words for the fixed lists the backend sends (results, statuses). One place, so a result or
 * a status reads the same in a badge, a table, a filter and a feed line. Sentence case, no
 * abbreviations (DESIGN.md, "Words on screen").
 */
import type {
  CityGroup,
  Confidence,
  HubSpotStatus,
  LeadOrigin,
  LeadResult,
  LeadStatus,
  RunSourceId,
  RunStatus,
  Tier,
} from '@/api/types'
import { humanise, pluralise } from './format'

/**
 * A lead's tier (PLAN-V16 T1-6, Levi's section 6), best first. The tier is the headline; the four
 * results stay (the plan's choice 1): A or B is a Pass or a Director review, C a Watch, Discard a
 * Drop. A tier is shown in words, never in colour: colour stays with the results (DESIGN.md).
 */
export const TIER_ORDER: readonly Tier[] = ['A', 'B', 'C', 'discard']

export const TIER_LABELS: Record<Tier, string> = { A: 'A', B: 'B', C: 'C', discard: 'Discard' }

/** False for a lead saved before tiers and not yet judged again: it has no tier to show. */
export function isTier(value: unknown): value is Tier {
  return typeof value === 'string' && Object.hasOwn(TIER_LABELS, value)
}

/** What each tier asks for, in Levi's words. */
export const TIER_ACTIONS: Record<Tier, string> = {
  A: 'Pursue now',
  B: 'Nurture',
  C: 'Watch',
  discard: 'Do not list',
}

export const CONFIDENCE_ORDER: readonly Confidence[] = ['high', 'medium', 'low']

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

/**
 * The four city groups (PLAN-V16 T1-2), in the order the Start page and the filters show them.
 * `national` is "All of Australia", which comes before them on its own.
 */
export const CITY_GROUP_ORDER: readonly Exclude<CityGroup, 'national'>[] = [
  'priority',
  'secondary',
  'capital',
  'regional',
]

export const CITY_GROUP_LABELS: Record<CityGroup, string> = {
  priority: 'Priority',
  secondary: 'Secondary',
  capital: 'Capitals',
  regional: 'Regional',
  national: 'All of Australia',
}

/** Where a run looks for companies (PLAN-V16), in the order every page shows them. */
export const RUN_SOURCE_ORDER: readonly RunSourceId[] = ['web', 'property_daily', 'arealytics']

export const RUN_SOURCE_LABELS: Record<RunSourceId, string> = {
  web: 'The web',
  property_daily: 'Property Daily',
  arealytics: 'Arealytics',
}

/** Best first. The order of a legend and of the `result` sort. */
export const RESULT_ORDER: readonly LeadResult[] = ['pass', 'director_review', 'watch', 'drop']

export const RESULT_LABELS: Record<LeadResult, string> = {
  pass: 'Pass',
  director_review: 'Director review',
  watch: 'Watch',
  drop: 'Drop',
}

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  watching: 'Watching',
  rejected: 'Rejected',
  sent: 'Sent',
}

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Stopped',
  interrupted: 'Interrupted',
}

/**
 * How far back a run looks, in words (PLAN-V21 T1-2): "7 days", "30 days", "90 days" and
 * "6 months". Six months or more, in whole months, reads in months, the way people say it.
 */
export function sinceDaysLabel(days: number): string {
  return days >= 180 && days % 30 === 0 ? pluralise(days / 30, 'month') : pluralise(days, 'day')
}

/** The kinds of run, as the run pages name them. */
export const RUN_MODE_LABELS: Record<string, string> = {
  discovery: 'Find new leads',
  watchlist: 'HubSpot watchlist',
  company: 'Companies by name',
  testset: 'Test set',
}

export const HUBSPOT_STATUS_LABELS: Record<HubSpotStatus, string> = {
  new: 'New',
  in_hubspot: 'In HubSpot',
  open_deal: 'Open deal',
  dissolved_deal: 'Dissolved deal',
  possible_match: 'Possible match',
}

/**
 * Where a company came from (PLAN-V6, E2). Kept apart from the HubSpot label: "From HubSpot" says
 * how the company got into the list; the HubSpot label says whether HubSpot has it now.
 */
export const ORIGIN_ORDER: readonly LeadOrigin[] = ['hubspot', 'web', 'typed']

export const ORIGIN_LABELS: Record<LeadOrigin, string> = {
  hubspot: 'From HubSpot',
  web: 'Found',
  typed: 'Typed',
}

/** One line each, for the tooltip on the mark. */
export const ORIGIN_HINTS: Record<LeadOrigin, string> = {
  hubspot: 'From the HubSpot watchlist: a company already in HubSpot, checked again.',
  web: 'The research found this company on the web.',
  typed: 'A person typed this company name on the Start page.',
}

export function isLeadResult(value: unknown): value is LeadResult {
  return typeof value === 'string' && value in RESULT_LABELS
}

/** The label for a result, or a readable version of a value this build does not know. */
export function resultLabel(value: string): string {
  return isLeadResult(value) ? RESULT_LABELS[value] : humanise(value)
}

/** A run that has ended, one way or another. A run in one of these states has no live events. */
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  'done',
  'failed',
  'cancelled',
  'interrupted',
]

export function isTerminalRunStatus(status: string | null | undefined): boolean {
  return TERMINAL_RUN_STATUSES.some((terminal) => terminal === status)
}

/**
 * Every tier and "no tier yet", for a page that counts or lists every lead: a run's own leads and
 * Home's bar of results. With no tier asked, the leads API leaves Discards out (PLAN-V21 T2-4).
 */
export const EVERY_TIER: ('A' | 'B' | 'C' | 'discard' | 'none')[] = [
  'A',
  'B',
  'C',
  'discard',
  'none',
]
