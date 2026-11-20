/**
 * Call logs' tab lives in the address (`?tab=history`, `?tab=needs-look`; To confirm has none), so
 * a link, Back, or Home's quick button opens the right tab. Each tab reads one page of the rep's
 * own notes (`mine`). The page and its prefetch build the request the same way, from here.
 *
 * `?log=1` (Ctrl+K's "Log a call", PLAN-V17 T3-7) opens the company picker once. The page then
 * takes it out of the address with `replace`, so Back, Forward or a reload never opens the picker
 * again.
 *
 * The page was called Activity until PLAN-V18 (T3-2), and sat under Companies until PLAN-V22
 * (T2-1): it is the Assistant's now, at `/assistant/call-logs`. Its old addresses still work: the
 * route sends them on with their tab and `log=1` (`apps/assistant/old-addresses.ts`), and the old
 * tab `logged` reads as History.
 */
import type { CallNoteOutcomeFilter, CallNoteQuery, CallNoteState } from '@/api/types'
import { CALL_LOGS_PATH } from '@/apps/assistant/paths'

export type CallLogsTab = 'to_confirm' | 'history' | 'needs_look'

/** Call logs' address, kept with the Assistant's others. */
export { CALL_LOGS_PATH }

/** The tabs, in order. */
export const CALL_LOGS_TABS: readonly CallLogsTab[] = ['to_confirm', 'history', 'needs_look']

const TAB_PARAM = 'tab'
const LOG_PARAM = 'log'

const IN_ADDRESS: Readonly<Record<CallLogsTab, string | null>> = {
  to_confirm: null,
  history: 'history',
  needs_look: 'needs-look',
}

/** The tab Activity called Logged (PLAN-V17): History took its place. */
const OLD_LOGGED = 'logged'

/** The batch is one page: about 10 calls, so 100 is plenty (TBC). */
export const TO_CONFIRM_LIMIT = 100
export const NEEDS_LOOK_LIMIT = 50
/** The calls saved before their company was found (PLAN-V24 T3-3): one page, newest first. */
export const NEEDS_COMPANY_LIMIT = 50
/** How many of them the group shows before "Show all", so the tabs stay near the top (TBC). */
export const NEEDS_COMPANY_SHOWN = 3

export function readTab(search: URLSearchParams): CallLogsTab {
  const value = search.get(TAB_PARAM)
  if (value === OLD_LOGGED) return 'history'
  return CALL_LOGS_TABS.find((tab) => IN_ADDRESS[tab] === value) ?? 'to_confirm'
}

/** The address's search with `tab` set (To confirm drops it). Other values stay. */
export function writeTab(search: URLSearchParams, tab: CallLogsTab): URLSearchParams {
  const next = new URLSearchParams(search)
  const value = IN_ADDRESS[tab]
  if (value === null) {
    next.delete(TAB_PARAM)
  } else {
    next.set(TAB_PARAM, value)
  }
  return next
}

/** True when the address asks for the company picker to open (`?log=1`). */
export function readLog(search: URLSearchParams): boolean {
  return search.get(LOG_PARAM) === '1'
}

/** The address's search without `log`. Other values stay. */
export function withoutLog(search: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(search)
  next.delete(LOG_PARAM)
  return next
}

/**
 * A link to Call logs on one tab, like "/assistant/call-logs?tab=needs-look". With `log`, the page
 * opens with its company picker open.
 */
export function callLogsHref(tab: CallLogsTab = 'to_confirm', { log = false } = {}): string {
  const search = writeTab(new URLSearchParams(), tab)
  if (log) search.set(LOG_PARAM, '1')
  const query = search.toString()
  return query ? `${CALL_LOGS_PATH}?${query}` : CALL_LOGS_PATH
}

const LIMITS = {
  to_confirm: TO_CONFIRM_LIMIT,
  needs_look: NEEDS_LOOK_LIMIT,
  needs_company: NEEDS_COMPANY_LIMIT,
} as const

/**
 * The request for To confirm, Needs a look, or the calls that need a company (PLAN-V24, the group
 * at the top of the page): the rep's own notes in that state.
 */
