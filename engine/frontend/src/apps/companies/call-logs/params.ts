/**
 * Call logs' tab lives in the address (`?tab=history`, `?tab=needs-look`; To confirm has none), so
 * a link, Back, or Home's quick button opens the right tab. Each tab reads one page of the rep's
 * own notes (`mine`). The page and its prefetch build the request the same way, from here.
 *
 * `?log=1` (Ctrl+K's "Log a call", PLAN-V17 T3-7) opens the company picker once. The page then
 * takes it out of the address with `replace`, so Back, Forward or a reload never opens the picker
 * again.
 *
 * The page was called Activity until PLAN-V18 (T3-2). Its old address still works: the route sends
 * it on with its tab and `log=1` (`old-address.ts`), and the old tab `logged` reads as History.
 */
import type { CallNoteQuery } from '@/api/types'

export type CallLogsTab = 'to_confirm' | 'history' | 'needs_look'

/** Call logs' address. */
export const CALL_LOGS_PATH = '/companies/call-logs'

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
export const LOGGED_PAGE_SIZE = 25

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
 * A link to Call logs on one tab, like "/companies/call-logs?tab=needs-look". With `log`, the page
 * opens with its company picker open.
 */
export function callLogsHref(tab: CallLogsTab = 'to_confirm', { log = false } = {}): string {
  const search = writeTab(new URLSearchParams(), tab)
  if (log) search.set(LOG_PARAM, '1')
  const query = search.toString()
  return query ? `${CALL_LOGS_PATH}?${query}` : CALL_LOGS_PATH
}

/**
 * The request for one tab: the rep's own notes in that state. Until History is built (T3-6), its
 * tab shows Activity's Logged list, paged.
 */
export function callLogsQuery(tab: CallLogsTab, pageIndex = 0): CallNoteQuery {
  switch (tab) {
    case 'to_confirm':
      return { state: 'to_confirm', mine: true, limit: TO_CONFIRM_LIMIT, offset: 0 }
    case 'needs_look':
      return { state: 'needs_look', mine: true, limit: NEEDS_LOOK_LIMIT, offset: 0 }
    case 'history':
      return {
        state: 'logged',
        mine: true,
        limit: LOGGED_PAGE_SIZE,
        offset: pageIndex * LOGGED_PAGE_SIZE,
      }
  }
}
