/**
 * Changes said to a call before it was sorted, kept past the card (PLAN-V24 T3-2, and its review).
 *
 * Before its company is set, a call takes only its outcome, and while it sorts it takes nothing.
 * So the card keeps a change said meanwhile, and makes it once the call is sorted. But a card can
 * go first: the next card replaces it, or the page moves on. What it kept and hadn't sent comes
 * here (`keepUntilSorted`), and goes as one PATCH once the call is sorted, in the order said.
 *
 * - **It watches the call** in the shared cache. While the call sorts, it is read again, as the
 *   card reads it. While it waits for its company, nothing is read: a pick, on a card or in Call
 *   logs, puts the sorting call in the cache, and the reads start then.
 * - **Each change goes once.** The card hands over only what it hadn't sent, and the call leaves
 *   here as its PATCH starts.
 * - **Dropped quietly:** a call that is gone (a 4xx), or that moved on without being sorted
 *   (failed, sending, sent). And a call still sorting after `SORT_LIMIT_MS`, so nothing is read
 *   forever.
 * - **TBC:** this lives in the page. A page closed or reloaded before the sort still loses them.
 */
import { QueryObserver, type QueryClient, type QueryObserverResult } from '@tanstack/react-query'
import { toApiProblem } from '@/api/client'
import { callNoteQueryOptions, refreshCallNoteLists } from '@/api/hooks/call-notes'
import { queryKeys } from '@/api/query'
import type { AssistantChange, CallNoteOut, CallNotePatch } from '@/api/types'
import { toastProblem } from '@/lib/problems'
import { callPatchOf } from './draft'
import { patchNote } from './send'

/**
 * A call still sorting after this long lets its changes go (TBC). The server sorts a call within a
 * few minutes, and sends one to To confirm at once if it restarts mid-sort. It is measured between
 * the server's own answers, so a tab left hidden, which reads nothing, never runs it down.
 */
export const SORT_LIMIT_MS = 10 * 60_000

/**
 * The changes said to a call before it was sorted, as one PATCH of the sorted note, in the order
 * said: a later change to the same part wins. Null when none can be made.
 */
export function heldPatchOf(
  note: CallNoteOut,
  changes: readonly AssistantChange[],
  outcomes: readonly string[],
): CallNotePatch | null {
  let patch: CallNotePatch | null = null
  for (const change of changes) {
    const one = callPatchOf(note, change, outcomes)
    if (one) patch = { ...(patch ?? {}), ...one }
  }
  return patch
}

interface Held {
  changes: AssistantChange[]
  outcomes: readonly string[]
  stop: () => void
}

/** The calls with changes kept, by id, for each cache (one in the app; one per test). */
const keptBy = new WeakMap<QueryClient, Map<string, Held>>()

function keptIn(client: QueryClient): Map<string, Held> {
  let kept = keptBy.get(client)
  if (!kept) {
    kept = new Map()
    keptBy.set(client, kept)
  }
  return kept
}

/** The calls with changes still kept, for tests. */
export function keptCalls(client: QueryClient): string[] {
  return [...keptIn(client).keys()]
}

/** The sorted call takes the changes, as the card's own change would. */
function makeChanges(client: QueryClient, note: CallNoteOut, held: Held): void {
  const patch = heldPatchOf(note, held.changes, held.outcomes)
  if (!patch) return
  patchNote(note.id, patch).then(
    (updated) => {
      client.setQueryData(queryKeys.companies.callNote(updated.id), updated)
      void client.invalidateQueries({
        queryKey: queryKeys.companies.callNotePreview([updated.id]),
      })
      void refreshCallNoteLists(client)
    },
    (error: unknown) => {
      // Gone, or sent meanwhile: nothing to say. Anything else says why, as the card's change does.
      const { status } = toApiProblem(error)
      if (status === 404 || status === 409) return
      toastProblem(error)
    },
  )
}

function watch(
  client: QueryClient,
  id: string,
  changes: readonly AssistantChange[],
  outcomes: readonly string[],
  sortMs: number,
): void {
  const kept = keptIn(client)
  const already = kept.get(id)
  if (already) {
    // Kept from an earlier card for the same call: these come after, in the order said.
    already.changes.push(...changes)
    already.outcomes = outcomes
    return
  }
  const held: Held = { changes: [...changes], outcomes, stop: () => undefined }
  kept.set(id, held)
  const observer = new QueryObserver(client, {
    ...callNoteQueryOptions(id),
    refetchInterval: (query) => (query.state.data?.status === 'sorting' ? sortMs : false),
  })
  /** When the server first answered that the call sorts, and when it last answered. */
  let sortingSince: number | null = null
  let lastAnswer = 0
  const done = (): void => {
    held.stop()
    if (kept.get(id) === held) kept.delete(id)
  }
  const look = (result: QueryObserverResult<CallNoteOut>): void => {
    if (kept.get(id) !== held) return
    if (result.error) {
      // Gone, or not ours to read any more (signed out): let go. A 5xx or no network: read again.
      const { status } = toApiProblem(result.error)
      if (status >= 400 && status < 500) {
        done()
        return
      }
    }
    const note = result.data
    if (!note) return
    if (note.status === 'sorting') {
      // Only a new answer counts: a look while the next read is on its way still holds the last.
      if (result.dataUpdatedAt === lastAnswer) return
      lastAnswer = result.dataUpdatedAt
      sortingSince ??= result.dataUpdatedAt
      if (result.dataUpdatedAt - sortingSince > SORT_LIMIT_MS) done()
      return
    }
    sortingSince = null
    if (note.status === 'needs_company') return
    done()
    if (note.status === 'to_confirm') makeChanges(client, note, held)
  }
  held.stop = observer.subscribe(look)
  look(observer.getCurrentResult())
}

/**
 * Keeps changes said to a call until it is sorted, then makes them. `note` is the call's id, or
 * its save still on its way: a save that fails takes the changes with it, quietly.
 */
export function keepUntilSorted({
  client,
  note,
  changes,
  outcomes,
  sortMs,
}: {
  client: QueryClient
  note: string | Promise<CallNoteOut>
  changes: readonly AssistantChange[]
  outcomes: readonly string[]
  /** How often a sorting call is read again (the card's `sort`). */
  sortMs: number
}): void {
  if (changes.length === 0) return
  if (typeof note === 'string') {
    watch(client, note, changes, outcomes, sortMs)
    return
  }
  note.then(
    (saved) => {
      watch(client, saved.id, changes, outcomes, sortMs)
    },
    () => undefined,
  )
}
