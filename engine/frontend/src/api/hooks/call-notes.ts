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
 */
import {
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
  CallNoteIn,
  CallNoteOptions,
  CallNoteOut,
  CallNotePatch,
  CallNoteSummary,
} from '../v17'
import { apiV17 } from '../v17-client'

/** The switches change rarely (an Admin, on the Settings page), so a minute of fresh is fine. */
const OPTIONS_FRESH_MS = 60_000

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
 * Moves the "to confirm" count by `by` (+1 for a save, -1 for an Undo) in the cache, at once, so
 * every place that shows it rolls. A read of the counts still on its way is stopped first, or
 * its older answer would land on top. With no counts in the cache yet, nothing changes.
 */
export async function bumpToConfirm(client: QueryClient, by: number): Promise<void> {
  const queryKey = queryKeys.companies.callNoteSummary()
  await client.cancelQueries({ queryKey })
  client.setQueryData<CallNoteSummary>(queryKey, (summary) =>
    summary ? { ...summary, to_confirm: Math.max(0, summary.to_confirm + by) } : summary,
  )
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
