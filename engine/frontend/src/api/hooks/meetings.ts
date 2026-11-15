/**
 * Meetings and the pre-meeting form (PLAN-V17 Stage B). Typed by hand until M5 (`v17.ts`,
 * `apiV17`).
 *
 * - The options say whether pre-meeting forms are on, and whether meetings come from HubSpot yet,
 *   with the server's sentence when they don't.
 * - A page of meetings, Upcoming or Past, the rep's own or the team's, maybe searched, each with
 *   its form's status. A page asks again by itself every 3 seconds while a form on it is being
 *   drafted, then stops.
 * - Starting a form ("Draft it" on a row, or New pre-read) answers with the form, still drafting.
 *   Its row shows that at once, and the form goes in the cache for the pre-read page (T3-10).
 *
 * Only the Meetings page imports this file, so none of it is in the first visit (T3-5's rule).
 */
import {
  mutationOptions,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { isApiProblem, unwrap, type ApiProblem } from '../client'
import { queryKeys } from '../query'
import type {
  MeetingFormOut,
  MeetingFormRef,
  MeetingFormStart,
  MeetingItem,
  MeetingOptions,
  MeetingPage,
  MeetingQuery,
} from '../v17'
import { apiV17 } from '../v17-client'

/** How often a page with a form still being drafted asks again. */
export const DRAFTING_POLL_MS = 3000

/** The switch changes rarely (an Admin, on the Settings page), so a minute of fresh is fine. */
const OPTIONS_FRESH_MS = 60_000

/** The server said pre-meeting forms are switched off (a 409 `meeting_forms_off`). */
export function isMeetingFormsOff(error: unknown): boolean {
  return isApiProblem(error) && error.status === 409 && error.code === 'meeting_forms_off'
}

/** Whether pre-meeting forms are on, and whether meetings come from HubSpot yet. */
export function meetingOptionsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.companies.meetingOptions(),
    queryFn: async ({ signal }): Promise<MeetingOptions> =>
      unwrap(await apiV17.GET('/companies/meetings/options', { signal })),
    staleTime: OPTIONS_FRESH_MS,
  })
}

export function useMeetingOptions() {
  return useQuery(meetingOptionsQueryOptions())
}

/** Every 3 seconds while a form on the page is being drafted, and not at all once none is. */
export function meetingsPollMs(items: readonly MeetingItem[] | undefined): number | false {
  return items?.some((item) => item.form?.status === 'drafting') ? DRAFTING_POLL_MS : false
}

/** GET /companies/meetings: a page of meetings, by `when`, `mine` and `q`. */
export function meetingsQueryOptions(query: MeetingQuery) {
  return queryOptions({
    queryKey: queryKeys.companies.meetingList(query),
    queryFn: async ({ signal }): Promise<MeetingPage> =>
      unwrap(await apiV17.GET('/companies/meetings', { params: { query }, signal })),
    refetchInterval: (current) => meetingsPollMs(current.state.data?.items),
  })
}

/** The filters a cached page of meetings was asked with. */
function queryOf(key: readonly unknown[] | undefined): MeetingQuery | undefined {
  return key?.[3] as MeetingQuery | undefined
}

/**
 * A new search or another page of the same list keeps showing the list it has (dimmed by the
 * page) until the next one comes. Upcoming and Past, or the rep's own and the team's, are other
 * lists: those show their own loading shape instead of the wrong list.
 */
export function useMeetings(query: MeetingQuery, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    ...meetingsQueryOptions(query),
    enabled,
    placeholderData: (previous, previousQuery) => {
      const before = queryOf(previousQuery?.queryKey)
      return before && before.when === query.when && before.mine === query.mine
        ? previous
        : undefined
    },
  })
}

/** Puts a form on its meeting's row, in every page of meetings in the cache that holds it. */
export function putFormOnRows(client: QueryClient, meetingId: string, form: MeetingFormRef): void {
  client.setQueriesData<MeetingPage>({ queryKey: queryKeys.companies.meetingLists() }, (page) =>
    page?.items.some((item) => item.id === meetingId)
      ? {
          ...page,
          items: page.items.map((item) => (item.id === meetingId ? { ...item, form } : item)),
        }
      : page,
  )
}

export interface StartMeetingFormVariables {
  body: MeetingFormStart
  /** For a meeting typed in: one key for each New pre-read, so a retry is one form. */
  idempotencyKey?: string
}

/**
 * POST /companies/meetings/forms. It answers at once with the form, still drafting: the summaries
 * are written in the background. The form goes in the cache for its page, its row shows it, and
 * every page of meetings counts as old, so a typed meeting joins its list when the list shows.
 */
export function startMeetingFormOptions(client: QueryClient) {
  return mutationOptions<MeetingFormOut, ApiProblem, StartMeetingFormVariables>({
    mutationKey: [...queryKeys.companies.meetings(), 'start'],
    mutationFn: async ({ body, idempotencyKey }) =>
      unwrap(
        await apiV17.POST('/companies/meetings/forms', {
          body,
          ...(idempotencyKey ? { params: { header: { 'idempotency-key': idempotencyKey } } } : {}),
        }),
      ),
    onSuccess: (form) => {
      client.setQueryData(queryKeys.companies.meetingForm(form.id), form)
      if (form.meeting.id !== null) {
        putFormOnRows(client, form.meeting.id, { id: form.id, status: form.status })
      }
      void client.invalidateQueries({
        queryKey: queryKeys.companies.meetingLists(),
        refetchType: 'none',
      })
    },
  })
}

export function useStartMeetingForm() {
  const client = useQueryClient()
  return useMutation(startMeetingFormOptions(client))
}
