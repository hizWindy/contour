/**
 * What Call logs asks for first (PLAN-V7 C1): the switches, the counts on its tabs, and the notes
 * for the tab in the address (To confirm, by default; History's first 50 with its filters). The
 * route loads this file when a navigation starts or a link is pointed at (module.tsx), so the call
 * notes hooks stay out of the first visit. The page asks with the same query options, so its
 * requests join these.
 *
 * Once the page is open and its own tab is in, `warmOtherTabs` asks quietly for the first list of
 * the other two tabs (Improvements 1, #10), so a click on a tab shows its rows at once.
 */
import type { QueryClient } from '@tanstack/react-query'
import {
  callNoteHistoryQueryOptions,
  callNoteOptionsQueryOptions,
  callNoteSummaryQueryOptions,
  callNotesQueryOptions,
} from '@/api/hooks/call-notes'
import { melbourneDate } from '@/lib/format'
import type { PrefetchArgs } from '@/shell/crumbs'
import { warmAfter } from '@/shell/warm'
import {
  CALL_LOGS_TABS,
  callLogsQuery,
  historyQuery,
  NO_FILTERS,
  readHistory,
  readTab,
  type CallLogsTab,
  type HistoryFilters,
} from './params'

/**
 * Starts a tab's first list. History asks with `history` (the address's filters). With `anyAge`,
 * a list that is there is not asked again, however old it is: for a request that only waits.
 */
function startTab(
  client: QueryClient,
  tab: CallLogsTab,
  history: HistoryFilters,
  anyAge = false,
): Promise<void> {
  // Left out, not `undefined`: an `undefined` would replace the cache's own 15 seconds with none.
  const age = anyAge ? { staleTime: Infinity } : {}
  if (tab === 'history') {
    return client.prefetchInfiniteQuery({
      ...callNoteHistoryQueryOptions(historyQuery(history, melbourneDate())),
      ...age,
    })
  }
  return client.prefetchQuery({ ...callNotesQueryOptions(callLogsQuery(tab)), ...age })
}

export function prefetchCallLogs({ client, search }: PrefetchArgs): void {
  void client.prefetchQuery(callNoteOptionsQueryOptions())
  void client.prefetchQuery(callNoteSummaryQueryOptions())
  void startTab(client, readTab(search), readHistory(search))
}

/**
 * Asks for the first list of the other two tabs, once `tab`'s own list is in and the browser is
 * idle. The other tabs' lists are the ones a click on a tab shows next: with no filters, as the
 * tabs open. Returns a way to stop it, for a page that is left first.
 *
 * The page's own list is only waited for: a request already on its way is joined, and one that is
 * there is not asked again, however old it is.
 */
export function warmOtherTabs(
  client: QueryClient,
  tab: CallLogsTab,
  history: HistoryFilters,
): () => void {
  return warmAfter(startTab(client, tab, history, true), () => {
    for (const other of CALL_LOGS_TABS) {
      if (other !== tab) {
        void startTab(client, other, NO_FILTERS)
      }
    }
  })
}
