/**
 * Call notes (PLAN-V17 Stage A): what a rep logs after a call. A note waits "to confirm" until
 * the rep sends a few at once to HubSpot (T3-6). Typed by hand until M1 (`v17.ts`, `apiV17`).
 *
 * - The options say whether call notes are on, whether the AI sorts a note, the outcomes and the
 *   limits. With call notes off there is no Log call button and no L key.
 * - The summary holds the counts for Home and the menu. A save or a removal moves "to confirm"
 *   at once in the cache (`bumpToConfirm`), so a count on screen rolls before the server answers.
 * - Saving, removing and changing a note each have their own mutation options, so code that runs
 *   after the panel has closed (a toast's Undo or Try again) sends the same requests as the hooks.
 * - Activity (T3-6) reads pages of notes by state, one note while it is sent, and the preview
 *   (HubSpot's values now). A page asks again by itself every 2 seconds while a note on it is
 *   being sorted, and every second while one is being sent. Then it stops.
 */
import {
  keepPreviousData,
  mutationOptions,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { unwrap, type ApiProblem } from '../client'
import { queryKeys } from '../query'
import type {
  CallNoteConfirm,
  CallNoteIn,
  CallNoteOptions,
  CallNoteOut,
  CallNotePage,
  CallNotePatch,
  CallNotePreview,
  CallNoteQuery,
  CallNoteResolve,
  CallNoteSummary,
} from '../v17'
import { apiV17 } from '../v17-client'

/** The switches change rarely (an Admin, on the Settings page), so a minute of fresh is fine. */
const OPTIONS_FRESH_MS = 60_000

/** How often a page with a note still being sorted asks again. */
export const SORTING_POLL_MS = 2000

/** How often a note being sent to HubSpot is asked for again. */
export const SENDING_POLL_MS = 1000

/**
 * HubSpot's values in a preview count as "now" for this long, so flicking between Activity's tabs
 * doesn't read every company in HubSpot again. Sending always asks afresh.
 */
const PREVIEW_FRESH_MS = 30_000

/** Whether call notes are on, whether the AI sorts a note, the outcomes, the limits. */
export function callNoteOptionsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.companies.callNoteOptions(),
    queryFn: async ({ signal }): Promise<CallNoteOptions> =>
      unwrap(await apiV17.GET('/companies/call-notes/options', { signal })),
    staleTime: OPTIONS_FRESH_MS,
  })
}

/** `enabled` false asks for nothing. */
export function useCallNoteOptions(enabled = true) {
  return useQuery({ ...callNoteOptionsQueryOptions(), enabled })
}

/** The counts for Home and the menu: to confirm, needs a look, logged today. */
export function callNoteSummaryQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.companies.callNoteSummary(),
    queryFn: async ({ signal }): Promise<CallNoteSummary> =>
      unwrap(await apiV17.GET('/companies/call-notes/summary', { signal })),
  })
}

export function useCallNoteSummary(enabled = true) {
  return useQuery({ ...callNoteSummaryQueryOptions(), enabled })
}

/**
 * Moves the counts in the cache at once (`{ to_confirm: -1, needs_look: 1 }`), so every place
 * that shows them rolls. A read of the counts still on its way is stopped first, or its older
 * answer would land on top. With no counts in the cache yet, nothing changes.
 */
export async function bumpCounts(
  client: QueryClient,
  by: Partial<Record<keyof CallNoteSummary, number>>,
): Promise<void> {
  const queryKey = queryKeys.companies.callNoteSummary()
  await client.cancelQueries({ queryKey })
  client.setQueryData<CallNoteSummary>(queryKey, (summary) =>
    summary
      ? {
          to_confirm: Math.max(0, summary.to_confirm + (by.to_confirm ?? 0)),
          needs_look: Math.max(0, summary.needs_look + (by.needs_look ?? 0)),
          logged_today: Math.max(0, summary.logged_today + (by.logged_today ?? 0)),
        }
      : summary,
  )
}

/** Moves the "to confirm" count by `by` (+1 for a save, -1 for an Undo), as `bumpCounts`. */
export function bumpToConfirm(client: QueryClient, by: number): Promise<void> {
  return bumpCounts(client, { to_confirm: by })
}

/**
 * The counts in the cache are marked old, without asking again now: the server may count a note
 * still being sorted differently, and a second roll right after the first would look like a
 * mistake. The next screen that reads them asks again.
 */
export function markCountsOld(client: QueryClient): void {
  void client.invalidateQueries({
    queryKey: queryKeys.companies.callNoteSummary(),
    refetchType: 'none',
  })
}

// --- Pages of notes, and one note (Activity, T3-6) -------------------------------------------

/**
 * How soon a page asks again: every second while a note on it is being sent, every 2 seconds
 * while one is being sorted, and not at all once none is.
 */
