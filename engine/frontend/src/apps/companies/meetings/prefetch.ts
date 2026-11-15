/**
 * What Meetings' pages ask for first (PLAN-V7 C1). The route loads this file when a navigation
 * starts or a link is pointed at (module.tsx), so the meetings hooks stay out of the first visit.
 * Each page asks with the same query options, so its request joins the one started here.
 *
 * - **Meetings:** the list for the view in the address (Upcoming, the rep's own, by default). The
 *   list also says whether pre-meeting forms are on (a 409 when they are off): there is no options
 *   route.
 * - **A pre-read** (T3-10): its form, by the id in the address, also on a first visit from the
 *   morning email's link, so the form downloads while the page's code does. One file for both
 *   keeps the first visit's list of files to fetch one shorter.
 */
import { meetingFormQueryOptions, meetingsQueryOptions } from '@/api/hooks/meetings'
import type { PrefetchArgs } from '@/shell/crumbs'
import { meetingsQuery, readMeetings } from './params'

export function prefetchMeetings({ client, search }: PrefetchArgs): void {
  void client.prefetchQuery(meetingsQueryOptions(meetingsQuery(readMeetings(search))))
}

export function prefetchPreRead({ client, params }: PrefetchArgs): void {
  const formId = params.formId
  if (formId) void client.prefetchQuery(meetingFormQueryOptions(formId))
}
