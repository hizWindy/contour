/**
 * Removing a note not yet sent (PLAN-V17 T3-6; DESIGN.md "Act at once, undo after"). The card goes
 * at once, "to confirm" goes down, and a toast says "Removed the call with ..." with Undo. The
 * DELETE goes when the toast closes without an Undo, so Undo needs nothing from the server. If
 * the DELETE fails, the card comes back and a toast says why.
 *
 * It runs outside React, like Log call's save (`call-notes/save.ts`), because the toast outlives
 * the page. The notes being removed are kept here, so a page that reads its notes again in the
 * meantime (the server still has them) keeps them hidden (`useRemoving`).
 */
import { MutationObserver, type QueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { toApiProblem } from '@/api/client'
import {
  bumpToConfirm,
  deleteCallNoteOptions,
  dropNoteFromLists,
  markCountsOld,
  refreshCallNoteLists,
} from '@/api/hooks/call-notes'
import { changeDetail } from '@/lib/problems'
import { NOT_REMOVED, PUT_BACK_DONE, removedWords, UNDO } from './words'

let removing: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()

function setRemoving(next: ReadonlySet<string>): void {
  removing = next
  for (const listener of listeners) listener()
}

function forget(id: string): void {
  const next = new Set(removing)
  next.delete(id)
  setRemoving(next)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The ids of the notes whose removal is waiting for its toast to close. */
export function useRemoving(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => removing,
    () => removing,
  )
}

/** Removes the note at once, with Undo. The server hears of it when the toast closes. */
export function removeCallNote(
  client: QueryClient,
  note: { id: string; company_name: string },
): void {
  if (removing.has(note.id)) return
  setRemoving(new Set(removing).add(note.id))
  void bumpToConfirm(client, -1)
  // Undo, the timer and a dismissal can each end it; only the first one counts.
  let ended = false
  const finish = (): void => {
    if (ended) return
    ended = true
    new MutationObserver(client, deleteCallNoteOptions()).mutate(note.id).then(
      () => {
        // Out of the pages first, so the card can't show again before they are read afresh.
        dropNoteFromLists(client, note.id)
        forget(note.id)
        markCountsOld(client)
        void refreshCallNoteLists(client)
      },
      (error: unknown) => {
        forget(note.id)
        void bumpToConfirm(client, 1)
        const detail = changeDetail(toApiProblem(error))
        toast.error(NOT_REMOVED, detail ? { description: detail } : undefined)
      },
    )
  }
  toast(removedWords(note.company_name), {
    action: {
      label: UNDO,
      onClick: () => {
        if (ended) return
        ended = true
        forget(note.id)
        void bumpToConfirm(client, 1)
        toast(PUT_BACK_DONE)
      },
    },
    onAutoClose: finish,
    onDismiss: finish,
  })
}