export function callLogsQuery(state: keyof typeof LIMITS): CallNoteQuery {
  return { state, mine: true, limit: LIMITS[state], offset: 0 }
}

// --- History's search and filters (PLAN-V18 T3-6), in the address too ---------------------------

/** When: this week (from Monday), this month (from the 1st), or all. */
export type HistoryWhen = 'week' | 'month' | 'all'

/**
 * Where it stands: any, in HubSpot, or needs a look. "To confirm" isn't one: the server lists
 * those the way a batch is worked through (the unsure first, then the oldest call), not newest
 * first as History's days need, and the To confirm tab lists them already. An old link that asks
 * for them (`where=to-confirm`) opens History unfiltered.
 */
export type HistoryWhere = 'all' | 'logged' | 'needs_look'

export interface HistoryFilters {
  q: string
  outcome: CallNoteOutcomeFilter | null
  when: HistoryWhen
  where: HistoryWhere
}

export const NO_FILTERS: HistoryFilters = { q: '', outcome: null, when: 'all', where: 'all' }

/** The longest search the server takes. */
export const SEARCH_MAX = 200

const OUTCOMES: readonly CallNoteOutcomeFilter[] = [
  'Connected',
  'No answer',
  'Left voicemail',
  'Left live message',
  'Busy',
  'Wrong number',
  'none',
]

const WHERE_IN_ADDRESS: Readonly<Record<HistoryWhere, string | null>> = {
  all: null,
  logged: 'hubspot',
  needs_look: 'needs-look',
}

const WHEN_VALUES: readonly HistoryWhen[] = ['week', 'month', 'all']

export function readHistory(search: URLSearchParams): HistoryFilters {
  const outcome = search.get('outcome')
  const when = search.get('when')
  const where = search.get('where')
  return {
    q: (search.get('q') ?? '').slice(0, SEARCH_MAX),
    outcome: OUTCOMES.find((value) => value === outcome) ?? null,
    when: WHEN_VALUES.find((value) => value === when) ?? 'all',
    where:
      (Object.keys(WHERE_IN_ADDRESS) as HistoryWhere[]).find(
        (value) => WHERE_IN_ADDRESS[value] === where && where !== null,
      ) ?? 'all',
  }
}

/** The address's search with History's filters set; the defaults are left out. */
export function writeHistory(search: URLSearchParams, filters: HistoryFilters): URLSearchParams {
  const next = new URLSearchParams(search)
  const set = (name: string, value: string | null): void => {
    if (value) next.set(name, value)
    else next.delete(name)
  }
  set('q', filters.q.trim() || null)
  set('outcome', filters.outcome)
  set('when', filters.when === 'all' ? null : filters.when)
  set('where', WHERE_IN_ADDRESS[filters.where])
  return next
}

/** True when any filter or a search is on. */
export function filtered(filters: HistoryFilters): boolean {
  return (
    filters.q.trim() !== '' ||
    filters.outcome !== null ||
    filters.when !== 'all' ||
    filters.where !== 'all'
  )
}

/** A day as YYYY-MM-DD, `days` from `date`. */
export function addDays(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() + days)
  return day.toISOString().slice(0, 10)
}

/** The first day `when` covers, in Melbourne time: Monday of this week, or the 1st of the month. */
export function sinceOf(when: HistoryWhen, today: string): string | undefined {
  if (when === 'month') return `${today.slice(0, 8)}01`
  if (when === 'week') {
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay()
    return addDays(today, -((weekday + 6) % 7))
  }
  return undefined
}

/** History's request: the rep's own notes, with the filters. */
export function historyQuery(filters: HistoryFilters, today: string): CallNoteQuery {
  const state: CallNoteState = filters.where === 'all' ? 'history' : filters.where
  const query: CallNoteQuery = { state, mine: true }
  const q = filters.q.trim()
  if (q) query.q = q.slice(0, SEARCH_MAX)
  if (filters.outcome) query.outcome = filters.outcome
  const since = sinceOf(filters.when, today)
  if (since) query.since = since
  return query
}
