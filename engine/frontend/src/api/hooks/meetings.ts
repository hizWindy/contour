/**
 * Meetings and the pre-meeting form (PLAN-V17 Stage B).
 *
 * - **No options route.** While pre-meeting forms are switched off, every meetings route answers
 *   409 `meeting_forms_off` (`isMeetingFormsOff`), so a page learns the switch from its own read.
 * - A page of meetings, Upcoming or Past, everyone's, the rep's own or their HubSpot team's
 *   (`who`, PLAN-V18), maybe searched, each with its form's status, and whether HubSpot's meetings
 *   are read (`meetings_state`, `sentence`). A page asks again by itself every 3 seconds while a
 *   form on it is being drafted, then stops.
 * - Sync (PLAN-V18 T2-3) reads HubSpot's meetings now. While that runs, the pages ask again every
 *   2 seconds until it is done.
 * - Starting a form ("Draft it" on a row, or New pre-read) answers with the form, still drafting.
 *   Its row shows that at once, and the form goes in the cache for the pre-read page (T3-10).
 * - The pre-read (T3-10): the form, asked again every 2 seconds while it is drafted; the rep's
 *   edits, shown at once and put back if the server says no; a redraft; and the HubSpot meeting
 *   it is for, which has its link.
 * - Sending it (T3-11): the email as it would arrive and who would get it (the preview), then the
 *   send, whose answer puts the sent pre-read on its page and its row at once.
 * - Log meeting (T3-11): a past HubSpot meeting's transcript becomes a call note in the batch.
 *
 * Only the Meetings pages and the company's record import this file, so none of it is in the first
 * visit (T3-5's rule). Home and Ctrl+K need only the summary, in `meeting-summary.ts`.
 */
import {
  mutationOptions,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { useCallback, useSyncExternalStore } from 'react'
import { isApiProblem, unwrap, type ApiProblem } from '../client'
import { queryKeys } from '../query'
import type {
  CallNoteOut,
  FormEmailPreview,
  MeetingDetail,
  MeetingFormOut,
  MeetingFormPatch,
  MeetingFormStart,
  MeetingFormState,
  MeetingItem,
  MeetingPage,
  MeetingQuery,
  MeetingsSyncOut,
  MeetingTranscriptIn,
  TeamMember,
} from '@/api/types'
import { api } from '@/api/client'
import { markMeetingSummaryOld } from './meeting-summary'

// The switch and the counts sit in a small file of their own, because Home and Ctrl+K need them on
// every page (T3-11). They are the same functions here, not copies.
export {
  isMeetingFormsOff,
  markMeetingSummaryOld,
  meetingSummaryQueryOptions,
  useMeetingSummary,
} from './meeting-summary'

/** How often a page with a form still being drafted asks again. */
export const DRAFTING_POLL_MS = 3000

/** How often a page asks again while HubSpot's meetings are being read (Sync, PLAN-V18 T2-3). */
export const SYNC_POLL_MS = 2000

/** Every 3 seconds while a form on the page is being drafted, and not at all once none is. */
export function meetingsPollMs(items: readonly MeetingItem[] | undefined): number | false {
  return items?.some((item) => item.form?.status === 'drafting') ? DRAFTING_POLL_MS : false
}

/**
 * Every 2 seconds while HubSpot's meetings are being read, until `syncing` is false; otherwise
 * every 3 seconds while a form on the page is being drafted; otherwise not at all.
 */
export function listPollMs(page: MeetingPage | undefined): number | false {
  return page?.syncing === true ? SYNC_POLL_MS : meetingsPollMs(page?.items)
}

/** The cache key of one list of meetings, by its filters. */
export function meetingListKey(query: MeetingQuery) {
  return [...queryKeys.companies.meetingLists(), query] as const
}

/** GET /companies/meetings: a page of meetings, by `when`, `who` and `q`. */
export function meetingsQueryOptions(query: MeetingQuery) {
  return queryOptions({
    queryKey: meetingListKey(query),
    queryFn: async ({ signal }): Promise<MeetingPage> =>
      unwrap(await api.GET('/companies/meetings', { params: { query }, signal })),
    refetchInterval: (current) => listPollMs(current.state.data),
  })
}

/** The filters a cached page of meetings was asked with. */
function queryOf(key: readonly unknown[] | undefined): MeetingQuery | undefined {
  return key?.[3] as MeetingQuery | undefined
}

/**
 * A new search or another page of the same list keeps showing the list it has (dimmed by the
 * page) until the next one comes. Upcoming and Past, or another filter (All, My meetings, My
 * team), are other lists: those show their own loading shape instead of the wrong list.
 */
export function useMeetings(query: MeetingQuery, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    ...meetingsQueryOptions(query),
    enabled,
    placeholderData: (previous, previousQuery) => {
      const before = queryOf(previousQuery?.queryKey)
      return before && before.when === query.when && before.who === query.who ? previous : undefined
    },
  })
}

