/**
 * Meetings and the pre-meeting form (PLAN-V17 Stage B). Typed by hand until M5 (`v17.ts`,
 * `apiV17`), with Track 2's real names.
 *
 * - **No options route.** While pre-meeting forms are switched off, every meetings route answers
 *   409 `meeting_forms_off` (`isMeetingFormsOff`), so a page learns the switch from its own read.
 * - A page of meetings, Upcoming or Past, the rep's own or the team's, maybe searched, each with
 *   its form's status, and whether HubSpot's meetings are read (`meetings_state`, `sentence`). A
 *   page asks again by itself every 3 seconds while a form on it is being drafted, then stops.
 * - Starting a form ("Draft it" on a row, or New pre-read) answers with the form, still drafting.
 *   Its row shows that at once, and the form goes in the cache for the pre-read page (T3-10).
 * - The pre-read (T3-10): the form, asked again every 2 seconds while it is drafted; the rep's
 *   edits, shown at once and put back if the server says no; a redraft; and the HubSpot meeting
 *   it is for, which has its link.
 *
 * Only the Meetings pages import this file, so none of it is in the first visit (T3-5's rule).
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
  MeetingDetail,
  MeetingFormOut,
  MeetingFormPatch,
  MeetingFormStart,
  MeetingFormState,
  MeetingItem,
  MeetingPage,
  MeetingQuery,
} from '../v17'
import { apiV17 } from '../v17-client'

/** How often a page with a form still being drafted asks again. */
export const DRAFTING_POLL_MS = 3000

