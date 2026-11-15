/**
 * Activity's tab lives in the address (`?tab=logged`, `?tab=needs-look`; To confirm has none), so a
 * link, Back, or Home's quick button opens the right tab. Each tab reads one page of the rep's own
 * notes (`mine`). The page and its prefetch build the request the same way, from here.
 */
import type { CallNoteQuery, CallNoteState } from '@/api/v17'

export type ActivityTab = CallNoteState

/** The tabs, in order. */
export const ACTIVITY_TABS: readonly ActivityTab[] = ['to_confirm', 'logged', 'needs_look']

const TAB_PARAM = 'tab'

const IN_ADDRESS: Readonly<Record<ActivityTab, string | null>> = {
  to_confirm: null,
  logged: 'logged',
  needs_look: 'needs-look',
}

/** The batch is one page: about 10 calls, so 100 is plenty (TBC). */
export const TO_CONFIRM_LIMIT = 100
export const NEEDS_LOOK_LIMIT = 50
export const LOGGED_PAGE_SIZE = 25

export function readTab(search: URLSearchParams): ActivityTab {
  const value = search.get(TAB_PARAM)
  return ACTIVITY_TABS.find((tab) => IN_ADDRESS[tab] === value) ?? 'to_confirm'
}

/** The address's search with `tab` set (To confirm drops it). Other values stay. */
export function writeTab(search: URLSearchParams, tab: ActivityTab): URLSearchParams {
  const next = new URLSearchParams(search)
  const value = IN_ADDRESS[tab]
  if (value === null) {
    next.delete(TAB_PARAM)
  } else {
    next.set(TAB_PARAM, value)
  }
  return next
}

/** The request for one tab: the rep's own notes in that state. Logged is paged. */
export function activityQuery(tab: ActivityTab, pageIndex = 0): CallNoteQuery {
  switch (tab) {
    case 'to_confirm':
      return { state: 'to_confirm', mine: true, limit: TO_CONFIRM_LIMIT, offset: 0 }
    case 'needs_look':
      return { state: 'needs_look', mine: true, limit: NEEDS_LOOK_LIMIT, offset: 0 }
    case 'logged':
      return {
        state: 'logged',
        mine: true,
        limit: LOGGED_PAGE_SIZE,
        offset: pageIndex * LOGGED_PAGE_SIZE,
      }
  }
}
