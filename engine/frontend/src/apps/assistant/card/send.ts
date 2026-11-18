/**
 * What the review card asks the server (PLAN-V22 T3-3 and T3-4, the contract parts 3 and 4, and
 * call notes' own routes): the previews while the card is open, and the one send after the hold.
 *
 * - **A task:** `POST /assistant/tasks/preview`, then `POST /assistant/tasks`, both with the card's
 *   Idempotency-Key, so a double press or a retry adds one task.
 * - **An email:** `POST /assistant/email/preview`, then `POST /assistant/email` with the key.
 * - **A call:** the note is saved as the card opens (`POST /call-notes`, with the card's key), and
 *   the send is `POST /call-notes/confirm` with that one id.
 *
 * After the send a toast says how it went. A send that didn't go keeps the draft, and its toast
 * opens the card again.
 */
import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, toApiProblem, unwrap } from '@/api/client'
import { markCountsOld, refreshCallNoteLists } from '@/api/hooks/call-notes'
import type {
  AssistantEmailIn,
  AssistantTaskIn,
  CallNoteConfirm,
  CallNoteIn,
  CallNoteOut,
  CallNotePatch,
  CallNotePreview,
  HubSpotWrite,
  TeamEmail,
} from '@/api/types'
import { changeDetail } from '@/lib/problems'
import { CALL_LOGS_PATH } from '../paths'
import { emailBodyOf, taskBodyOf, type CardDraft, type CallDraft } from './draft'
import { dropCardDraft, keepCardDraft } from './drafts'
import { CALL_SENT, emailSent, KEPT, NOT_SENT, OPEN, OPEN_CALL_LOGS, TASK_ADDED } from './words'

// --- While the card is open ------------------------------------------------------------------------

export async function previewTask(
  body: AssistantTaskIn,
  key: string,
  signal?: AbortSignal,
): Promise<HubSpotWrite> {
  return unwrap(
    await api.POST('/companies/assistant/tasks/preview', {
      body,
      params: { header: { 'idempotency-key': key } },
      signal,
    }),
  )
}

export async function previewEmail(
  body: AssistantEmailIn,
  signal?: AbortSignal,
): Promise<TeamEmail> {
  return unwrap(await api.POST('/companies/assistant/email/preview', { body, signal }))
}

/** Saves the call's note as the card opens: the sorter starts on the server. */
export async function saveNote(body: CallNoteIn, key: string): Promise<CallNoteOut> {
  return unwrap(
    await api.POST('/companies/call-notes', {
      body,
      params: { header: { 'idempotency-key': key } },
    }),
  )
}

export async function readNote(id: string, signal?: AbortSignal): Promise<CallNoteOut> {
  return unwrap(
    await api.GET('/companies/call-notes/{note_id}', { params: { path: { note_id: id } }, signal }),
  )
}

/** HubSpot's values now, for the old to new of each change. Nothing is written. */
export async function previewNote(id: string, signal?: AbortSignal): Promise<CallNotePreview> {
  return unwrap(await api.POST('/companies/call-notes/preview', { body: { ids: [id] }, signal }))
}

export async function patchNote(id: string, patch: CallNotePatch): Promise<CallNoteOut> {
  return unwrap(
    await api.PATCH('/companies/call-notes/{note_id}', {
      params: { path: { note_id: id } },
      body: patch,
    }),
  )
}

// --- After the hold -------------------------------------------------------------------------------

export interface SendTools {
  client: QueryClient
  /** Melbourne's day, for reading a task's "When". */
  today: string
  /** Opens the card again on this draft (a toast's Open). */
  reopen: (draft: CardDraft) => void
  /** Opens a page of the app. */
  go: (to: string) => void
}

/** A send that didn't go: the draft stays, and Open brings the card back. */
function notSent(draft: CardDraft, detail: string | null, { reopen }: SendTools): void {
  keepCardDraft(draft)
  toast.error(NOT_SENT, {
    description: [detail, KEPT].filter(Boolean).join(' '),
    action: {
      label: OPEN,
      onClick: () => {
        reopen(draft)
      },
    },
  })
}

function problemDetail(error: unknown): string | null {
  return changeDetail(toApiProblem(error))
}

async function sendCall(draft: CallDraft, tools: SendTools): Promise<void> {
  const id = draft.noteId
  if (id === null) return
  const answer: CallNoteConfirm = unwrap(
    await api.POST('/companies/call-notes/confirm', { body: { ids: [id] } }),
  )
  markCountsOld(tools.client)
  void refreshCallNoteLists(tools.client)
  const skipped = answer.skipped?.find((one) => one.id === id)
  if (skipped) {
    toast.error(NOT_SENT, {
      description: skipped.why,
      action: {
        label: OPEN_CALL_LOGS,
        onClick: () => {
          tools.go(CALL_LOGS_PATH)
        },
      },
    })
    return
  }
  toast.success(CALL_SENT, {
    action: {
      label: OPEN_CALL_LOGS,
      onClick: () => {
        tools.go(CALL_LOGS_PATH)
      },
    },
  })
}

/** The one send, after the hold. Every failure keeps the draft and says why. */
export async function sendDraft(draft: CardDraft, tools: SendTools): Promise<void> {
  try {
    switch (draft.action) {
      case 'log_call':
        await sendCall(draft, tools)
        return
      case 'task': {
        const body = taskBodyOf(draft, tools.today)
        if (!body) return
        const write = unwrap(
          await api.POST('/companies/assistant/tasks', {
            body,
            params: { header: { 'idempotency-key': draft.key } },
          }),
        )
        if (write.status === 'done') {
          dropCardDraft(draft.by, draft.key)
          toast.success(TASK_ADDED)
          return
        }
        const step = write.steps.find((one) => one.status !== 'done')
        notSent(draft, step?.detail ?? write.error ?? null, tools)
        return
      }
      case 'email': {
        const body = emailBodyOf(draft)
        if (!body) return
        const sent = unwrap(
          await api.POST('/companies/assistant/email', {
            body,
            params: { header: { 'idempotency-key': draft.key } },
          }),
        )
        dropCardDraft(draft.by, draft.key)
        toast.success(emailSent(sent.people.length))
        return
      }
    }
  } catch (error) {
    if (draft.action === 'log_call') {
      // The note is safe in Call logs: only the send didn't start.
      toast.error(NOT_SENT, {
        description: problemDetail(error) ?? undefined,
        action: {
          label: OPEN_CALL_LOGS,
          onClick: () => {
            tools.go(CALL_LOGS_PATH)
          },
        },
      })
      return
    }
    notSent(draft, problemDetail(error), tools)
  }
}
