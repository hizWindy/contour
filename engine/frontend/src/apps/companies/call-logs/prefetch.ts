/**
 * What Call logs asks for first (PLAN-V7 C1): the switches, the counts on its tabs, and the page of
 * notes for the tab in the address (To confirm, by default). The route loads this file when a
 * navigation starts or a link is pointed at (module.tsx), so the call notes hooks stay out of the
 * first visit. The page asks with the same query options, so its requests join these.
 */
import {
  callNoteOptionsQueryOptions,
  callNoteSummaryQueryOptions,
  callNotesQueryOptions,
} from '@/api/hooks/call-notes'
import type { PrefetchArgs } from '@/shell/crumbs'
import { callLogsQuery, readTab } from './params'

export function prefetchCallLogs({ client, search }: PrefetchArgs): void {
  void client.prefetchQuery(callNoteOptionsQueryOptions())
  void client.prefetchQuery(callNoteSummaryQueryOptions())
  void client.prefetchQuery(callNotesQueryOptions(callLogsQuery(readTab(search))))
}
