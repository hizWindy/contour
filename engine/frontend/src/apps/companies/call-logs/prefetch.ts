/**
 * What Call logs asks for first (PLAN-V7 C1): the switches, the counts on its tabs, and the notes
 * for the tab in the address (To confirm, by default; History's first 50 with its filters). The
 * route loads this file when a navigation starts or a link is pointed at (module.tsx), so the call
 * notes hooks stay out of the first visit. The page asks with the same query options, so its
 * requests join these.
 */
import {
  callNoteHistoryQueryOptions,
  callNoteOptionsQueryOptions,
  callNoteSummaryQueryOptions,
  callNotesQueryOptions,
} from '@/api/hooks/call-notes'
import { melbourneDate } from '@/lib/format'
import type { PrefetchArgs } from '@/shell/crumbs'
import { callLogsQuery, historyQuery, readHistory, readTab } from './params'

export function prefetchCallLogs({ client, search }: PrefetchArgs): void {
  void client.prefetchQuery(callNoteOptionsQueryOptions())
  void client.prefetchQuery(callNoteSummaryQueryOptions())
  const tab = readTab(search)
  if (tab === 'history') {
    void client.prefetchInfiniteQuery(
      callNoteHistoryQueryOptions(historyQuery(readHistory(search), melbourneDate())),
    )
  } else {
    void client.prefetchQuery(callNotesQueryOptions(callLogsQuery(tab)))
  }
}
