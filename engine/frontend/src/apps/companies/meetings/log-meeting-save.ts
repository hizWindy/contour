/**
 * Saving a past meeting's transcript, and its Undo (PLAN-V17 T3-11, "Log meeting").
 *
 * - **Nothing is lost.** The transcript box stays open while it saves, so the words stay in it
 *   until the server has them. Then it closes, and a toast says "Saved. 7 to confirm." with Undo,
 *   as Log call's does. "To confirm" goes up at once, and back down if the server says no.
 * - **One note for one press:** the request carries the transcript's Idempotency-Key, made when
 *   it starts and kept until the server has it, so a double press or Try again is one note.
 * - **Undo** deletes the note, as Log call's does, and the transcript goes back as this meeting's
 *   draft, with a new key (the old note is gone). A toast outlives a sign-out, so it acts only for
 *   the rep who saved.
 * - **The draft is kept in this page's memory only,** by person and meeting, never in the browser's
 *   storage: a transcript holds the client's words, and can be long. It goes once the server has
 *   it, and when its person signs out. A reload starts afresh: the file or the words it was pasted
 *   from are still there (TBC with Al-khair).
 *
 * The requests go through the query client (a MutationObserver), so a lost connection reaches the
 * connection bar like any other change.
 */
import {
  MutationObserver,
  type MutationObserverOptions,
  type QueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import { newIdempotencyKey, toApiProblem, type ApiProblem } from '@/api/client'
import { onSignOut, type SignIn } from '@/api/hooks/auth'
import {
  bumpToConfirm,
  deleteCallNoteOptions,
  markCountsOld,
  refreshCallNoteLists,
} from '@/api/hooks/call-notes'
import { logMeetingOptions, putNotesOnRow, refreshMeetingLists } from '@/api/hooks/meetings'
import { queryKeys } from '@/api/query'
import type { CallNoteSummary } from '@/api/types'
import { changeDetail } from '@/lib/problems'
import { draftOwner, type DraftOwner } from '../call-notes/draft'
import { savedWords, UNDO } from '../call-notes/words'
import { TRANSCRIPT_NOT_UNDONE, TRANSCRIPT_UNDONE } from './words'

export interface TranscriptDraft {
  /** Whose it is: the signed-in rep's id, or null with sign-in off. */
  owner: DraftOwner
  /** HubSpot's meeting id. */
  meetingId: string
  /** As pasted or read: a .vtt keeps its times, which the server takes out. */
  text: string
  /** The file it was read from, or null for pasted words. */
  fileName: string | null
  /** The save's Idempotency-Key. */
  key: string
}

/** The transcripts not saved yet, by person and meeting. In memory only. */
const drafts = new Map<string, TranscriptDraft>()

function entryOf(owner: DraftOwner, meetingId: string): string {
  return `${owner ?? ''}|${meetingId}`
}

/** This meeting's transcript not saved yet, or a new, empty one. */
export function readTranscriptDraft(owner: DraftOwner, meetingId: string): TranscriptDraft {
  return (
    drafts.get(entryOf(owner, meetingId)) ?? {
      owner,
      meetingId,
      text: '',
      fileName: null,
      key: newIdempotencyKey(),
    }
  )
}

/** Keeps the transcript as it is now. An empty box keeps nothing. */
export function keepTranscriptDraft(draft: TranscriptDraft): void {
  const entry = entryOf(draft.owner, draft.meetingId)
  if (draft.text === '' && draft.fileName === null) {
    drafts.delete(entry)
  } else {
    drafts.set(entry, draft)
  }
}

/** Drops the transcript once the server has it, unless a newer one has taken its place. */
function dropTranscriptDraft(owner: DraftOwner, meetingId: string, key: string): void {
  const entry = entryOf(owner, meetingId)
  if (drafts.get(entry)?.key === key) drafts.delete(entry)
}

/**
 * Drops a person's transcripts from this page: on signing out, or with sign-in off (`null`) when
 * a test starts afresh.
 */
export function forgetTranscripts(owner: DraftOwner): void {
  for (const [entry, draft] of drafts) {
    if (draft.owner === owner) drafts.delete(entry)
  }
}

onSignOut(forgetTranscripts)

function run<TData, TVariables>(
  client: QueryClient,
  options: MutationObserverOptions<TData, ApiProblem, TVariables>,
  variables: TVariables,
): Promise<TData> {
  return new MutationObserver(client, options).mutate(variables)
}

/** The toast's Undo acts only while the person who saved is the one signed in. */
function stillSignedIn(client: QueryClient, owner: DraftOwner): boolean {
  return draftOwner(client.getQueryData<SignIn>(queryKeys.auth.me())) === owner
}

/**
 * Saves the transcript. It resolves once the server has it (the box then closes, and the toast
 * says so with Undo), and rejects with why it didn't (the box keeps the words and says so).
 */
export async function logMeeting(client: QueryClient, draft: TranscriptDraft): Promise<void> {
  const before = client.getQueryData<CallNoteSummary>(queryKeys.companies.callNoteSummary())
  void bumpToConfirm(client, 1)
  let noteId: string
  try {
    const note = await run(client, logMeetingOptions(), {
      meetingId: draft.meetingId,
      body: { text: draft.text, file_name: draft.fileName },
      idempotencyKey: draft.key,
    })
    noteId = note.id
  } catch (error) {
    void bumpToConfirm(client, -1)
    throw error
  }
  dropTranscriptDraft(draft.owner, draft.meetingId, draft.key)
  markCountsOld(client)
  // Activity's "To confirm", if it is open, shows the new note while it sorts.
  void refreshCallNoteLists(client)
  putNotesOnRow(client, draft.meetingId)
  let undone = false
  toast(savedWords(before ? before.to_confirm + 1 : null), {
    action: {
      label: UNDO,
      onClick: () => {
        if (undone || !stillSignedIn(client, draft.owner)) return
        undone = true
        undo(client, draft, noteId)
      },
    },
  })
}

function undo(client: QueryClient, draft: TranscriptDraft, noteId: string): void {
  void bumpToConfirm(client, -1)
  // The words go back as this meeting's draft, unless the rep has started another since.
  let restored: string | null = null
  if (!drafts.has(entryOf(draft.owner, draft.meetingId))) {
    restored = newIdempotencyKey()
    drafts.set(entryOf(draft.owner, draft.meetingId), { ...draft, key: restored })
  }
  toast(TRANSCRIPT_UNDONE)
  run(client, deleteCallNoteOptions(), noteId).then(
    () => {
      markCountsOld(client)
      void refreshCallNoteLists(client)
      // Whether the meeting still has notes logged (another part, say) is the server's to say.
      refreshMeetingLists(client)
    },
    (error: unknown) => {
      // The note is still there: it counts again, and the draft put back would make a second one.
      void bumpToConfirm(client, 1)
      if (restored !== null) dropTranscriptDraft(draft.owner, draft.meetingId, restored)
      const detail = changeDetail(toApiProblem(error))
      toast.error(TRANSCRIPT_NOT_UNDONE, detail ? { description: detail } : undefined)
    },
  )
}
