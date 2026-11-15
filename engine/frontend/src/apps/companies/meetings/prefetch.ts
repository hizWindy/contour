/**
 * What Meetings asks for first (PLAN-V7 C1): the switch, and the list for the view in the address
 * (Upcoming, the rep's own, by default). The route loads this file when a navigation starts or a
 * link is pointed at (module.tsx), so the meetings hooks stay out of the first visit. The page
 * asks with the same query options, so its requests join these.
 */
import { meetingOptionsQueryOptions, meetingsQueryOptions } from '@/api/hooks/meetings'
import type { PrefetchArgs } from '@/shell/crumbs'
import { meetingsQuery, readMeetings } from './params'

export function prefetchMeetings({ client, search }: PrefetchArgs): void {
  void client.prefetchQuery(meetingOptionsQueryOptions())
  void client.prefetchQuery(meetingsQueryOptions(meetingsQuery(readMeetings(search))))
}
