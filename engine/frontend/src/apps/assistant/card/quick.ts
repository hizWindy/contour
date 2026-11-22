/**
 * The quick log (PLAN-V25 T3-3, choice 15; Al-khair's answer to A2 on 22 Nov: yes). A call that is
 * only an outcome (No answer, Left voicemail, Busy or Wrong number), with a sure company and a sure
 * person and nothing else said, skips the card. The server judges it (`command.quick`). Any words,
 * a follow-up, a field change or any doubt still open the card.
 *
 * - **The call is saved at once,** as a card saves it, with its outcome and call type, so it is in
 *   Call logs from the first moment.
 * - **The hold's toast is the preview** (this bends DESIGN.md principle 3, on Al-khair's word): it
 *   says exactly what goes, "Logging No answer with Jo Sample, Northwind.", with Undo, for 5
 *   seconds. Undo, or Esc, sends nothing and opens the card with the draft and its saved call.
 * - **After the hold** it waits for the server to sort the call (a few seconds), then sends it as
 *   the card's Send does (`sendDraft`), with the same toasts. A call still sorting after
 *   `SORT_WAIT_MS` stays in Call logs' To confirm, and a toast says so (TBC).
 * - **A save that fails** opens the card in the hold, which says why and tries again with the same
 *   key. After the hold, a toast says it wasn't sent, and Open brings the card back.
 * - **A page closed in the 5 seconds** sends nothing (`hold.tsx`): the call waits in Call logs.
 */
import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { toApiProblem } from '@/api/client'
import type { SignIn } from '@/api/hooks/auth'
import { markCountsOld, refreshCallNoteLists } from '@/api/hooks/call-notes'
import { queryKeys } from '@/api/query'
import type { AssistantCommand, CallNoteOut, CommandSource } from '@/api/types'
import { melbourneDate } from '@/lib/format'
import { changeDetail } from '@/lib/problems'
import { CALL_LOGS_PATH } from '../paths'
import { draftOf, noteBodyOf, type CallDraft } from './draft'
import { startHold } from './hold'
import { readNote, saveNote, sendDraft } from './send'
import { openCard } from './store'
import { CARD_TIMES } from './times'
import { CALL_KEPT, NOT_SENT, OPEN, OPEN_CALL_LOGS, quickLogWords } from './words'

/** How long a quick log waits for its call to be sorted before it leaves it in To confirm (TBC). */
export const SORT_WAIT_MS = 60_000

/** What the bar heard, read into a command. */
export interface QuickHeard {
  command: AssistantCommand
  words: string
  source: CommandSource
}

export interface QuickTools {
  client: QueryClient
  /** Opens a page of the app (a toast's Open Call logs). */
  go: (to: string) => void
  /** For tests: the hold, how often a sorting call is read again, and the longest wait. */
  times?: { hold?: number; sort?: number; sortWait?: number }
}

/** A quick log: a call the server judged quick, with an outcome, a company and a person found. */
export function isQuickLog(command: AssistantCommand): boolean {
  return (
    command.action === 'log_call' &&
    command.quick === true &&
    Boolean(command.outcome) &&
    Boolean(command.company?.found) &&
    Boolean(command.person?.found)
  )
}

function signedInAs(client: QueryClient): string | null {
  const signIn = client.getQueryData<SignIn>(queryKeys.auth.me())
  return signIn?.state === 'signed_in' ? signIn.user.id : null
}

function pause(ms: number): Promise<void> {
  return new Promise((done) => {
    window.setTimeout(done, ms)
  })
}

/** The call once the server has sorted it, or as it is after `wait` ms (still sorting). */
async function sortedNote(start: CallNoteOut, every: number, wait: number): Promise<CallNoteOut> {
  let note = start
  const until = Date.now() + wait
  while (note.status === 'sorting' && Date.now() < until) {
    await pause(every)
    note = await readNote(note.id)
  }
  return note
}

/** The call kept in Call logs, with why it didn't go now. */
function keptInCallLogs(go: (to: string) => void): void {
  toast(CALL_KEPT, {
    action: {
      label: OPEN_CALL_LOGS,
      onClick: () => {
        go(CALL_LOGS_PATH)
      },
    },
  })
}

async function sendQuick(
  draft: CallDraft,
  save: Promise<CallNoteOut>,
  reopen: (saved: CallNoteOut | null) => void,
  tools: QuickTools,
): Promise<void> {
  const { client, go, times = {} } = tools
  let saved: CallNoteOut
  try {
    saved = await save
  } catch (error) {
    // Never saved: the card brings it back, and saves it with the same key.
    toast.error(NOT_SENT, {
      description: changeDetail(toApiProblem(error)) ?? undefined,
      action: {
        label: OPEN,
        onClick: () => {
          reopen(null)
        },
      },
    })
    return
  }
  let note: CallNoteOut
  try {
    note = await sortedNote(saved, times.sort ?? CARD_TIMES.sort, times.sortWait ?? SORT_WAIT_MS)
  } catch {
    keptInCallLogs(go)
    return
  }
  client.setQueryData(queryKeys.companies.callNote(note.id), note)
  if (note.status === 'sorting') {
    keptInCallLogs(go)
    return
  }
  await sendDraft(
    { ...draft, noteId: note.id },
    {
      client,
      today: melbourneDate(),
      reopen: () => {
        reopen(note)
      },
      go,
    },
  )
}

/**
 * Starts a quick log: the save, then the hold with its toast. False when the command isn't one (the
 * card opens instead).
 */
export function startQuickLog(heard: QuickHeard, tools: QuickTools): boolean {
  if (!isQuickLog(heard.command)) return false
  const { client, times = {} } = tools
  const by = signedInAs(client)
  const draft = draftOf(heard, by)
  if (draft?.action !== 'log_call') return false
  const body = noteBodyOf(draft)
  const company = draft.company.found
  const person = draft.person.found
  if (!body || !company || !person || !draft.outcome) return false

  let saved: CallNoteOut | null = null
  let holding = true
  /** The card again, with the call it saved: it isn't saved twice. */
  const reopen = (note: CallNoteOut | null): void => {
    const known = note ?? saved
    openCard({ kind: 'draft', draft: known ? { ...draft, noteId: known.id } : draft })
  }
  const save = saveNote(body, draft.key).then((note) => {
    saved = note
    client.setQueryData(queryKeys.companies.callNote(note.id), note)
    markCountsOld(client)
    void refreshCallNoteLists(client)
    return note
  })
  const stop = startHold({
    action: 'log_call',
    title: quickLogWords(draft.outcome, person.name, company.name),
    ms: times.hold ?? CARD_TIMES.hold,
    stillSignedIn: () => signedInAs(client) === by,
    send: () => {
      holding = false
      void sendQuick(draft, save, reopen, tools)
    },
    onUndo: () => {
      holding = false
      reopen(null)
    },
  })
  save.catch(() => {
    // Not saved while the hold runs: the card opens, says why, and tries again with the same key.
    if (!holding) return
    holding = false
    stop()
    reopen(null)
  })
  return true
}
