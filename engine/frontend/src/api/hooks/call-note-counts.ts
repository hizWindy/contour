/**
 * Whether call notes are on, and the counts (PLAN-V17 T3-7): the part of the call notes hooks the
 * menu, Home and Ctrl+K need. They are in the first visit, so this file stays small and the rest
 * of the call notes hooks (`call-notes.ts`, which re-exports these) load with the Companies pages.
 *
 * Who asks: only a person who sees Companies. The menu, Home and Ctrl+K draw a project's parts only
 * for the projects this person may use (`useVisibleModules`), so for anyone else nothing here runs
 * and no call notes request is made. The counts are asked for only once the options say call notes
 * are on: while they are off the server answers the counts with 409 `call_notes_off`.
 */
import { queryOptions, useQuery } from '@tanstack/react-query'
import { unwrap } from '../client'
import { queryKeys } from '../query'
import type { CallNoteOptions, CallNoteSummary } from '../v17'
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

export interface CallNoteCounts {
  /** Call notes are on. False while the options load, fail, or say they are off. */
  on: boolean
  /** The counts, once known and only while call notes are on. */
  counts: CallNoteSummary | undefined
}

/**
 * Call notes for the parts around the app: whether they are on, then the counts. Nothing shows
 * while either is on its way or failed, so a part looks as it did before call notes.
 */
export function useCallNoteCounts(): CallNoteCounts {
  const options = useCallNoteOptions()
  const on = options.data?.enabled === true
  const summary = useCallNoteSummary(on)
  return { on, counts: on ? summary.data : undefined }
}