export function callNotesPollMs(
  notes: readonly CallNoteOut[] | undefined,
  { sending = true }: { sending?: boolean } = {},
): number | false {
  if (!notes) return false
  if (sending && notes.some((note) => note.status === 'sending')) return SENDING_POLL_MS
  if (notes.some((note) => note.status === 'sorting')) return SORTING_POLL_MS
  return false
}

/** GET /call-notes: a page of notes, by state (`to_confirm`, `logged`, `needs_look`) and `mine`. */
export function callNotesQueryOptions(query: CallNoteQuery) {
  return queryOptions({
    queryKey: queryKeys.companies.callNoteList(query),
    queryFn: async ({ signal }): Promise<CallNotePage> =>
      unwrap(await apiV17.GET('/companies/call-notes', { params: { query }, signal })),
    refetchInterval: (current) => callNotesPollMs(current.state.data?.items),
  })
}

export interface UseCallNotesOptions {
  enabled?: boolean
  /**
   * False: a note being sent doesn't make the page ask every second. Activity follows each note
   * of its own batch by itself (`callNoteQueryOptions`), so the page needn't as well.
   */
  pollSending?: boolean
  /** A paged list keeps showing the page it has while the next one loads. */
  keepPrevious?: boolean
}

export function useCallNotes(
  query: CallNoteQuery,
  { enabled = true, pollSending = true, keepPrevious = false }: UseCallNotesOptions = {},
) {
  return useQuery({
    ...callNotesQueryOptions(query),
    enabled,
    refetchInterval: (current) =>
      callNotesPollMs(current.state.data?.items, { sending: pollSending }),
    placeholderData: keepPrevious ? keepPreviousData : undefined,
  })
}

/** GET /call-notes/{id}: one note. Whoever follows it says how often to ask again. */
export function callNoteQueryOptions(id: string) {
  return queryOptions({
    queryKey: queryKeys.companies.callNote(id),
    queryFn: async ({ signal }): Promise<CallNoteOut> =>
      unwrap(await apiV17.GET('/companies/call-notes/{id}', { params: { path: { id } }, signal })),
  })
}

/** Changes one note wherever a page of notes in the cache holds it. */
export function updateNoteInLists(
  client: QueryClient,
  id: string,
  update: (note: CallNoteOut) => CallNoteOut,
): void {
  client.setQueriesData<CallNotePage>({ queryKey: queryKeys.companies.callNoteLists() }, (page) =>
    page?.items.some((note) => note.id === id)
      ? { ...page, items: page.items.map((note) => (note.id === id ? update(note) : note)) }
      : page,
  )
}

/** The newest copy of a note in the cached pages, or undefined. */
export function noteInLists(client: QueryClient, id: string): CallNoteOut | undefined {
  for (const [, page] of client.getQueriesData<CallNotePage>({
    queryKey: queryKeys.companies.callNoteLists(),
  })) {
    const found = page?.items.find((note) => note.id === id)
    if (found) return found
  }
  return undefined
}

/** Puts the server's copy of a note in every page of notes that holds it. */
export function putNoteInLists(client: QueryClient, note: CallNoteOut): void {
  updateNoteInLists(client, note.id, () => note)
}

/** Takes a note out of the pages in the cache (all of them, or only those of one state). */
export function dropNoteFromLists(
  client: QueryClient,
  id: string,
  state?: CallNoteQuery['state'],
): void {
  client.setQueriesData<CallNotePage>(
    {
      queryKey: queryKeys.companies.callNoteLists(),
      predicate: (query) =>
        state === undefined || (query.queryKey[3] as CallNoteQuery | undefined)?.state === state,
    },
    (page) =>
      page?.items.some((note) => note.id === id)
        ? {
            total: Math.max(0, page.total - 1),
            items: page.items.filter((note) => note.id !== id),
          }
        : page,
  )
}

/** Every page of notes counts as old: the ones on screen ask again now, the others when shown. */
export function refreshCallNoteLists(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: queryKeys.companies.callNoteLists() })
}

// --- The preview, the batch and its repairs (Activity, T3-6) ---------------------------------

async function previewOf(ids: readonly string[], signal?: AbortSignal): Promise<CallNotePreview> {
  return unwrap(
    await apiV17.POST('/companies/call-notes/preview', { body: { ids: [...ids] }, signal }),
  )
}

/**
 * POST /call-notes/preview as a read: HubSpot's values now for these notes, whether sending is
 * ready, and the totals. Nothing is written. Opening "To confirm" asks for it.
 */
export function callNotePreviewQueryOptions(ids: readonly string[]) {
  return queryOptions({
    queryKey: queryKeys.companies.callNotePreview(ids),
    queryFn: ({ signal }) => previewOf(ids, signal),
    staleTime: PREVIEW_FRESH_MS,
  })
}

