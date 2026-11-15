/** Small rules about notes that Activity's tabs share (PLAN-V17 T3-6). */
import type { QueryClient } from '@tanstack/react-query'
import { isApiProblem } from '@/api/client'
import { updateNoteInLists } from '@/api/hooks/call-notes'
import type { CallNoteOut, CallNotePreview } from '@/api/v17'

/** A note the sorter was unsure of first, then the calls in the order they were made. */
export function sortForConfirm(notes: readonly CallNoteOut[]): CallNoteOut[] {
  return [...notes].sort(
    (a, b) =>
      Number(b.unsure !== null) - Number(a.unsure !== null) ||
      Date.parse(a.called_at) - Date.parse(b.called_at),
  )
}

/** The server said call notes are switched off (a 409 `call_notes_off`). */
export function isCallNotesOff(error: unknown): boolean {
  return isApiProblem(error) && error.status === 409 && error.code === 'call_notes_off'
}

/** HubSpot's value now, and whether it moved since, from a preview's copy of the note. */
export function withHubSpotNow(note: CallNoteOut, fresh: CallNoteOut): CallNoteOut {
  const now = new Map(fresh.changes.map((change) => [change.id, change]))
  if (!note.changes.some((change) => now.has(change.id))) return note
  return {
    ...note,
    changes: note.changes.map((change) => {
      const seen = now.get(change.id)
      return seen
        ? { ...change, current: seen.current, current_changed: seen.current_changed }
        : change
    }),
  }
}

/** Puts a preview's HubSpot values into every page of notes on screen. */
export function applyPreview(client: QueryClient, preview: CallNotePreview): void {
  for (const item of preview.items) {
    updateNoteInLists(client, item.id, (note) => withHubSpotNow(note, item))
  }
}