/** The server said pre-meeting forms are switched off (a 409 `meeting_forms_off`). */
export function isMeetingFormsOff(error: unknown): boolean {
  return isApiProblem(error) && error.status === 409 && error.code === 'meeting_forms_off'
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

/** Whether a row is the form's meeting: the same pre-read, or the HubSpot meeting it is for. */
function isRowOf(item: MeetingItem, form: MeetingFormState, meetingId: string | null): boolean {
  return item.form?.id === form.id || (meetingId !== null && item.meeting.id === meetingId)
}

/**
 * Puts a form, in short, on its meeting's row, in every page of meetings in the cache that holds
 * it: the row of the same pre-read, or of the HubSpot meeting it was just started for. Every page
 * of meetings then counts as old, so the next look reads the rest from the server (a typed meeting
 * joins its list then).
 */
export function putFormOnRows(
  client: QueryClient,
  form: MeetingFormState,
  meetingId: string | null,
): void {
  client.setQueriesData<MeetingPage>({ queryKey: queryKeys.companies.meetingLists() }, (page) =>
    page?.items.some((item) => isRowOf(item, form, meetingId))
      ? {
          ...page,
          items: page.items.map((item) =>
            isRowOf(item, form, meetingId)
              ? { ...item, form: { id: form.id, status: form.status } }
              : item,
          ),
        }
      : page,
  )
  void client.invalidateQueries({
    queryKey: queryKeys.companies.meetingLists(),
    refetchType: 'none',
  })
}

/**
 * POST /companies/meetings/forms. It answers at once with the form, still drafting (201, or 200
 * with a HubSpot meeting's own form): the facts and the summaries are written in the background.
 * The form goes in the cache for its page, and its row shows it.
 */
export function startMeetingFormOptions(client: QueryClient) {
  return mutationOptions<MeetingFormOut, ApiProblem, MeetingFormStart>({
    mutationKey: [...queryKeys.companies.meetings(), 'start'],
    mutationFn: async (body) => unwrap(await apiV17.POST('/companies/meetings/forms', { body })),
    onSuccess: (form) => {
      client.setQueryData(queryKeys.companies.meetingForm(form.id), form)
      putFormOnRows(client, form, form.meeting.meeting_id)
    },
  })
}

export function useStartMeetingForm() {
  const client = useQueryClient()
  return useMutation(startMeetingFormOptions(client))
}

// --- The pre-read (T3-10) -------------------------------------------------------------------

/** How often the pre-read's page asks again while its form is being drafted. */
export const FORM_POLL_MS = 2000

/** Every 2 seconds while the form is being drafted; not at all once it is ready, sent or failed. */
export function formPollMs(form: MeetingFormOut | undefined): number | false {
  return form?.status === 'drafting' ? FORM_POLL_MS : false
}

/**
 * A pre-read that isn't there for this person: 404 `form_not_found`, or an address whose id can't
 * be a pre-read's (the server answers 422 for that).
 */
export function isFormMissing(error: unknown): error is ApiProblem {
  return isApiProblem(error) && (error.status === 404 || error.status === 422)
}

/**
 * GET /companies/meetings/forms/{form_id}. It asks again every 2 seconds while the form is drafted
 * (the facts come a moment after it starts, then the summaries), and stops once it is ready, sent
 * or failed, or while a read is failing (the connection bar runs it again when the server is back).
 */
export function meetingFormQueryOptions(formId: string) {
  return queryOptions({
    queryKey: queryKeys.companies.meetingForm(formId),
    queryFn: async ({ signal }): Promise<MeetingFormOut> =>
      unwrap(
        await apiV17.GET('/companies/meetings/forms/{form_id}', {
          params: { path: { form_id: formId } },
          signal,
        }),
      ),
    refetchInterval: (query) =>
      query.state.status === 'error' ? false : formPollMs(query.state.data),
  })
}

export function useMeetingForm(formId: string) {
  return useQuery(meetingFormQueryOptions(formId))
}

/** A HubSpot meeting changes rarely while its pre-read is open: its link least of all. */
const MEETING_FRESH_MS = 5 * 60_000

/**
 * GET /companies/meetings/{meeting_id}: the HubSpot meeting a pre-read is for, which has its link
 * in HubSpot (the form's own copy of the meeting doesn't). None for a meeting typed in.
 */
export function useMeeting(meetingId: string | null) {
  return useQuery({
    queryKey: queryKeys.companies.meeting(meetingId ?? ''),
    queryFn: async ({ signal }): Promise<MeetingDetail> =>
      unwrap(
        await apiV17.GET('/companies/meetings/{meeting_id}', {
          params: { path: { meeting_id: meetingId ?? '' } },
          signal,
        }),
      ),
    enabled: Boolean(meetingId),
    staleTime: MEETING_FRESH_MS,
  })
}

export interface EditFormVariables {
  /** What the server is told: only the parts sent change. */
  patch: MeetingFormPatch
  /** The same edit, made to the form on screen at once. None: the page waits for the answer. */
  apply?: (form: MeetingFormOut) => MeetingFormOut
}

interface EditFormContext {
  before: MeetingFormOut | undefined
}

/**
 * PATCH /companies/meetings/forms/{form_id}: the rep's edit. With `apply`, the page shows it at
 * once, and goes back to what it was if the server says no. The server's answer takes its place
 * once no other edit to the form is on its way; when the last has answered, the form counts as
 * old, so the next look reads what the server holds. Each caller has its own mutation, so a
 * summary's save and a blank's never answer each other's callbacks.
 */
export function useEditMeetingForm(formId: string) {
  const client = useQueryClient()
  const key = queryKeys.companies.meetingForm(formId)
  const mutationKey = [...queryKeys.companies.meetings(), 'edit', formId] as const
  return useMutation<MeetingFormOut, ApiProblem, EditFormVariables, EditFormContext>({
    mutationKey,
    mutationFn: async ({ patch }) =>
      unwrap(
        await apiV17.PATCH('/companies/meetings/forms/{form_id}', {
          params: { path: { form_id: formId } },
          body: patch,
        }),
      ),
    onMutate: async ({ apply }) => {
      if (!apply) return { before: undefined }
      // An older answer on its way must not land on top of the edit.
      await client.cancelQueries({ queryKey: key })
      const before = client.getQueryData<MeetingFormOut>(key)
      if (before) client.setQueryData(key, apply(before))
      return { before }
    },
    onError: (_error, _variables, context) => {
      if (context?.before) client.setQueryData(key, context.before)
    },
    onSuccess: (form) => {
      // This edit still counts while it settles: 1 means no other edit is on its way.
      if (client.isMutating({ mutationKey }) <= 1) client.setQueryData(key, form)
    },
    onSettled: () => {
      if (client.isMutating({ mutationKey }) <= 1) {
        void client.invalidateQueries({ queryKey: key, refetchType: 'none' })
      }
    },
  })
}

/** The server is already writing this pre-read (a 409 `form_drafting`). */
export function isStillDrafting(error: unknown): boolean {
  return isApiProblem(error) && error.status === 409 && error.code === 'form_drafting'
}

/**
 * POST /companies/meetings/forms/{form_id}/redraft (202): the three summaries again, which costs
 * money. The page shows the form drafting at once, so its summaries turn to the still skeleton and
 * the page starts asking every 2 seconds. If the server says no, the form goes back as it was;
 * if it says the form is drafting already, the page keeps showing that and reads it again.
 */
export function useRedraftMeetingForm(formId: string) {
  const client = useQueryClient()
  const key = queryKeys.companies.meetingForm(formId)
  return useMutation<MeetingFormOut, ApiProblem, undefined, EditFormContext>({
    mutationKey: [...queryKeys.companies.meetings(), 'redraft', formId],
    mutationFn: async () =>
      unwrap(
        await apiV17.POST('/companies/meetings/forms/{form_id}/redraft', {
          params: { path: { form_id: formId } },
        }),
      ),
    onMutate: async () => {
      await client.cancelQueries({ queryKey: key })
      const before = client.getQueryData<MeetingFormOut>(key)
      if (before) client.setQueryData(key, { ...before, status: 'drafting' as const, error: null })
      return { before }
    },
    onError: (error, _variables, context) => {
      if (isStillDrafting(error)) {
        void client.invalidateQueries({ queryKey: key })
        return
      }
      if (context?.before) client.setQueryData(key, context.before)
    },
    onSuccess: (form) => {
      client.setQueryData(key, form)
    },
  })
}