/** Every page of meetings in the cache says HubSpot's meetings are being read, so each asks again. */
function markSyncing(client: QueryClient): void {
  client.setQueriesData<MeetingPage>({ queryKey: queryKeys.companies.meetingLists() }, (page) =>
    page ? { ...page, syncing: true } : page,
  )
}

/**
 * POST /companies/meetings/sync (PLAN-V18 T1-5): read HubSpot's meetings now. It answers at once
 * (202): `started`, `running` (one was going already) or `fresh` (one finished under a minute ago,
 * so HubSpot isn't asked). While a read runs, every list on screen says so and asks again every 2
 * seconds until it is done (`listPollMs`); the lists on screen ask again now in any case.
 */
export function useSyncMeetings() {
  const client = useQueryClient()
  return useMutation<MeetingsSyncOut, ApiProblem, undefined>({
    mutationKey: [...queryKeys.companies.meetings(), 'sync'],
    mutationFn: async () => unwrap(await api.POST('/companies/meetings/sync')),
    onSuccess: (answer) => {
      if (answer.state !== 'fresh') markSyncing(client)
      void client.invalidateQueries({ queryKey: queryKeys.companies.meetingLists() })
    },
  })
}

/** Whether a row is the form's meeting: the same pre-read, or the HubSpot meeting it is for. */
function isRowOf(item: MeetingItem, form: MeetingFormState, meetingId: string | null): boolean {
  return item.form?.id === form.id || (meetingId !== null && item.meeting.id === meetingId)
}

function recipientLabel(person: MeetingFormOut['sent_to'][number]): string {
  return (
    person.name?.trim() ||
    person.address?.trim() ||
    (person.owner_id ? `HubSpot owner ${person.owner_id}` : 'Someone')
  )
}

function formStateOf(form: MeetingFormOut | MeetingFormState): MeetingFormState {
  if ('sent_to' in form) {
    return {
      id: form.id,
      status: form.status,
      sent_at: form.sent_at ?? null,
      sent_count: form.sent_to.length,
      sent_names: form.sent_to.slice(0, 2).map(recipientLabel),
    }
  }
  return {
    id: form.id,
    status: form.status,
    sent_at: form.sent_at ?? null,
    sent_count: form.sent_count ?? 0,
    sent_names: form.sent_names ?? [],
  }
}

/**
 * Puts a form, in short, on its meeting's row, in every page of meetings in the cache that holds
 * it: the row of the same pre-read, or of the HubSpot meeting it was just started for. Every page
 * of meetings then counts as old, so the next look reads the rest from the server (a typed meeting
 * joins its list then), and so do Home's counts.
 */
export function putFormOnRows(
  client: QueryClient,
  form: MeetingFormOut | MeetingFormState,
  meetingId: string | null,
): void {
  const short = formStateOf(form)
  client.setQueriesData<MeetingPage>({ queryKey: queryKeys.companies.meetingLists() }, (page) =>
    page?.items.some((item) => isRowOf(item, short, meetingId))
      ? {
          ...page,
          items: page.items.map((item) =>
            isRowOf(item, short, meetingId) ? { ...item, form: short } : item,
          ),
        }
      : page,
  )
  void client.invalidateQueries({
    queryKey: queryKeys.companies.meetingLists(),
    refetchType: 'none',
  })
  // Marking asks nothing now, so the pre-read's page may do this on each answer.
  markMeetingSummaryOld(client)
}

/**
 * POST /companies/meetings/forms. It answers at once with the form, still drafting (201, or 200
 * with a HubSpot meeting's own form): the facts and the summaries are written in the background.
 * The form goes in the cache for its page, and its row shows it.
 */
