/**
 * The words for the fixed lists the backend sends (results, statuses). One place, so a result or
 * a status reads the same in a badge, a table, a filter and a feed line. Sentence case, no
 * abbreviations (DESIGN.md, "Words on screen").
 */
import type { HubSpotStatus, LeadResult, LeadStatus, RunStatus } from '@/api/types'
import { humanise } from './format'

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
