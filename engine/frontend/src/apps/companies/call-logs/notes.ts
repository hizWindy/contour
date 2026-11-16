/** Small rules about notes that Call logs' tabs share (PLAN-V17 T3-6). */
import type { QueryClient } from '@tanstack/react-query'
import { isApiProblem } from '@/api/client'
import { updateNoteInLists } from '@/api/hooks/call-notes'
import type { CallNoteOut, CallNotePreview } from '@/api/types'
import { isMeetingNotes } from './words'

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

/** What a send holds, by kind. */
export interface SendCounts {
  calls: number
  /** Logged meetings' notes: they go to HubSpot as notes, not calls. */
  meetingNotes: number
  tasks: number
  changes: number
}

/**
 * What will go, as the preview says: the server's totals, which leave out the notes it won't send
 * (`skipped`) and those left out. A server without `meeting_notes` counted a logged meeting's
 * notes as calls, so they are counted apart, from its items (`source` transcript).
 */
export function sendCounts(preview: CallNotePreview): SendCounts {
  const { calls, tasks, changes, meeting_notes: meetingNotes } = preview.totals
  if (meetingNotes !== undefined) return { calls, meetingNotes, tasks, changes }
  const meetings = preview.items.filter((note) => !note.left_out && isMeetingNotes(note))
  return {
    calls: Math.max(0, calls - meetings.length),
    meetingNotes: meetings.length,
    tasks,
    changes,
  }
}

/** The calls and the meeting notes among the cards being sent, before the preview answers. */
export function cardCounts(
  notes: readonly Pick<CallNoteOut, 'source'>[],
): Pick<SendCounts, 'calls' | 'meetingNotes'> {
  const meetingNotes = notes.filter(isMeetingNotes).length
  return { calls: notes.length - meetingNotes, meetingNotes }
}
