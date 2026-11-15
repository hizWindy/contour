/**
 * Whether pre-meeting forms are on, and the counts for Home (PLAN-V17 T3-11): the part of the
 * meetings hooks that Home's "Upcoming meetings" card and Ctrl+K's "Pre-read for a meeting" need.
 * They load with those parts, late and small. The rest of the meetings hooks (`meetings.ts`, which
 * re-exports these) load only with the Meetings pages.
 *
 * There is no options route: while the switch is off, every meetings route answers 409
 * `meeting_forms_off`, the summary too, and the parts show nothing. A 4xx is never asked again by
 * itself (`shouldRetry`), so that one answer settles it.
 *
 * Who asks: only a person who sees Companies. The menu, Home and Ctrl+K draw a project's parts only
 * for the projects this person may use (`useVisibleModules`), so for anyone else nothing here runs.
 */
import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'
import { isApiProblem, unwrap } from '../client'
import { queryKeys } from '../query'
import type { MeetingSummary } from '../v17'
import { apiV17 } from '../v17-client'

/** The server said pre-meeting forms are switched off (a 409 `meeting_forms_off`). */
export function isMeetingFormsOff(error: unknown): boolean {
  return isApiProblem(error) && error.status === 409 && error.code === 'meeting_forms_off'
}

/**
 * The counts' key, under every meetings query (`queryKeys.companies.meetings()`), so marking all
 * of those old marks it too. It lives here, not in `queryKeys`: that file is in every first visit,
 * and only the meetings files use this key.
 */
export function meetingSummaryKey() {
  return [...queryKeys.companies.meetings(), 'summary'] as const
}

/** GET /companies/meetings/summary: the rep's upcoming meetings that need a pre-read, and ready. */
export function meetingSummaryQueryOptions() {
  return queryOptions({
    queryKey: meetingSummaryKey(),
    queryFn: async ({ signal }): Promise<MeetingSummary> =>
      unwrap(await apiV17.GET('/companies/meetings/summary', { signal })),
  })
}

/** `enabled` false asks for nothing. Data: pre-meeting forms are on. A 409: they are off. */
export function useMeetingSummary(enabled = true) {
  return useQuery({ ...meetingSummaryQueryOptions(), enabled })
}

/**
 * The counts in the cache are marked old, without asking again now: a pre-read was started or
 * sent. The next place that shows them asks again.
 */
export function markMeetingSummaryOld(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: meetingSummaryKey(), refetchType: 'none' })
}