export function startMeetingFormOptions(client: QueryClient) {
  return mutationOptions<MeetingFormOut, ApiProblem, MeetingFormStart>({
    mutationKey: [...queryKeys.companies.meetings(), 'start'],
    mutationFn: async (body) => unwrap(await api.POST('/companies/meetings/forms', { body })),
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
        await api.GET('/companies/meetings/forms/{form_id}', {
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
        await api.GET('/companies/meetings/{meeting_id}', {
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
 * The key every edit of one pre-read runs under. The send dialog waits while one is on its way, so
 * the email it shows has the blank the rep just left (T3-11).
 */
export function editFormKey(formId: string) {
  return [...queryKeys.companies.meetings(), 'edit', formId] as const
}

/**
 * Whether an edit of this pre-read is on its way: a blank the rep has just left, or a summary.
 * Read from the query client itself rather than with TanStack's `useIsMutating`, which nothing else
 * uses: TanStack Query sits in the framework file every first visit loads, so using one more of
 * its hooks grew that file by about 150 bytes gzip (T3-11, measured).
 */
export function useFormEditing(formId: string): boolean {
  const client = useQueryClient()
  const subscribe = useCallback(
    (onChange: () => void) => client.getMutationCache().subscribe(onChange),
    [client],
  )
  return useSyncExternalStore(
    subscribe,
    () => client.isMutating({ mutationKey: editFormKey(formId) }) > 0,
  )
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
  const mutationKey = editFormKey(formId)
  return useMutation<MeetingFormOut, ApiProblem, EditFormVariables, EditFormContext>({
    mutationKey,
    mutationFn: async ({ patch }) =>
      unwrap(
        await api.PATCH('/companies/meetings/forms/{form_id}', {
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
        await api.POST('/companies/meetings/forms/{form_id}/redraft', {
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

// --- Sending the pre-read (T3-11 & PLAN-V19 T2-3/T2-4) ------------------------------------------

/** GET /companies/team: active HubSpot owners ordered by name, with Contour status (never emails). */
export function teamQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.companies.team(),
    queryFn: async ({ signal }): Promise<TeamMember[]> =>
      unwrap(await api.GET('/companies/team', { signal })),
    staleTime: 60_000,
  })
}

export function useTeam({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({ ...teamQueryOptions(), enabled })
}

export interface PreviewFormVariables {
  ownerIds?: readonly string[] | null
  emails?: readonly string[]
  emailThem?: boolean
}

export interface SendFormVariables {
  ownerIds?: readonly string[]
  emails?: readonly string[]
  emailThem?: boolean
}

/**
 * POST /companies/meetings/forms/{form_id}/preview: the task and email as they would arrive, and
 * who would get what. Nothing is sent.
 */
export function useMeetingFormPreview(formId: string) {
  return useMutation<FormEmailPreview, ApiProblem, PreviewFormVariables>({
    mutationKey: [...queryKeys.companies.meetings(), 'preview', formId],
    mutationFn: async ({ ownerIds = null, emails = [], emailThem = false }) =>
      unwrap(
        await api.POST('/companies/meetings/forms/{form_id}/preview', {
          params: { path: { form_id: formId } },
          body: {
            owner_ids: ownerIds === null ? null : [...ownerIds],
            emails: [...emails],
            email_them: emailThem,
          },
        }),
      ),
  })
}

/** A send refused because an address isn't Contour's (422 `outside_address`). Its words name it. */
export function isOutsideAddress(error: unknown): boolean {
  return isApiProblem(error) && error.status === 422 && error.code === 'outside_address'
}

/** The server is sending this pre-read already (409 `form_sending`, a second press). */
export function isFormSending(error: unknown): boolean {
  return isApiProblem(error) && error.status === 409 && error.code === 'form_sending'
}

/** HubSpot writing is off or disconnected when trying to create tasks (409 `hubspot_writes_off`). */
export function isHubSpotWritesOff(error: unknown): boolean {
  return isApiProblem(error) && error.status === 409 && error.code === 'hubspot_writes_off'
}

/**
 * POST /companies/meetings/forms/{form_id}/send: creates HubSpot tasks (and emails when
 * `emailThem` or manual addresses are included), then saves the HubSpot copy. On a sent pre-read,
 * only new recipients receive anything.
 */
export function useSendMeetingForm(formId: string) {
  const client = useQueryClient()
  const key = queryKeys.companies.meetingForm(formId)
  return useMutation<MeetingFormOut, ApiProblem, SendFormVariables>({
    mutationKey: [...queryKeys.companies.meetings(), 'send', formId],
    mutationFn: async ({ ownerIds = [], emails = [], emailThem = false }) =>
      unwrap(
        await api.POST('/companies/meetings/forms/{form_id}/send', {
          params: { path: { form_id: formId } },
          body: {
            owner_ids: [...ownerIds],
            emails: [...emails],
            email_them: emailThem,
          },
        }),
      ),
    onMutate: async () => {
      // An older read on its way must not land on top of the sent pre-read.
      await client.cancelQueries({ queryKey: key })
    },
    onSuccess: (form) => {
      client.setQueryData(key, form)
      putFormOnRows(client, form, form.meeting.meeting_id)
    },
    onError: (error) => {
      if (isFormSending(error)) void client.invalidateQueries({ queryKey: key })
    },
  })
}

/**
 * POST /companies/meetings/forms/{form_id}/tasks/retry: retries failed HubSpot tasks on a sent
 * pre-read without sending emails. Partial successes stay saved even when raising 502 `task_failed`.
 */
export function useRetryMeetingTasks(formId: string) {
  const client = useQueryClient()
  const key = queryKeys.companies.meetingForm(formId)
  return useMutation<MeetingFormOut, ApiProblem, undefined>({
    mutationKey: [...queryKeys.companies.meetings(), 'retry-tasks', formId],
    mutationFn: async () =>
      unwrap(
        await api.POST('/companies/meetings/forms/{form_id}/tasks/retry', {
          params: { path: { form_id: formId } },
        }),
      ),
    onMutate: async () => {
      await client.cancelQueries({ queryKey: key })
    },
    onSuccess: (form) => {
      client.setQueryData(key, form)
      putFormOnRows(client, form, form.meeting.meeting_id)
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: key })
      void client.invalidateQueries({ queryKey: queryKeys.companies.meetingLists(), refetchType: 'none' })
    },
  })
}

// --- Log meeting (T3-11) -------------------------------------------------------------------------

export interface LogMeetingVariables {
  /** HubSpot's meeting id. A meeting typed in has none, and takes no transcript. */
  meetingId: string
  body: MeetingTranscriptIn
  /** Made when the transcript starts and kept with it, so a double press or Try again is one note. */
  idempotencyKey: string
}

/**
 * POST /companies/meetings/{meeting_id}/transcript: a past meeting's transcript becomes a call
 * note, linked to the meeting, in the same batch as the calls (201, or 200 with the first note for
 * a repeated key). Nothing goes to HubSpot until the rep sends the batch.
 */
export function logMeetingOptions() {
  return mutationOptions<CallNoteOut, ApiProblem, LogMeetingVariables>({
    mutationKey: [...queryKeys.companies.meetings(), 'transcript'],
    mutationFn: async ({ meetingId, body, idempotencyKey }) =>
      unwrap(
        await api.POST('/companies/meetings/{meeting_id}/transcript', {
          params: {
            path: { meeting_id: meetingId },
            header: { 'idempotency-key': idempotencyKey },
          },
          body,
        }),
      ),
  })
}

/** The company records in the cache, which list their meetings, count as old. */
function markCompaniesOld(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: ['companies', 'detail'], refetchType: 'none' })
}

/**
 * A past meeting's notes are logged: its row says so at once, in every page of meetings in the
 * cache that holds it. Every page of meetings, and every company's record, then counts as old.
 */
export function putNotesOnRow(client: QueryClient, meetingId: string): void {
  const its = (item: MeetingItem): boolean => !item.typed && item.meeting.id === meetingId
  client.setQueriesData<MeetingPage>({ queryKey: queryKeys.companies.meetingLists() }, (page) =>
    page?.items.some(its)
      ? {
          ...page,
          items: page.items.map((item) => (its(item) ? { ...item, notes_logged: true } : item)),
        }
      : page,
  )
  void client.invalidateQueries({
    queryKey: queryKeys.companies.meetingLists(),
    refetchType: 'none',
  })
  markCompaniesOld(client)
}

/**
 * The pages of meetings on screen ask again (after an Undo: whether a meeting still has notes is
 * the server's to say, since it may have others), and the rest when shown.
 */
export function refreshMeetingLists(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: queryKeys.companies.meetingLists() })
  markCompaniesOld(client)
}