/** No notes asks for nothing. */
export function useCallNotePreview(ids: readonly string[]) {
  return useQuery({ ...callNotePreviewQueryOptions(ids), enabled: ids.length > 0 })
}

/** The preview on a press (Send): HubSpot's values right before sending, and the totals. */
export function previewCallNotesOptions() {
  return mutationOptions<CallNotePreview, ApiProblem, readonly string[]>({
    mutationKey: [...queryKeys.companies.callNotes(), 'preview'],
    mutationFn: (ids) => previewOf(ids),
  })
}

/** POST /call-notes/confirm: the notes go to HubSpot one after another. It answers at once. */
export function confirmCallNotesOptions() {
  return mutationOptions<CallNoteConfirm, ApiProblem, readonly string[]>({
    mutationKey: [...queryKeys.companies.callNotes(), 'confirm'],
    mutationFn: async (ids) =>
      unwrap(await apiV17.POST('/companies/call-notes/confirm', { body: { ids: [...ids] } })),
  })
}

/** POST /call-notes/{id}/retry: a note that failed (or partly failed) goes again. */
export function retryCallNoteOptions() {
  return mutationOptions<CallNoteOut, ApiProblem, string>({
    mutationKey: [...queryKeys.companies.callNotes(), 'retry'],
    mutationFn: async (id) =>
      unwrap(await apiV17.POST('/companies/call-notes/{id}/retry', { params: { path: { id } } })),
  })
}

export interface ResolveCallNoteVariables extends CallNoteResolve {
  id: string
}

/** POST /call-notes/{id}/resolve: the rep says whether an uncertain step is in HubSpot. */
export function resolveCallNoteOptions() {
  return mutationOptions<CallNoteOut, ApiProblem, ResolveCallNoteVariables>({
    mutationKey: [...queryKeys.companies.callNotes(), 'resolve'],
    mutationFn: async ({ id, step, landed }) =>
      unwrap(
        await apiV17.POST('/companies/call-notes/{id}/resolve', {
          params: { path: { id } },
          body: { step, landed },
        }),
      ),
  })
}

export interface SaveCallNoteVariables {
  body: CallNoteIn
  /** Made when the draft starts and kept with it, so a double press or a retry is one note. */
  idempotencyKey: string
}

/** POST /call-notes. The sort runs in the background on the server; nothing waits for it. */
export function saveCallNoteOptions() {
  return mutationOptions<CallNoteOut, ApiProblem, SaveCallNoteVariables>({
    mutationKey: [...queryKeys.companies.callNotes(), 'save'],
    mutationFn: async ({ body, idempotencyKey }) =>
      unwrap(
        await apiV17.POST('/companies/call-notes', {
          body,
          params: { header: { 'idempotency-key': idempotencyKey } },
        }),
      ),
  })
}

/** DELETE /call-notes/{id}: a note not yet sent goes (the toast's Undo). */
export function deleteCallNoteOptions() {
  return mutationOptions<void, ApiProblem, string>({
    mutationKey: [...queryKeys.companies.callNotes(), 'delete'],
    mutationFn: async (id) => {
      unwrap(await apiV17.DELETE('/companies/call-notes/{id}', { params: { path: { id } } }))
    },
  })
}

export interface PatchCallNoteVariables {
  id: string
  patch: CallNotePatch
}

/** PATCH /call-notes/{id}: the rep's edits. Lists of notes are asked for again. */
export function patchCallNoteOptions(client: QueryClient) {
  return mutationOptions<CallNoteOut, ApiProblem, PatchCallNoteVariables>({
    mutationKey: [...queryKeys.companies.callNotes(), 'patch'],
    mutationFn: async ({ id, patch }) =>
      unwrap(
        await apiV17.PATCH('/companies/call-notes/{id}', {
          params: { path: { id } },
          body: patch,
        }),
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.companies.callNotes() })
    },
  })
}

/** Saves a note. "To confirm" goes up at once, and back down if the server says no. */
export function useSaveCallNote() {
  const client = useQueryClient()
  return useMutation({
    ...saveCallNoteOptions(),
    onMutate: () => bumpToConfirm(client, 1),
    onError: () => bumpToConfirm(client, -1),
    onSuccess: () => {
      markCountsOld(client)
    },
  })
}

/** Removes a note not yet sent. "To confirm" goes down at once, and back up if it fails. */
export function useDeleteCallNote() {
  const client = useQueryClient()
  return useMutation({
    ...deleteCallNoteOptions(),
    onMutate: () => bumpToConfirm(client, -1),
    onError: () => bumpToConfirm(client, 1),
    onSuccess: () => {
      markCountsOld(client)
    },
  })
}

/** Changes a note: its summary, outcome, person, changes, tasks, or "left out". */
export function usePatchCallNote() {
  const client = useQueryClient()
  return useMutation(patchCallNoteOptions(client))
}
