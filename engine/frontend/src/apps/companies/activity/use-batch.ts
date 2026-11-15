/**
 * Sending the batch (PLAN-V17 T3-6, "The screens" part 3). The rep confirms, POST /call-notes/
 * confirm answers at once, and the server sends the notes one after another. Here each sent note
 * is asked for about every second until it has landed:
 *
 * - logged: its card gets its tick beside "Logged", holds a moment, then leaves the list (and the
 *   count moves to Logged);
 * - partial, failed or uncertain: its card says "Needs a look", holds a little longer so the words
 *   can be read, then leaves (and the count moves to Needs a look);
 * - back to "to confirm" (the server stopped half way, or didn't take it): the card stays.
 *
 * The bar counts the notes that have landed or come back. When every one has, and the landed ones
 * have left, a toast says what happened and the pages of notes are read afresh.
 *
 * It expects the server to mark every note it takes `sending` before the confirm answers (asked of
 * Track 2), so a note seen as "to confirm" after that is one the server didn't send.
 */
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { isMissing } from '@/api/client'
import {
  bumpCounts,
  callNoteQueryOptions,
  dropNoteFromLists,
  markCountsOld,
  refreshCallNoteLists,
  SENDING_POLL_MS,
} from '@/api/hooks/call-notes'
import { queryKeys } from '@/api/query'
import type { CallNoteOut } from '@/api/v17'
import { batchDoneWords } from './words'

/** Where a sent note stands. */
export type Landing = 'waiting' | 'logged' | 'needs_look' | 'back'

/** How long a landed card stays, with its tick, before it leaves the list. */
export const HOLD_LOGGED_MS = 900
/** A card that needs a look stays longer, so its words can be read. */
export const HOLD_NEEDS_LOOK_MS = 1800

export function landingOf(note: CallNoteOut | undefined): Landing {
  switch (note?.status) {
    case undefined:
    case 'sending':
      return 'waiting'
    case 'logged':
      return 'logged'
    case 'partial':
    case 'failed':
    case 'uncertain':
      return 'needs_look'
    case 'to_confirm':
    case 'sorting':
      return 'back'
  }
}

function landed(landing: Landing): landing is 'logged' | 'needs_look' {
  return landing === 'logged' || landing === 'needs_look'
}

interface Run {
  ids: readonly string[]
}

export interface Batch {
  /** The notes of the batch being sent, or of the one that has just finished. */
  ids: readonly string[]
  /** Not every note has landed and left yet. */
  running: boolean
  /** How many have landed or come back. */
  done: number
  /** Where each note of the batch stands. */
  landing: (id: string) => Landing
  /** The newest copy of each note of the batch, while the batch is on screen. */
  latest: ReadonlyMap<string, CallNoteOut>
  /** The cards that have left the list after landing. */
  gone: ReadonlySet<string>
  /** Follows these notes, once the confirm has answered. */
  start: (ids: readonly string[]) => void
}

export function useBatch(): Batch {
  const client = useQueryClient()
  const [run, setRun] = useState<Run | null>(null)
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set())
  const holds = useRef(new Map<string, number>())
  const ids = run?.ids ?? []

  const results = useQueries({
    queries: ids.map((id) => ({
      ...callNoteQueryOptions(id),
      // Every second until it lands. A note that is no longer there stops being asked for.
      refetchInterval: (query: { state: { data?: CallNoteOut; error: unknown } }) =>
        landingOf(query.state.data) === 'waiting' && !isMissing(query.state.error)
          ? SENDING_POLL_MS
          : false,
    })),
  })

  const landings = new Map<string, Landing>()
  const latest = new Map<string, CallNoteOut>()
  ids.forEach((id, index) => {
    const result = results[index]
    const data = result?.data
    landings.set(id, isMissing(result?.error) ? 'back' : landingOf(data))
    if (data && !gone.has(id)) latest.set(id, data)
  })
  const landingFor = (id: string): Landing => landings.get(id) ?? 'waiting'
  const done = ids.filter((id) => landingFor(id) !== 'waiting').length
  const finished =
    run !== null &&
    ids.every((id) => {
      const landing = landingFor(id)
      return landing === 'back' || (landed(landing) && gone.has(id))
    })
  const counts = {
    logged: ids.filter((id) => landingFor(id) === 'logged').length,
    needsLook: ids.filter((id) => landingFor(id) === 'needs_look').length,
    back: ids.filter((id) => landingFor(id) === 'back').length,
  }

  // Each landed card holds, then leaves: out of "to confirm" in the cache, and the counts move.
  const landedKey = ids
    .filter((id) => landed(landingFor(id)))
    .map((id) => `${id}|${landingFor(id)}`)
    .join(',')
  useEffect(() => {
    if (landedKey === '') return
    for (const entry of landedKey.split(',')) {
      const [id = '', landing] = entry.split('|')
      if (holds.current.has(id)) continue
      const logged = landing === 'logged'
      holds.current.set(
        id,
        window.setTimeout(
          () => {
            dropNoteFromLists(client, id, 'to_confirm')
            void bumpCounts(
              client,
              logged ? { to_confirm: -1, logged_today: 1 } : { to_confirm: -1, needs_look: 1 },
            )
            setGone((now) => new Set(now).add(id))
          },
          logged ? HOLD_LOGGED_MS : HOLD_NEEDS_LOOK_MS,
        ),
      )
    }
  }, [client, landedKey])

  useEffect(() => {
    const timers = holds.current
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer)
      timers.clear()
    }
  }, [])

  // The end: say what happened, then read the pages afresh before letting go of the batch, so a
  // card that came back never shows its old "sending" copy.
  // Once per batch: nothing lands after it has finished, so the counts stay as they are.
  const { logged, needsLook, back } = counts
  useEffect(() => {
    if (!finished || run === null) return
    toast(batchDoneWords(logged, needsLook, back))
    markCountsOld(client)
    void refreshCallNoteLists(client).finally(() => {
      setRun((now) => (now === run ? null : now))
    })
  }, [finished, run, client, logged, needsLook, back])

  const start = useCallback(
    (next: readonly string[]) => {
      // A note sent before may still have its old copy in the cache: ask afresh.
      for (const id of next) {
        client.removeQueries({ queryKey: queryKeys.companies.callNote(id), exact: true })
      }
      for (const timer of holds.current.values()) window.clearTimeout(timer)
      holds.current.clear()
      setGone(new Set())
      setRun({ ids: next })
    },
    [client],
  )

  return {
    ids,
    running: run !== null && !finished,
    done,
    landing: landingFor,
    latest,
    gone,
    start,
  }
}
