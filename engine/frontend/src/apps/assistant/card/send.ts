/**
 * What the review card asks the server (PLAN-V22 T3-3 and T3-4, the contract parts 3 and 4, and
 * call notes' own routes): the previews while the card is open, and the one send after the hold.
 *
 * - **A task:** `POST /assistant/tasks/preview`, then `POST /assistant/tasks`, both with the card's
 *   Idempotency-Key, so a double press or a retry adds one task.
 * - **An email:** `POST /assistant/email/preview`, then `POST /assistant/email` with the key.
 * - **A call:** the note is saved as the card opens (`POST /call-notes`, with the card's key), and
 *   the send is `POST /call-notes/confirm` with that one id.
 * - **A call whose company isn't found** (PLAN-V24 T3-2, choice 17) is saved at once too, with the
 *   name as heard (`heardNoteBodyOf`): the server keeps it as "Needs a company", unsorted. The
 *   company picked later goes as a PATCH (`pickNoteCompany`), and the call is sorted then. It never
 *   goes to HubSpot before that (choice 18): the send leaves it out and says why.
 *
 * After the send a toast says how it went. A send that didn't go keeps the draft, and its toast
 * opens the card again.
 *
 * **A learned name** (PLAN-V23 T1-5): once a call or a task has gone, a company the rep found by
 * hand (the command found nothing) teaches the mic the words heard, for the whole team. Never on
 * Later, Cancel, Undo or a send that failed. A refusal is quiet: the send itself went. A call saved
 * before its company taught the mic as its company was picked, on the server, so it isn't sent
 * again here.
 */
import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, toApiProblem, unwrap } from '@/api/client'
import { teachName } from '@/api/hooks/assistant-names'
import { markCountsOld, refreshCallNoteLists } from '@/api/hooks/call-notes'
import { queryKeys } from '@/api/query'
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
import { needsCompanySendWords } from '@/apps/companies/call-logs/words'
import { changeDetail } from '@/lib/problems'
import { CALL_LOGS_PATH } from '../paths'
import { emailBodyOf, learnedOf, taskBodyOf, type CardDraft, type CallDraft } from './draft'
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

/** The longest name as heard the server keeps (the contract: 1 to 120 characters). */
export const HEARD_MAX = 120

/**
 * A call whose company isn't found, to save at once as "Needs a company" (PLAN-V24 T3-2, choice
 * 17): the name as heard, and no company. Null with no name heard: the server needs one.
 */
export function heardNoteBodyOf(draft: CallDraft): CallNoteIn | null {
  const heard = draft.company.heard.trim().slice(0, HEARD_MAX).trim()
  if (heard === '') return null
  return {
    company_heard: heard,
    text: draft.text.trim(),
    source: draft.source,
    called_at: draft.calledAt,
  }
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

/**
 * Removes a call not yet sent (`DELETE /call-notes/{id}`): a call saved with the company the card
 * used at once, when the rep changes or undoes it (PLAN-V25 T1-2). The server takes a call's
 * company once, so the call is saved again with the new one.
 */
export async function removeNote(id: string): Promise<void> {
  unwrap(await api.DELETE('/companies/call-notes/{note_id}', { params: { path: { note_id: id } } }))
}

export async function patchNote(id: string, patch: CallNotePatch): Promise<CallNoteOut> {
  return unwrap(
    await api.PATCH('/companies/call-notes/{note_id}', {
      params: { path: { note_id: id } },
      body: patch,
    }),
  )
}

/**
 * Picks the company of a call saved before it: the server sorts it then (PLAN-V24 T3-1). It
 * teaches the mic the words heard, unless `teach` is false: a pick from the command's own choices
 * ("Which Sample?") teaches nothing (PLAN-V23; Al-khair, 21 Nov). Left out, the server teaches.
 */
export async function pickNoteCompany(
  id: string,
  companyKey: string,
  teach?: false,
): Promise<CallNoteOut> {
  return patchNote(
    id,
    teach === false ? { company_key: companyKey, teach: false } : { company_key: companyKey },
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

/** The send went: a company found by hand teaches the mic the words heard (T1-5). */
function teach(draft: CardDraft): void {
  const pair = learnedOf(draft)
  if (pair) void teachName(pair).catch(() => undefined)
}

/** A call not sent, with why: it stays in Call logs. */
function callNotSent(why: string, tools: SendTools): void {
  toast.error(NOT_SENT, {
    description: why,
    action: {
      label: OPEN_CALL_LOGS,
      onClick: () => {
        tools.go(CALL_LOGS_PATH)
      },
    },
  })
}

async function sendCall(draft: CallDraft, tools: SendTools): Promise<void> {
  const id = draft.noteId
  if (id === null) return
  const saved = tools.client.getQueryData<CallNoteOut>(queryKeys.companies.callNote(id))
  if (saved?.status === 'needs_company') {
    // Never to HubSpot before its company (choice 18). The card's Send stops before this.
    callNotSent(needsCompanySendWords(1), tools)
    return
  }
  const answer: CallNoteConfirm = unwrap(
    await api.POST('/companies/call-notes/confirm', { body: { ids: [id] } }),
  )
  markCountsOld(tools.client)
  void refreshCallNoteLists(tools.client)
  const skipped = answer.skipped?.find((one) => one.id === id)
  if (skipped) {
    callNotSent(skipped.why, tools)
    return
  }
  // Saved before its company, the call taught the mic as it was picked (PLAN-V24 T3-1).
  if (!saved?.company_heard) teach(draft)
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
          teach(draft)
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
