/**
 * Saving a call note answers at once (DESIGN.md "Act at once, undo after"; PLAN-V17 "Rules for
 * every screen here"). The panel closes, "to confirm" goes up in the cache, and a toast says
 * "Saved. 7 to confirm." with Undo. The server is told after.
 *
 * - The request carries the draft's Idempotency-Key, so Try again (or a double press) is one note.
 * - The server says no: the count goes back down, the draft keeps the text, and a toast says "Not
 *   saved yet. Try again." Try again sends the draft as it is now, with the same key.
 * - Undo deletes the note. If it comes before the save has answered, the delete follows the
 *   answer. The text goes back as that call's draft, with a new key, since the old note is gone.
 * - With the AI off, the follow-up typed by hand goes as a PATCH (`tasks`) right after the save
 *   answers. With the AI on, the sorter finds tasks on the server, and nothing here waits for it.
 *
 * It runs outside React because it outlives the panel: the toast's buttons work after the panel
 * has closed, even on another page. The requests still go through the query client (a
 * MutationObserver), so a lost connection reaches the connection bar like any other change.
 */
import {
  MutationObserver,
  type MutationObserverOptions,
  type QueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import { newIdempotencyKey, toApiProblem, type ApiProblem } from '@/api/client'
import {
  bumpToConfirm,
  deleteCallNoteOptions,
  markCountsOld,
  patchCallNoteOptions,
  saveCallNoteOptions,
} from '@/api/hooks/call-notes'
import { queryKeys } from '@/api/query'
import type { CallNoteIn, CallNoteSummary } from '@/api/v17'
import { changeDetail } from '@/lib/problems'
import { draftWithKey, dropDraft, keepDraft, readDraft, type NoteDraft } from './draft'
import { checkFollowUp } from './follow-up'
import {
  FOLLOW_UP_NOT_ADDED,
  NOT_SAVED,
  NOT_UNDONE,
  NOTE_KEPT,
  savedWords,
  TRY_AGAIN,
  UNDO,
  UNDONE,
} from './words'

export interface LogCallInput {
  client: QueryClient
  /** The note as the rep left it. Its key goes in the Idempotency-Key header. */
  draft: NoteDraft
  /** The call prep the panel had open, or null. */
  prepId: string | null
  /** False: the follow-up typed by hand goes with the note. */
  aiEnabled: boolean
}

/** One save, from the press to the server's answer, and an Undo. */
interface Save {
  input: LogCallInput
  /** The note's id, once the server has answered. */
  noteId: string | null
  /** This save's +1 is in the "to confirm" count now. */
  counted: boolean
  undone: boolean
  /** The key of the draft Undo put back, so a failed Undo can take it away again. */
  restoredKey: string | null
}

function run<TData, TVariables>(
  client: QueryClient,
  options: MutationObserverOptions<TData, ApiProblem, TVariables>,
  variables: TVariables,
): Promise<TData> {
  return new MutationObserver(client, options).mutate(variables)
}

function bodyOf({ draft, prepId }: LogCallInput): CallNoteIn {
  return {
    company_key: draft.companyKey,
    contact_id: draft.contactId,
    prep_id: prepId,
    text: draft.text.trim(),
    source: draft.source,
    called_at: draft.calledAt,
    outcome: draft.outcome,
  }
}

/** A refusal from the server (call notes switched off, say) adds its own words. */
function notSavedDetail(error: unknown): string {
  const problem = toApiProblem(error)
  const refused = problem.status >= 400 && problem.status < 500 && problem.detail
  return refused ? `${problem.detail ?? ''} ${NOTE_KEPT}` : NOTE_KEPT
}

/**
 * Saves the note in the background, and answers the rep at once: the count, and the toast with
 * Undo. Call it, then close the panel.
 */
export function logCallNote(input: LogCallInput): void {
  const { client } = input
  const save: Save = { input, noteId: null, counted: true, undone: false, restoredKey: null }
  const before = client.getQueryData<CallNoteSummary>(queryKeys.companies.callNoteSummary())
  void bumpToConfirm(client, 1)
  const savedToast = toast(savedWords(before ? before.to_confirm + 1 : null), {
    action: {
      label: UNDO,
      onClick: () => {
        undo(save)
      },
    },
  })
  run(client, saveCallNoteOptions(), {
    body: bodyOf(input),
    idempotencyKey: input.draft.key,
  }).then(
    (note) => {
      save.noteId = note.id
      // The server has it: the draft goes, unless a newer one has taken its place.
      dropDraft(input.draft.companyKey, input.draft.contactId, input.draft.key)
      if (save.undone) {
        removeNote(save)
        return
      }
      markCountsOld(client)
      const followUp = input.aiEnabled ? null : checkFollowUp(input.draft.followUp)
      if (followUp?.ok && followUp.task) {
        run(client, patchCallNoteOptions(client), {
          id: note.id,
          patch: { tasks: [followUp.task] },
        }).catch(() => {
          if (!save.undone) toast.error(FOLLOW_UP_NOT_ADDED)
        })
      }
    },
    (error: unknown) => {
      if (save.counted) {
        save.counted = false
        void bumpToConfirm(client, -1)
      }
      // After an Undo, nothing was saved and the text is already back as the draft.
      if (save.undone) return
      toast.dismiss(savedToast)
      toast.error(NOT_SAVED, {
        description: notSavedDetail(error),
        action: {
          label: TRY_AGAIN,
          onClick: () => {
            tryAgain(input)
          },
        },
      })
    },
  )
}

/** Try again: the draft as it is now, with the same key. Gone (saved since): nothing to do. */
function tryAgain(input: LogCallInput): void {
  const draft = draftWithKey(input.draft.key)
  if (draft) logCallNote({ ...input, draft })
}

function undo(save: Save): void {
  if (save.undone) return
  save.undone = true
  const { client, draft } = save.input
  if (save.counted) {
    save.counted = false
    void bumpToConfirm(client, -1)
  }
  // The text goes back as this call's draft, unless the rep has started a newer one since.
  const stored = readDraft(draft.companyKey, draft.contactId)
  if (!stored || stored.key === draft.key) {
    const restored: NoteDraft = {
      ...draft,
      key: newIdempotencyKey(),
      updatedAt: new Date().toISOString(),
    }
    keepDraft(restored)
    save.restoredKey = restored.key
  }
  // Before the save has answered, the delete waits for the answer (`logCallNote`).
  if (save.noteId !== null) removeNote(save)
  toast(UNDONE)
}

function removeNote(save: Save): void {
  const { client, draft } = save.input
  const id = save.noteId
  if (id === null) return
  run(client, deleteCallNoteOptions(), id).then(
    () => {
      markCountsOld(client)
    },
    (error: unknown) => {
      // The note is still there: it counts again, and the draft Undo put back would make a
      // second one, unless the rep has already changed it.
      if (!save.counted) {
        save.counted = true
        void bumpToConfirm(client, 1)
      }
      const stored = readDraft(draft.companyKey, draft.contactId)
      if (save.restoredKey !== null && stored?.text === draft.text) {
        dropDraft(draft.companyKey, draft.contactId, save.restoredKey)
      }
      const detail = changeDetail(toApiProblem(error))
      toast.error(NOT_UNDONE, detail ? { description: detail } : undefined)
    },
  )
}
