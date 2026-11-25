/**
 * The review card (PLAN-V22 T3-3 and T3-4, choices 19 to 24): the one manual step for a command.
 * It shows the draft before anything is sent, with a layout for each action (`layouts.tsx`).
 *
 * - **It opens like the mic card** (`MicSheet`): centred, from 0.96 to 1 with a fade, while the page
 *   behind dims over 250ms, and it closes in 150ms. With reduced motion it simply appears.
 * - **Its first line is the read-back** (choice 21), the dialog's title, so a screen reader hears it.
 * - **Keys** (choice 19): it is a dialog, so the page behind hears none of them, and the focus
 *   starts on Send. Enter sends and Esc cancels (the draft is kept). In a box, Enter adds a line,
 *   Ctrl+Enter (Cmd on a Mac) sends, and the first Esc leaves the box. Enter does nothing for the
 *   first half second, and Enter with a choice still to make or an empty required box goes there
 *   instead of sending. V on the card (not in a box) speaks a change, like "make the follow-up
 *   Monday": the words go to the command step with the card's action and boxes, and its `change`,
 *   `send` or `cancel` is done here. Each box has its own mic, which writes straight into it.
 * - **The hint bar** (choice 20) shows the keys for where the focus is, on a laptop.
 * - **A call** is saved as the card opens (`POST /call-notes`), so the server sorts it while the rep
 *   reads. The card shows the sort when it is ready, with HubSpot's values now from a fresh
 *   `/call-notes/preview`. Each of its parts takes typing too (PLAN-V23 T4-2): a box saves when it
 *   is left (`PATCH /call-notes/{id}`), and Esc leaves it, as above.
 * - **No call lost** (PLAN-V24 T3-2, choices 17 to 19): a call whose company isn't found is saved
 *   at once too, with the name as heard, as "Needs a company". Its company picked later (a choice,
 *   the search list, Add to HubSpot, or by voice) goes as a PATCH, and the call is sorted then.
 *   Until then the call takes only its outcome, and while it sorts nothing: a change said meanwhile
 *   is kept, and made once it is sorted, even after the card has gone (`held.ts`). Its Send says
 *   why it waits, and Later keeps it in Call logs. While the card waits on its company, the words said fill its company search
 *   (`choose.ts`), and "the first one" picks from what the search found.
 * - **Later, not Cancel, on a call** (PLAN-V23 T4-2): Later, or Esc, keeps the call in Call logs'
 *   To confirm, to send with the others ("Kept in Call logs, to send with the others.").
 * - **Sending** (T3-4): Enter, a click on Send or "send it" closes the card and starts the 5 second
 *   hold (`hold.tsx`), with Undo. After a spoken command, the card listens 5 seconds for "send it"
 *   or "cancel" (`listen.ts`); any key or click stops it.
 * - **When a name goes wrong** (PLAN-V23 T1-6): the company part says it ("new in HubSpot", "isn't
 *   in HubSpot", with Add to HubSpot), so the server's paragraph above leaves those lines out.
 *   Unclear words spoken on the card wait in its strip's text line, as in the bar.
 * - **Hold V** (PLAN-V23 choice 6) on the card works as in the bar: a V held 0.4 seconds ends the
 *   change it started as it comes up.
 * - **In a long conversation** (PLAN-V24 T2-3, choice 13): a card that opens while the voice bar's
 *   conversation listens hears it for as long as it is open, through the conversation's one mic,
 *   and opens none of its own. Its ear (`attachCard`) reads each turn first, with no AI: "send it"
 *   sends, and "later" or "cancel" does what Later or Cancel does. Anything else goes to the
 *   command step as a change, as V's change does; a new command gets "Send or keep this one
 *   first." (TBC). V stops the conversation. After a send, the bar comes back and says "Sent.".
 * - **The Listening pill** (PLAN-V24 T5-1, choices 29 to 31): while the voice bar's mic is on, the
 *   bar shrinks to a pill beside the card (`voice/pill.tsx`), in the card's own dialog layer, so
 *   Stop can be clicked and reached by the keyboard. It says what the bar would, and what to say to
 *   the card. Once the conversation stops with a line (the quiet stop, a problem), the pill keeps
 *   it, with the bar's buttons, until the card closes. Its buttons put the focus back on the card:
 *   Type instead in the card's first box, the others on Send.
 * - **The card's own listening follows the engine** (PLAN-V24 T4-3): the 5 seconds for "send it",
 *   and V's change, use the browser's service or the model on the device, as the bar does.
 * - **V with "Keep listening" on** and the bar closed starts a conversation, which the card hears
 *   (`converse`). With it off, V speaks one change, as before.
 * - **Its question by voice** (PLAN-V24 T2-4, choice 14): while it asks "Which Sample?", "the
 *   second one" or a name from its list picks it, in the code, with no AI (`choose.ts`). A person's
 *   or a teammate's name that isn't there changes nothing, and the card says so.
 *
 * - **Smart choices** (PLAN-V25 T1-2, T2-2): each unclear company, person, teammate or meeting
 *   shows in the suggestion part (`suggest.tsx`). Enter takes a suggestion where a send waits on it
 *   (`suggestionIn`), and the keys 1, 2 and 3 pick from the first open question (`pickByKey`). A
 *   call saved with a sure company that the rep changes or undoes is removed and saved again with
 *   the new one, since the server takes a call's company once (`changeCallCompany`, TBC).
 *
 * - **Research** (PLAN-V27 T4-2): a research command opens its own card (`research.tsx`), which
 *   asks once, with the cost, and starts the run in the background.
 *
 * Its code loads with the voice bar's, late, never in the first visit (`host.tsx`).
 */
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { Send } from 'lucide-react'
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
} from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { isAbort, newIdempotencyKey, toApiProblem } from '@/api/client'
import { readCommand } from '@/api/hooks/assistant'
import type { SignIn } from '@/api/hooks/auth'
import { useCallNoteOptions, voiceToolOf } from '@/api/hooks/call-note-counts'
import {
  callNotePreviewQueryOptions,
  callNoteQueryOptions,
  markCountsOld,
  refreshCallNoteLists,
} from '@/api/hooks/call-notes'
import { queryKeys } from '@/api/query'
import type {
  AssistantChange,
  AssistantCommand,
  AssistantCommandIn,
  AssistantEmailIn,
  AssistantMeetingHit,
  AssistantTaskIn,
  CallNoteIn,
  CallNoteOut,
  CallNotePatch,
} from '@/api/types'
import {
  callTypeOf,
  DEFAULT_CALL_TYPE,
  needsCompanySendWords,
  NOT_CHANGED,
  type CallType,
} from '@/apps/companies/call-logs/words'
import type { MicEnv } from '@/apps/companies/call-notes/mic/session'
import {
  browserFacts,
  deviceKind,
  pickEngine,
  type DeviceKind,
} from '@/apps/companies/call-notes/mic/voice-engine'
import type { VoiceToolMaker } from '@/apps/companies/call-notes/mic/voice-tool'
import { problemWords } from '@/apps/companies/call-notes/mic/words'
import { useNoHubSpotUser } from '@/auth/hubspot-user'
import { MicSheet, MicSheetTitle } from '@/components/motion/mic-sheet'
import { useStill } from '@/components/motion/use-still'
import { Button } from '@/components/ui/button'
import { useDebounced } from '@/hooks/useDebounced'
import { melbourneDate } from '@/lib/format'
import { changeDetail, toastProblem } from '@/lib/problems'
import { PHONE, useMediaQuery } from '@/lib/use-media-query'
import { CALL_LOGS_PATH, MEETINGS_PATH, type NewPreReadState } from '../paths'
import { BarSession, type BarProblem, type BarSnapshot, type CardTook } from '../voice/bar-session'
import {
  preReadPath,
  startPreRead,
  unclearAnswer,
  type AfterAnswer,
  type Heard,
} from '../voice/hand-over'
import { VOICE_BAR } from '../voice/keys'
import { ListeningPill } from '../voice/pill'
import { micIsOn, type PillActionId, type PillState } from '../voice/pill-state'
import { playTone, type Tone } from '../voice/tone'
import { isVKeyOn } from '../voice/v-switch'
import {
  CANT_READ_YET,
  LEFT_PAGE,
  NOTHING_HEARD,
  QUIET_STOP,
  TOO_LONG,
  TOO_MANY,
  TOO_SLOW,
  VOICE_NOT_SET_UP,
} from '../voice/words'
import {
  applyChange,
  BOXES,
  callPatchOf,
  cardWordsOf,
  draftOf,
  emailBodyOf,
  emptyDraftOf,
  isPersonFirst,
  isSuggested,
  missingOf,
  noteBodyOf,
  pickCompany,
  readBackOf,
  taskBodyOf,
  type Box,
  type CallDraft,
  type CardDraft,
  type CompanyFind,
} from './draft'
import { pickByVoice, yesOrNo } from './choose'
import type { CompanyVoice, ShownChoice } from './company'
import { useCompanyFind } from './find'
import { keepCardDraft } from './drafts'
import { heldPatchOf, keepUntilSorted } from './held'
import { inTextBox, pickByKey, suggestionIn, typingKey } from './keys'
import { startHold } from './hold'
import { CallLayout, EmailLayout, PreReadLayout, TaskLayout, type EditCall } from './layouts'
import { cardLinesOf, unsureLeft } from './lines'
import { listenForSendIt } from './listen'
import { ResearchCard } from './research'
import { CARD_TIMES, type CardTimes } from './times'
import { HintBar, ListenStrip, PartProblem, VoiceStrip } from './parts'
import {
  heardNoteBodyOf,
  patchNote,
  pickNoteCompany,
  previewEmail,
  previewTask,
  readNote,
  removeNote,
  saveNote,
  notSentOutcome,
  sendDraft,
  type SendOutcome,
  type SendTools,
} from './send'
import {
  ok as okReply,
  replyForSend,
  STILL_SENDING_REPLY,
  unsure as unsureReply,
} from '../voice/live/bridge'
import { FILL_IN_FIRST, READY } from '../voice/live/words'
import { openCard, openedCard, type CardRequest } from './store'
import { isNoHubSpotUser, needsTeammate } from './teammate-rules'
import {
  CALL_KEPT,
  CANCEL,
  CARD_CAN,
  CHANGE_WAITS,
  DRAFT_KEPT,
  KEPT_NEEDS_COMPANY,
  LATER,
  noOneHereWords,
  OPEN,
  OPEN_CALL_LOGS,
  PICK_ONE,
  SAY_COMPANY,
  SAY_SEND_IT,
  SAY_YES,
  SEND,
  SEND_OR_KEEP,
  SENT,
  WHICH_MEETING,
} from './words'

export interface ReviewCardProps {
  request: CardRequest
  open: boolean
  onClose: () => void
  /** For tests: the browser, the voice tool, the command step and the waits. */
  env?: MicEnv
  makeTool?: VoiceToolMaker | null
  read?: (body: AssistantCommandIn, signal: AbortSignal) => Promise<AssistantCommand>
  times?: Partial<CardTimes>
  /**
   * The voice bar's conversation while it keeps listening (PLAN-V24 T2-3): a card that opens while
   * it listens hears its turns, and opens no mic of its own.
   */
  conversation?: BarSession | null
  /** V on the card starts a conversation: "Keep listening" is on, and the bar is closed. */
  converse?: (() => void) | null
  /**
   * The voice bar, shrunk to a pill beside the card while the bar is open (PLAN-V24 T5-1): what it
   * says, and its buttons. Null: the bar is closed.
   */
  pill?: PillState | null
  /** For tests: the tone as V's own listening starts and stops (T5-1). Left out: the real one. */
  tone?: Tone
}

/** A call's own boxes (`layouts.tsx`), which save when they are left (PLAN-V23 T4-2). */
const CALL_EDIT = '[data-slot="call-edit"]'

/** The card's width: more than the mic card's, for its boxes (TBC at Al-khair's look). */
const WIDTH = 'w-[min(32rem,calc(100vw-2rem))]'

/** Who is signed in, so a draft is kept in their own entry, and a hold acts only for them. */
function signedInAs(client: QueryClient): string | null {
  const signIn = client.getQueryData<SignIn>(queryKeys.auth.me())
  return signIn?.state === 'signed_in' ? signIn.user.id : null
}

const noSubscribe = (): (() => void) => () => undefined
const IDLE: BarSnapshot = {
  phase: 'starting',
  mic: null,
  words: '',
  draft: '',
  problem: null,
  answer: null,
  voice: true,
  fixes: [],
  conversation: null,
}
const idleSnapshot = (): BarSnapshot => IDLE

/**
 * A problem of V's strip, in the voice bar's words. `device`: the model's problems offer the
 * keyboard's mic on a phone or a tablet only (the PLAN-V24 browser check).
 */
function stripProblem(problem: BarProblem, device: DeviceKind): string {
  switch (problem.kind) {
    case 'nothing_heard':
      return NOTHING_HEARD
    case 'too_many':
      return TOO_MANY
    case 'too_slow':
      return TOO_SLOW
    case 'mic':
      return problemWords(problem.problem, device)
    case 'no_voice':
      return VOICE_NOT_SET_UP
    case 'other':
      return problem.title
    case 'unclear':
      return problem.line
    case 'quiet':
      return QUIET_STOP
    case 'too_long':
      return TOO_LONG
    case 'left':
      return LEFT_PAGE
    case 'live':
    case 'fallback':
      // Never here: the card's own V keeps today's engines (PLAN-V28).
      return problem.line
  }
}

/** A V key, with or without Shift. */
function isVKey(event: { key: string }): boolean {
  return event.key === 'v' || event.key === 'V'
}

/** A phone or tablet: the pointer is a finger, as the conversation tells a phone (`voice/screen.ts`). */
function fingerPointer(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

/**
 * A refusal the preview gives (a 4xx): the send would be refused too, so it waits. A task with no
 * one to do it isn't said here: its "For whom" says it, with the team list (PLAN-V23 T3-4).
 */
function refusal(error: unknown): string | null {
  if (!error || isAbort(error) || isNoHubSpotUser(error)) return null
  const problem = toApiProblem(error)
  if (problem.status < 400 || problem.status >= 500 || problem.status === 429) return null
  return [problem.title, problem.detail].filter(Boolean).join('. ')
}

// --- A pre-read whose meeting the command couldn't pin down --------------------------------------

function PreReadCard({
  command,
  open,
  onClose,
}: {
  command: AssistantCommand
  open: boolean
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const company =
    command.company?.found?.name ?? command.company?.heard ?? command.meeting?.heard ?? ''
  const go = (to: string): void => {
    onClose()
    void navigate(to)
  }
  const pick = (meeting: AssistantMeetingHit): void => {
    if (busy) return
    if (meeting.form) {
      go(preReadPath(meeting.form.id))
      return
    }
    if (meeting.id === null) {
      go(MEETINGS_PATH)
      return
    }
    setBusy(true)
    setProblem(null)
    startPreRead(meeting.id).then(
      (form) => {
        go(preReadPath(form.id))
      },
      (error: unknown) => {
        setBusy(false)
        setProblem(toApiProblem(error).title)
      },
    )
  }
  return (
    <MicSheet
      open={open}
      opener={null}
      className={WIDTH}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      onKeyDown={(event) => {
        // The keys 1, 2 and 3 pick a meeting (PLAN-V25 choice 6).
        const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
        if (plain && pickByKey(root.current, event.key)) event.preventDefault()
      }}
    >
      <div
        ref={root}
        data-slot="review-card"
        data-action="pre_read"
        className="flex flex-col gap-4 p-5"
      >
        <MicSheetTitle className="text-body">{command.read_back || WHICH_MEETING}</MicSheetTitle>
        {command.unsure ? (
          <p className="text-ui text-pretty text-muted-foreground">{command.unsure}</p>
        ) : null}
        <PreReadLayout
          meetings={command.meeting?.choices ?? []}
          level={command.meeting?.level ?? null}
          reason={command.meeting?.reason ?? null}
          company={company}
          onPick={pick}
          onNew={() => {
            // Meetings opens its New pre-read with the company filled in (PLAN-V23 T4-2).
            const found = command.company?.found
            const state: NewPreReadState = {
              newPreRead: found ? { key: found.key, name: found.name } : null,
            }
            onClose()
            void navigate(MEETINGS_PATH, { state })
          }}
        />
        {problem ? <PartProblem>{problem}</PartProblem> : null}
      </div>
      <div className="flex justify-end gap-2 border-t px-5 py-3">
        <Button type="button" variant="outline" size="sm" className="touch:h-11" onClick={onClose}>
          {CANCEL}
        </Button>
      </div>
    </MicSheet>
  )
}

// --- The card for a call, a task or an email ---------------------------------------------------------

interface Latest {
  draft: CardDraft
  ready: boolean
  today: string
  note: CallNoteOut | undefined
  outcomes: readonly string[]
  /** A teammate is still to pick (PLAN-V23 T3-4): Send goes there first. */
  teammate: boolean
}

function DraftCard({
  request,
  open,
  onClose,
  env,
  makeTool,
  read = readCommand,
  times,
  conversation = null,
  converse = null,
  pill = null,
  tone = playTone,
  first,
}: ReviewCardProps & { first: CardDraft }) {
  const t: CardTimes = { ...CARD_TIMES, ...times }
  const client = useQueryClient()
  const navigate = useNavigate()
  const options = useCallNoteOptions()
  const onPhone = useMediaQuery(PHONE)
  const today = melbourneDate()
  const tool = voiceToolOf(options.data)
  const mic = !onPhone && tool !== 'typing' ? tool : null

  const [draft, setDraft] = useState<CardDraft>(first)
  const [inBox, setInBox] = useState(false)
  const [inFind, setInFind] = useState(false)
  // A box still to fill shows as one: at once for a command, which was meant to fill it; on an empty
  // card (PLAN-V23 T4-3), only once Send was tried, not before the rep has typed anything.
  const [checked, setChecked] = useState(request.kind !== 'empty')
  // The card's first render holds its frame, its read-back and its buttons; its boxes come in a
  // second one, while the card still fades in from nothing (PLAN-V23 T4-4), so the frame it
  // appears in holds less. With reduced motion the card shows at once, so it is drawn whole.
  const still = useStill()
  const whole = useDeferredValue(true, still)
  // After a spoken command, the card listens for "send it" as it opens (choice 23), once the voice
  // tool setting is known and a voice engine can run here: the browser's service, or the model on
  // the device, as the bar's own session picks it (PLAN-V24 T4-3). Opened while a conversation
  // listens, it hears that instead, and never opens a mic of its own (PLAN-V24 T2-3).
  const spoken = request.kind === 'command' && request.source === 'mic'
  const [inConversation] = useState(() => conversation?.isLive() === true)
  const canListen =
    spoken &&
    !options.isPending &&
    tool !== 'typing' &&
    pickEngine(tool, env) !== null &&
    !inConversation
  const [listenOver, setListenOver] = useState(false)
  const listening = canListen && !listenOver
  const [voice, setVoice] = useState<BarSession | null>(null)
  const [saveProblem, setSaveProblem] = useState<string | null>(null)
  const armed = useRef(false)
  const closing = useRef<'send' | 'cancel' | null>(null)
  /** How the send went, once it has: after the 5-second hold (PLAN-V28 T3-2, for live voice). */
  const sending = useRef<Promise<SendOutcome> | null>(null)
  const stopListen = useRef<((quietly?: boolean) => void) | null>(null)
  const card = useRef<HTMLDivElement>(null)
  const sendButton = useRef<HTMLButtonElement>(null)
  const changeLine = useRef<HTMLInputElement>(null)
  // A screen reader hears "Say 'send it' or press Enter" with the read-back as the card opens.
  const listenId = useId()

  // --- A call: saved at once, then read until sorted, then previewed -----------------------------
  // Its company found as the card opens: saved once its person is picked, as before. Not found,
  // or "Which Sample?": saved at once with the name as heard, as "Needs a company" (PLAN-V24 T3-2,
  // choice 17), and the company picked later goes as a PATCH (below). So is a call whose sure
  // company the rep undid (PLAN-V25 T1-2): its first save went, and it waits for a company again.
  const noteBody =
    draft.action === 'log_call' && draft.noteId === null
      ? draft.company.found === null
        ? heardNoteBodyOf(draft)
        : noteBodyOf(draft)
      : null
  // The call type goes with the save as it is when the save starts (PLAN-V25 T3-1). A tap after
  // that goes as a change (`changeCall`), so it never asks for a second save with the same key.
  const noteAsk = noteBody ? JSON.stringify({ ...noteBody, call_type: undefined }) : null
  const { key } = draft
  /** The newest save, on its way or done: Later waits for it. */
  const saving = useRef<Promise<CallNoteOut> | null>(null)
  const saveCall = (body: CallNoteIn): Promise<CallNoteOut> => {
    const saved = saveNote(body, key).then((note) => {
      client.setQueryData(queryKeys.companies.callNote(note.id), note)
      markCountsOld(client)
      void refreshCallNoteLists(client)
      return note
    })
    saving.current = saved
    return saved
  }
  const startSave = useEffectEvent((body: CallNoteIn) =>
    saveCall(
      draft.action === 'log_call'
        ? { ...body, call_type: draft.callType ?? DEFAULT_CALL_TYPE }
        : body,
    ),
  )
  useEffect(() => {
    if (noteAsk === null) return undefined
    let live = true
    startSave(JSON.parse(noteAsk) as CallNoteIn).then(
      (note) => {
        if (!live) return
        setSaveProblem(null)
        setDraft((now) => (now.action === 'log_call' ? { ...now, noteId: note.id } : now))
      },
      (error: unknown) => {
        if (!live) return
        const problem = toApiProblem(error)
        setSaveProblem([problem.title, problem.detail].filter(Boolean).join('. '))
      },
    )
    return () => {
      live = false
    }
  }, [noteAsk])

  const noteId = draft.action === 'log_call' ? draft.noteId : null
  const note = useQuery({
    ...callNoteQueryOptions(noteId ?? ''),
    enabled: noteId !== null,
    refetchInterval: (query) => (query.state.data?.status === 'sorting' ? t.sort : false),
  })
  // Saved before its company, a call waits for it: neither sorted nor sorting (PLAN-V24 T3-2).
  const waitsForCompany = note.data?.status === 'needs_company'
  const sortedId =
    note.data && note.data.status !== 'sorting' && !waitsForCompany ? note.data.id : null
  const notePreview = useQuery({
    ...callNotePreviewQueryOptions(sortedId ? [sortedId] : []),
    enabled: sortedId !== null,
  })

  // --- A task or an email: the server's preview, once the boxes settle ----------------------------
  const taskBody = draft.action === 'task' ? taskBodyOf(draft, today) : null
  const emailBody = draft.action === 'email' ? emailBodyOf(draft) : null
  const asked = useDebounced(
    taskBody ? JSON.stringify(taskBody) : emailBody ? JSON.stringify(emailBody) : '',
    t.preview,
  )
  const taskPreview = useQuery({
    queryKey: [...queryKeys.companies.all, 'assistant', 'task-preview', asked],
    queryFn: ({ signal }) => previewTask(JSON.parse(asked) as AssistantTaskIn, key, signal),
    enabled: draft.action === 'task' && asked !== '',
    retry: false,
    staleTime: 30_000,
  })
  const emailPreview = useQuery({
    queryKey: [...queryKeys.companies.all, 'assistant', 'email-preview', asked],
    queryFn: ({ signal }) => previewEmail(JSON.parse(asked) as AssistantEmailIn, signal),
    enabled: draft.action === 'email' && asked !== '',
    retry: false,
    staleTime: 30_000,
  })
  const previewProblem =
    draft.action === 'task'
      ? refusal(taskPreview.error)
      : draft.action === 'email'
        ? refusal(emailPreview.error)
        : null

  // Ready to send: what the server's checks say. A preview not back yet doesn't hold a send up: the
  // send is checked again on the server.
  const ready =
    draft.action === 'log_call'
      ? note.data !== undefined &&
        note.data.status === 'to_confirm' &&
        notePreview.data !== undefined &&
        notePreview.data.sending_ready
      : draft.action === 'task'
        ? previewProblem === null && taskPreview.data?.can_write !== false
        : previewProblem === null && emailPreview.data?.can_send !== false

  // No HubSpot user (PLAN-V23 T3-4, choice 15): a follow-up, or a task for yourself, needs a
  // teammate first. The server's refusal of a task says so too, if this page didn't know yet.
  const noUser = useNoHubSpotUser()
  const teammate =
    draft.action === 'log_call'
      ? noUser && note.data !== undefined && needsTeammate(note.data.tasks)
      : draft.action === 'task' &&
        draft.forWhom === null &&
        (noUser || isNoHubSpotUser(taskPreview.error))

  /** The company part as it was before its pick, to go back to if the server refuses it. */
  const unpicked = useRef<CompanyFind | null>(null)
  const latest = useRef<Latest>({ draft, ready, today, note: note.data, outcomes: [], teammate })
  useLayoutEffect(() => {
    latest.current = {
      draft,
      ready,
      today,
      note: note.data,
      outcomes: options.data?.outcomes ?? [],
      teammate,
    }
    if (draft.action !== 'email' && draft.company.found === null) unpicked.current = draft.company
  })

  // --- The company said again (PLAN-V24 T3-2, choice 19) -------------------------------------------
  // While the card waits on its company, words said to it, or a name entered in its search box, go
  // to the card's own find, with no AI (`find.ts`): one found is the card's company at once, as a
  // command's is. The matches on screen are what "the first one" picks from (`shownCompanies`).
  // A find still on its way is dropped once the box's words or the card's company change.
  const pickedKey = draft.action === 'email' ? null : (draft.company.found?.key ?? null)
  // On a call, one found is asked about first: its pick can't be undone (the browser check).
  const {
    said,
    find,
    drop: dropFind,
    confirm: confirmFind,
  } = useCompanyFind(
    (hit, fromHubspot) => {
      setDraft((now) =>
        now.action === 'email' || now.company.found !== null
          ? now
          : {
              ...now,
              company: { ...pickCompany(now.company, hit, 'by_hand'), fromHubspot },
              edited: true,
            },
      )
    },
    pickedKey,
    draft.action === 'log_call',
  )
  const shownCompanies = useRef<readonly ShownChoice[] | null>(null)
  const onShown = useCallback((shown: readonly ShownChoice[] | null) => {
    shownCompanies.current = shown
  }, [])
  const companyVoice = useMemo<CompanyVoice>(
    () => ({ said, onShown, onSubmit: find, onTyped: dropFind, onConfirm: confirmFind }),
    [said, onShown, find, dropFind, confirmFind],
  )
  /** Why a company picked for a call that needs one wasn't taken (choice 21). */
  const [pickProblem, setPickProblem] = useState<string | null>(null)
  /** Send was tried on a call that needs a company: the card says why (choice 18). */
  const [sendWhy, setSendWhy] = useState(false)

  /**
   * The company part changed by its level (PLAN-V25 T1-2): a suggestion turned down, or a sure
   * company changed or undone. A call was saved with the company used at once, and the server
   * takes a call's company once (409 `company_set`): so that call is removed, and saved again with
   * the new company and a new key, as a new call (its sort runs again). Undone, it waits for a
   * company; Later still keeps it, as "Needs a company". The person goes: they were found at the
   * old company. TBC: a PATCH of the company would keep the call's edits (backend).
   */
  const changeCallCompany = (next: CompanyFind): void => {
    const now = latest.current.draft
    if (now.action !== 'log_call') return
    const was = now.company.found
    if (was === null || was.key === next.found?.key) {
      setDraft({ ...now, company: next, edited: true })
      return
    }
    const old = saving.current
    saving.current = null
    setSaveProblem(null)
    setDraft({
      ...now,
      company: next,
      person: { ...now.person, found: null, choices: [], level: null, reason: null },
      key: newIdempotencyKey(),
      noteId: null,
      edited: true,
    })
    const remove = (id: string): void => {
      removeNote(id).then(() => {
        client.removeQueries({ queryKey: queryKeys.companies.callNote(id) })
        markCountsOld(client)
        void refreshCallNoteLists(client)
      }, toastProblem)
    }
    if (old) {
      old.then(
        (saved) => {
          remove(saved.id)
        },
        // Never saved: nothing to remove.
        () => undefined,
      )
    } else if (now.noteId) {
      // Saved before the card opened (a quick log's Undo, M1 review): it goes too.
      remove(now.noteId)
    }
  }

  /** A change to a call by voice, on the server. The read-back follows it. */
  const sendCallPatch = (id: string, patch: CallNotePatch): void => {
    patchNote(id, patch).then((updated) => {
      client.setQueryData(queryKeys.companies.callNote(updated.id), updated)
      setDraft((now) => (now.action === 'log_call' ? { ...now, edited: true } : now))
      void client.invalidateQueries({
        queryKey: queryKeys.companies.callNotePreview([updated.id]),
      })
    }, toastProblem)
  }

  // --- Changes said before a call is sorted (PLAN-V24 T3-2) ---------------------------------------
  // Before its company is set a call takes only its outcome, and while it sorts it takes nothing.
  // The card keeps the rest, in the order said, and makes them once the call is sorted.
  const [held, setHeld] = useState<readonly AssistantChange[]>([])
  /** How many of the changes kept have gone to the server, or on to `held.ts`. */
  const heldSent = useRef(0)
  const sortedNow = note.data?.status === 'to_confirm'
  const sendHeld = useEffectEvent(() => {
    const saved = note.data
    if (!saved || held.length <= heldSent.current) return
    const fresh = held.slice(heldSent.current)
    heldSent.current = held.length
    const patch = heldPatchOf(saved, fresh, options.data?.outcomes ?? [])
    if (patch) sendCallPatch(saved.id, patch)
  })
  useEffect(() => {
    if (sortedNow && held.length > 0) sendHeld()
  }, [sortedNow, held])
  // The card can go before the call is sorted: the next card replaces it, or the page moves on
  // (PLAN-V24 review). What it kept and hadn't sent goes on outside it (`held.ts`), to be made once
  // the call is sorted. A page closed or reloaded first still loses it (TBC).
  const handOverHeld = useEffectEvent(() => {
    const fresh = held.slice(heldSent.current)
    heldSent.current = held.length
    if (fresh.length === 0) return
    const id = note.data?.id ?? noteId
    const call = id ?? saving.current
    if (call === null) return
    keepUntilSorted({
      client,
      note: call,
      changes: fresh,
      outcomes: options.data?.outcomes ?? [],
      sortMs: t.sort,
    })
  })
  useEffect(
    () => () => {
      handOverHeld()
    },
    [],
  )

  // --- The guard, the listening, and letting go ---------------------------------------------------
  useEffect(() => {
    const timer = window.setTimeout(() => {
      armed.current = true
    }, t.guard)
    return () => {
      window.clearTimeout(timer)
    }
  }, [t.guard])

  const tools: SendTools = {
    client,
    today,
    reopen: (again) => {
      openCard({ kind: 'draft', draft: again })
    },
    go: (to) => {
      void navigate(to)
    },
  }

  const stopListening = (): void => {
    stopListen.current?.()
    stopListen.current = null
  }

  /** Puts the focus in a box. False when the box isn't drawn. */
  const focusBox = (box: Box): boolean => {
    const target = card.current?.querySelector<HTMLElement>(`[data-box="${box}"]`)
    if (!target) return false
    const focusable = target.matches('input, textarea, button')
      ? target
      : target.querySelector<HTMLElement>('input, textarea, button')
    focusable?.focus()
    return focusable !== null
  }

  // An empty card (PLAN-V23 T4-3) starts in its first box, as soon as its boxes are drawn. So does
  // a call that needs its company: it starts where its company is found, since Enter on Send would
  // only say why the call waits (the PLAN-V24 browser check). True: the focus went there. On a
  // phone or tablet that call starts on Send, as other cards do: a phone has no Enter to waste, and
  // its own keyboard would rise over the card and the pill while the rep says the company again.
  const toFirstBox = useRef(
    request.kind === 'empty' ||
      (first.action === 'log_call' && first.company.found === null && !fingerPointer()),
  )
  const focusFirstBox = (): boolean => {
    if (!toFirstBox.current) return false
    const box = missingOf(latest.current.draft, latest.current.today)
    const focused = box !== null && focusBox(box)
    if (!box || focused) toFirstBox.current = false
    return focused
  }
  const boxesDrawn = useEffectEvent(focusFirstBox)
  useEffect(() => {
    if (whole) boxesDrawn()
  }, [whole])

  // A company picked on the card (a choice, the search list, Use, or one added; PLAN-V23 T1-6):
  // the part it was picked in goes, so the focus would fall to the page. It goes on to the next
  // box still to fill, else to Send, so the keyboard carries on from there.
  const pickedBefore = useRef(pickedKey)
  const companyPicked = useEffectEvent(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body && card.current?.contains(active))
      return
    const box = missingOf(latest.current.draft, latest.current.today)
    if (!box || !focusBox(box)) sendButton.current?.focus()
  })
  useEffect(() => {
    const before = pickedBefore.current
    pickedBefore.current = pickedKey
    if (before === null && pickedKey !== null) companyPicked()
  }, [pickedKey])

  // A call saved before its company takes the one picked as a PATCH, however it was picked, and
  // even before its save answered (PLAN-V24 T3-2, choice 21). The server sorts it then, and
  // teaches the mic the words heard. A pick it refuses goes back, with why.
  /** The company on its way to the server, so a pick goes once. */
  const picking = useRef<string | null>(null)
  const sendPick = useEffectEvent((id: string, companyKey: string) => {
    const before = unpicked.current
    // A pick from the command's own choices ("Which Sample?") teaches the mic nothing (PLAN-V23).
    const now = latest.current.draft
    const fromChoices = now.action !== 'email' && !now.company.byHand
    pickNoteCompany(id, companyKey, fromChoices ? false : undefined).then(
      (updated) => {
        client.setQueryData(queryKeys.companies.callNote(updated.id), updated)
        markCountsOld(client)
        void refreshCallNoteLists(client)
      },
      (error: unknown) => {
        picking.current = null
        const problem = toApiProblem(error)
        if (problem.status === 409 && problem.code === 'company_set') {
          // Picked already (a retry, or in Call logs): the call as the server has it now.
          readNote(id).then((fresh) => {
            client.setQueryData(queryKeys.companies.callNote(fresh.id), fresh)
            const { company_key: there, company_name: name } = fresh
            if (there === null || name === null) return
            setDraft((now) =>
              now.action === 'log_call' && now.company.found?.key !== there
                ? { ...now, company: pickCompany(now.company, { key: there, name }, 'by_hand') }
                : now,
            )
          }, toastProblem)
          return
        }
        setDraft((now) =>
          now.action === 'log_call' && before !== null ? { ...now, company: before } : now,
        )
        setSendWhy(false)
        setPickProblem([problem.title, problem.detail].filter(Boolean).join('. '))
      },
    )
  })
  useEffect(() => {
    if (!waitsForCompany || noteId === null || pickedKey === null) return
    if (picking.current === pickedKey) return
    picking.current = pickedKey
    sendPick(noteId, pickedKey)
  }, [waitsForCompany, noteId, pickedKey])

  const startSend = (now: CardDraft): void => {
    closing.current = 'send'
    stopListening()
    voice?.dispose()
    // The bar comes back as the card goes, and says it (PLAN-V24 choice 13).
    conversation?.say(SENT)
    // Kept from now: a page closed in the 5 seconds sends nothing, and the next page offers it.
    keepCardDraft(now, true)
    onClose()
    // How it went, for live voice's answer (PLAN-V28 T3-2): "Sent." only once it has. A sign-out
    // in the 5 seconds stops it quietly, and nothing went: it is said as undone.
    sending.current = new Promise<SendOutcome>((settled) => {
      startHold({
        action: now.action,
        ms: t.hold,
        stillSignedIn: () => {
          const still = signedInAs(client) === now.by
          if (!still) settled({ kind: 'undone' })
          return still
        },
        send: () => {
          void sendDraft(now, tools).then(settled, () => {
            settled(notSentOutcome(null))
          })
        },
        onUndo: () => {
          settled({ kind: 'undone' })
          openCard({ kind: 'draft', draft: now })
        },
      })
    })
  }

  /**
   * A call's box still being typed in saves when it is left (PLAN-V23 T4-2): before a send or Later,
   * the focus moves to Send, so it is saved first. The hold's 5 seconds cover the save.
   */
  const leaveCallBox = (): void => {
    const active = document.activeElement
    if (
      active instanceof HTMLElement &&
      active.closest(CALL_EDIT) &&
      active !== sendButton.current
    ) {
      sendButton.current?.focus()
    }
  }

  /**
   * Enter, a click on Send, or "send it": a choice or a box first, else the hold starts. True when
   * it started.
   */
  const trySend = (how: 'key' | 'click' | 'voice'): boolean => {
    if (closing.current) return false
    if (how === 'key' && !armed.current) return false
    stopListening()
    leaveCallBox()
    const { draft: now, ready: canSend, today: day } = latest.current
    const box = missingOf(now, day) ?? (latest.current.teammate ? 'for-whom' : null)
    if (box) {
      setChecked(true)
      // Enter with a suggestion where the send waits takes it (PLAN-V25 choice 6): "Use it (Enter)".
      const use = how === 'key' ? suggestionIn(card.current, box) : null
      if (use) {
        use.click()
        return false
      }
      // A call saved before its company never goes to HubSpot: the card says why (choice 18).
      if (box === 'company' && latest.current.note?.status === 'needs_company') setSendWhy(true)
      focusBox(box)
      return false
    }
    if (!canSend) return false
    startSend(now)
    return true
  }

  /** A draft the server hasn't got, kept in this browser: a task, an email, or a call (below). */
  const keepHere = (now: CardDraft): void => {
    keepCardDraft(now)
    toast(DRAFT_KEPT, {
      action: {
        label: OPEN,
        onClick: () => {
          openCard({ kind: 'draft', draft: now })
        },
      },
    })
  }

  /** A call put off: it waits in Call logs, under "Needs a company" while it has none. */
  const keptInCallLogs = (picked: boolean): void => {
    toast(picked ? CALL_KEPT : KEPT_NEEDS_COMPANY, {
      action: {
        label: OPEN_CALL_LOGS,
        onClick: () => {
          void navigate(CALL_LOGS_PATH)
        },
      },
    })
  }

  /**
   * Later on a call: it waits in Call logs, never only in this browser (PLAN-V24 T3-2). A save on
   * its way is waited for, and one that failed is tried once more, with the same key. Only a call
   * the server can't take stays in this browser: its save failed again, no company name was heard,
   * or "Which James?" is still to answer.
   */
  const keepCall = (now: CallDraft): void => {
    const picked = now.company.found !== null
    if (now.noteId !== null) {
      keptInCallLogs(picked)
      return
    }
    const body = picked ? noteBodyOf(now) : heardNoteBodyOf(now)
    const onItsWay = saveProblem === null ? saving.current : null
    const pending = onItsWay ?? (body ? saveCall(body) : null)
    if (!pending) {
      keepHere(now)
      return
    }
    pending.then(
      () => {
        keptInCallLogs(picked)
      },
      () => {
        keepHere(now)
      },
    )
  }

  /**
   * Cancel, or Later on a call (PLAN-V23 T4-2), and Esc on the card. A call stays in Call logs, with
   * its words and every change typed in, to send with the others in one go (`keepCall`). A task or
   * an email is kept in this browser.
   */
  const cancel = (): void => {
    if (closing.current) return
    closing.current = 'cancel'
    stopListening()
    voice?.dispose()
    leaveCallBox()
    const now = latest.current.draft
    if (now.action === 'log_call') keepCall(now)
    else keepHere(now)
    onClose()
  }

  /** Later, then Call logs: from the card's own "Open Call logs". */
  const openCallLogs = (): void => {
    cancel()
    void navigate(CALL_LOGS_PATH)
  }

  /**
   * "Yes" or "no" to a question the card asks with both (PLAN-V25 T3-2): the follow-up nudge's
   * "Add it" or "No", a subject's "Use it" or "Type it". Null: no such question, or other words.
   */
  const answerAsk = (words: string): CardTook | null => {
    const ask = card.current?.querySelector('[data-slot=ask]')
    const said = ask ? yesOrNo(words) : null
    const button = said ? ask?.querySelector<HTMLButtonElement>(`[data-ask="${said}"]`) : null
    if (!button) return null
    button.click()
    return { line: null }
  }

  /**
   * The card's question answered by voice, in the code, with no AI (T2-4): "the second one", or a
   * name from its list. While the card waits on its company, the list is the search list on
   * screen, and a name that isn't there is searched (PLAN-V24 choice 19). Null: none of these.
   */
  const answerByVoice = (words: string): CardTook | null => {
    // The one company the find asks about takes "yes" too (the PLAN-V24 browser check).
    const asksOne = said?.find.kind === 'confirm'
    const pick = pickByVoice(latest.current.draft, words, shownCompanies.current, asksOne)
    if (pick === null) return answerAsk(words)
    switch (pick.kind) {
      case 'picked': {
        // That one goes as the find's own pick, with its HubSpot line.
        const key = pick.draft.action === 'email' ? null : (pick.draft.company.found?.key ?? null)
        if (!(asksOne && key !== null && confirmFind(key))) setDraft(pick.draft)
        return { line: null }
      }
      case 'none':
        return { line: noOneHereWords(pick.words) }
      case 'which':
        return { line: PICK_ONE }
      case 'search':
        find(pick.words)
        return { line: null }
    }
  }

  /**
   * A turn of the conversation, read by the card first, with no AI (PLAN-V24 T2-3): "send it" sends
   * (or goes to a choice still to make, as Enter does), and "later" or "cancel" does what Later or
   * Cancel does. Then the card's question (T2-4), or the company said again (T3-2). Null: none of
   * these, and it goes to the command step.
   */
  const takeTurn = (words: string): CardTook | null => {
    if (closing.current) return null
    const fixed = cardWordsOf(words)
    if (fixed === 'send') {
      // In live voice, the answer waits for the real send, after the hold (PLAN-V28 T3-2).
      const started = trySend('voice')
      const outcome = started ? sending.current : null
      return outcome
        ? { line: SENT, reply: outcome.then(replyForSend), meanwhile: STILL_SENDING_REPLY }
        : { line: null, reply: unsureReply(FILL_IN_FIRST) }
    }
    if (fixed === 'later') {
      const now = latest.current.draft
      cancel()
      // Where it waits, as the card's own toast says it.
      const kept =
        now.action !== 'log_call' ? DRAFT_KEPT : now.company.found ? CALL_KEPT : KEPT_NEEDS_COMPANY
      return { line: null, reply: okReply(kept) }
    }
    const took = answerByVoice(words)
    // A pick or an answer to the card's question: it is ready again, or it asks again.
    return took ? { ...took, reply: took.line ? unsureReply(took.line) : okReply(READY) } : null
  }

  // The listening and V's answers run outside React: they call the newest of these.
  const trySendRef = useRef(trySend)
  const cancelRef = useRef(cancel)
  const takeTurnRef = useRef(takeTurn)
  useLayoutEffect(() => {
    trySendRef.current = trySend
    cancelRef.current = cancel
    takeTurnRef.current = takeTurn
  })

  // The listening for "send it", as the card opens after a spoken command, until it is over. The
  // card letting go (or React trying an effect twice while developing) stops it quietly.
  useEffect(() => {
    if (!listening) return undefined
    const stop = listenForSendIt({
      onSend: () => {
        trySendRef.current('voice')
      },
      onCancel: () => {
        cancelRef.current()
      },
      onEnd: () => {
        setListenOver(true)
      },
      tool,
      env,
      makeTool,
      ms: t.listen,
    })
    stopListen.current = stop
    return () => {
      stop(true)
    }
  }, [listening, tool, env, makeTool, t.listen])

  // V's session goes with the card.
  useEffect(
    () => () => {
      voice?.dispose()
    },
    [voice],
  )

  // Hold V on the card (PLAN-V23 choice 6): the V that started a change, held 0.4 seconds, ends it
  // as it comes up, and its repeats type nothing. The listener is there all along, and the session
  // is known at once (`voiceNow`), so a quick let-go is never missed.
  const voiceNow = useRef<BarSession | null>(null)
  const vTaken = useRef(false)
  useEffect(() => {
    const letGo = (): void => {
      if (!vTaken.current) return
      vTaken.current = false
      voiceNow.current?.vUp()
    }
    const onUp = (event: globalThis.KeyboardEvent): void => {
      if (isVKey(event)) letGo()
    }
    document.addEventListener('keyup', onUp)
    window.addEventListener('blur', letGo)
    return () => {
      document.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', letGo)
    }
  }, [])

  // --- A change by voice ----------------------------------------------------------------------------
  /**
   * A change to a call by voice: made on the server, or kept until the call is sorted (`waits`):
   * before its company is set a call takes only its outcome, and while it sorts, nothing (PLAN-V24
   * T3-2). Null: a change the card can't make.
   */
  const changeCall = (change: AssistantChange): 'made' | 'waits' | null => {
    const { note: saved, outcomes } = latest.current
    if (change.box === 'call_type') {
      // The call type shows at once (PLAN-V25 T3-1), and goes to the server as any change does.
      const type = callTypeOf(change.value)
      if (type === null) return null
      setDraft((now) => (now.action === 'log_call' ? { ...now, callType: type } : now))
    }
    if (
      saved &&
      saved.status !== 'sorting' &&
      // Before its company, a call takes its outcome and its call type only (PLAN-V24, V25).
      (saved.status !== 'needs_company' || change.box === 'outcome' || change.box === 'call_type')
    ) {
      const patch = callPatchOf(saved, change, outcomes)
      if (!patch) return null
      sendCallPatch(saved.id, patch)
      return 'made'
    }
    if (saved && callPatchOf(saved, change, outcomes) === null) return null
    setHeld((now) => [...now, change])
    return 'waits'
  }

  // --- A change typed into a call's box (PLAN-V23 T4-2) ---------------------------------------------
  // The card shows it at once, and the server is told (as on Call logs, `use-edit.ts`). Once the
  // last change on its way has answered, the note and its preview are read again, so what shows is
  // what the server holds: a change it refused goes back, and a toast says why.
  const editsOnTheirWay = useRef(0)
  const editCall: EditCall = (patch, apply) => {
    const saved = latest.current.note
    if (!saved) return
    const key = queryKeys.companies.callNote(saved.id)
    const before = client.getQueryData<CallNoteOut>(key)
    if (before) client.setQueryData(key, apply(before))
    // The read-back follows the change.
    setDraft((now) => (now.action === 'log_call' ? { ...now, edited: true } : now))
    editsOnTheirWay.current += 1
    patchNote(saved.id, patch)
      .catch((error: unknown) => {
        const detail = changeDetail(toApiProblem(error))
        toast.error(NOT_CHANGED, detail ? { description: detail } : undefined)
      })
      .finally(() => {
        editsOnTheirWay.current -= 1
        if (editsOnTheirWay.current > 0) return
        void client.invalidateQueries({ queryKey: key })
        void client.invalidateQueries({
          queryKey: queryKeys.companies.callNotePreview([saved.id]),
        })
        void refreshCallNoteLists(client)
      })
  }

  /** A call type tapped (PLAN-V25 T3-1): as "make it a follow-up call" said. */
  const changeCallType = (type: CallType): void => {
    changeCall({ box: 'call_type', value: type, day: null })
  }

  /** A call box's own Esc, where it is reached: the focus goes to Send. */
  const leaveBox = (): void => {
    sendButton.current?.focus()
  }

  const onVoiceAnswer = (heard: Heard): AfterAnswer => {
    if (heard.kind === 'dictation') {
      return { kind: 'show', line: CANT_READ_YET, unsure: null, again: false }
    }
    const { command } = heard
    switch (command.action) {
      case 'send':
        queueMicrotask(() => {
          trySendRef.current('voice')
        })
        return { kind: 'close' }
      case 'cancel':
        queueMicrotask(() => {
          cancelRef.current()
        })
        return { kind: 'close' }
      case 'change': {
        const change = command.change
        if (!change) break
        const now = latest.current.draft
        if (now.action === 'log_call') {
          const made = changeCall(change)
          if (made === 'made') return { kind: 'close' }
          if (made === 'waits') {
            return { kind: 'show', line: CHANGE_WAITS, unsure: null, again: false }
          }
          break
        }
        const next = applyChange(now, change)
        if (next) {
          setDraft(next)
          return { kind: 'close' }
        }
        break
      }
      default:
        break
    }
    // No action for this card: the code reads the words for its question, or the company said
    // again, as in a conversation (PLAN-V24 T3-2).
    const took = answerByVoice(heard.words)
    if (took) {
      return took.line === null
        ? { kind: 'close' }
        : { kind: 'show', line: took.line, unsure: null, again: true }
    }
    switch (command.action) {
      case 'log_call':
      case 'task':
      case 'email':
      case 'pre_read':
      case 'open':
        // A new command while this card is open: this one first (PLAN-V24 choice 13, TBC). Its
        // words are kept, as unclear words are (the PLAN-V24 browser check): in a conversation,
        // Type instead puts them in the bar's text line once this card is done; with V on the
        // card, they wait in its strip's text line.
        return { kind: 'unclear', words: heard.words, line: SEND_OR_KEEP }
      case 'unclear':
        // The words wait in the strip's text line, to fix or say again (PLAN-V23 T1-6).
        return unclearAnswer(command, heard.words)
      default:
        return { kind: 'show', line: CARD_CAN, unsure: command.unsure, again: true }
    }
  }

  // The conversation's answers to turns said to the card come here too (PLAN-V24 T2-3).
  const onVoiceAnswerRef = useRef(onVoiceAnswer)
  useLayoutEffect(() => {
    onVoiceAnswerRef.current = onVoiceAnswer
  })

  // While the conversation is on and the card open, it hears each turn first (PLAN-V24 T2-3).
  useEffect(() => {
    if (!conversation || !open) return undefined
    return conversation.attachCard({
      take: (words) => takeTurnRef.current(words),
      card: () => {
        const now = latest.current.draft
        return { action: now.action, boxes: [...BOXES[now.action]] }
      },
      answer: (heard) => onVoiceAnswerRef.current(heard),
    })
  }, [conversation, open])

  // The conversation, as the card's foot shows it.
  const talk = useSyncExternalStore(
    conversation?.subscribe ?? noSubscribe,
    conversation?.getSnapshot ?? idleSnapshot,
  )
  const talking =
    conversation !== null &&
    talk.conversation !== null &&
    (talk.phase === 'starting' || talk.phase === 'listening')
  // The voice bar's mic is on while the card is open: the bar shrinks to the pill beside it
  // (PLAN-V24 T5-1). Once it stopped with a line the card saw it stop with (the quiet stop, a
  // problem), the pill keeps the line, with its buttons, until the card closes. V listens again.
  const pillLive = pill !== null && micIsOn(pill.snapshot)
  const [heardTalk, setHeardTalk] = useState(false)
  if (pillLive && !heardTalk) setHeardTalk(true)
  const pillShown = pillLive || (heardTalk && pill !== null && pill.stopped !== null)

  /** V on the card, or Say it again: a change by voice. `byKey`: the V key, which may be held. */
  const speak = (byKey = false): void => {
    stopListening()
    const held = (session: BarSession): void => {
      if (!byKey) return
      vTaken.current = true
      session.vDown()
    }
    if (voice) {
      if (voice.pressV()) held(voice)
      return
    }
    const now = latest.current.draft
    const session = new BarSession({
      read,
      card: { action: now.action, boxes: [...BOXES[now.action]] },
      hand: onVoiceAnswer,
      onClose: () => {
        if (voiceNow.current === session) voiceNow.current = null
        setVoice(null)
      },
      env,
      makeTool,
      tone,
    })
    voiceNow.current = session
    setVoice(session)
    session.start(tool)
    held(session)
  }

  const snapshot = useSyncExternalStore(
    voice?.subscribe ?? noSubscribe,
    voice?.getSnapshot ?? idleSnapshot,
  )
  const voicePhase = voice ? snapshot.phase : null
  useEffect(() => {
    if (voicePhase === 'typing') changeLine.current?.focus()
  }, [voicePhase])
  const stripLine =
    snapshot.phase === 'answer'
      ? (snapshot.answer?.line ?? null)
      : (snapshot.phase === 'problem' || snapshot.problem?.kind === 'unclear') && snapshot.problem
        ? stripProblem(snapshot.problem, deviceKind((env?.browser ?? browserFacts)()))
        : null

  // --- Keys (choice 19) -------------------------------------------------------------------------------
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // Only the card's own parts: a box's mic card, a sheet of its own, keeps its keys.
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return
    // Any key stops the listening for "send it" (choice 23).
    stopListening()
    // The card's keys stay in the card. Esc is the dialog's own (`onEscape`).
    if (event.key !== 'Escape') event.stopPropagation()
    if (event.repeat && isVKey(event)) {
      // A held V's repeats type nothing, even in the box the focus went to (PLAN-V23 choice 6).
      if (vTaken.current) event.preventDefault()
      return
    }
    const typing = typingKey(event.nativeEvent)
    // The keys 1, 2 and 3 pick from the first question still open (PLAN-V25 choice 6).
    if (
      !typing &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      pickByKey(card.current, event.key)
    ) {
      event.preventDefault()
      return
    }
    if (event.key === 'Enter') {
      const withCtrl = event.ctrlKey || event.metaKey
      // In a box, Enter adds a line, or does the box's own job (Add someone).
      if (typing && !withCtrl) return
      // A choice, Cancel or another button does its own press.
      const target = event.target
      if (!withCtrl && target instanceof HTMLButtonElement && target !== sendButton.current) return
      event.preventDefault()
      trySend('key')
      return
    }
    if (
      (event.key === 'v' || event.key === 'V') &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.repeat &&
      !typing &&
      // "Use V to speak" off (PLAN-V23 T4-1): V is no key on the card either.
      isVKeyOn()
    ) {
      event.preventDefault()
      // In a conversation, V stops it, or listens again once it stopped (PLAN-V24 T2-3). On the
      // pill, which goes or changes as it does, the focus goes back to the card's Send (T5-1).
      const onPill = !(card.current?.contains(event.target) ?? false)
      if (conversation?.pressV()) {
        vTaken.current = true
        conversation.vDown()
        if (onPill) sendButton.current?.focus()
        return
      }
      // "Keep listening" on and the bar closed: V starts a conversation, which the card hears.
      if (converse && !conversation) {
        converse()
        return
      }
      speak(true)
    }
  }

  const onEscape = (event: globalThis.KeyboardEvent): void => {
    stopListening()
    if (voice) {
      // V's change stops; the card stays.
      event.preventDefault()
      voice.cancel()
      sendButton.current?.focus()
      return
    }
    const active = document.activeElement
    if (active && card.current?.contains(active) && inTextBox(active)) {
      // The first Esc leaves the box (choice 19). A call's own box saves as it is left, so it keeps
      // what was typed, as the task's and the email's boxes do: its own Esc (on Call logs, "put it
      // back") isn't reached.
      event.preventDefault()
      if (active.closest(CALL_EDIT)) event.stopPropagation()
      sendButton.current?.focus()
    }
  }

  const onFocus = (event: FocusEvent<HTMLDivElement>): void => {
    setInBox(inTextBox(event.target))
    // The company's search box: Enter finds there, and nothing can be sent before a company.
    setInFind(event.target instanceof HTMLInputElement && event.target.dataset.box === 'company')
  }

  // --- The Listening pill beside the card (PLAN-V24 T5-1) -----------------------------------------
  /** Type instead, from the pill: the rep types into the card, from its first box still to fill. */
  const toTyping = (): void => {
    const box = missingOf(latest.current.draft, latest.current.today)
    if (box && focusBox(box)) return
    const boxes = card.current?.querySelectorAll<HTMLElement>('input, textarea') ?? []
    const typed = [...boxes].find((element) => inTextBox(element))
    if (typed) typed.focus()
    else sendButton.current?.focus()
  }
  /** Stop, on the pill: the conversation ends, the pill goes, and the focus stays on the card. */
  const stopTalk = (): void => {
    sendButton.current?.focus()
    pill?.stop()
  }
  /** The pill's buttons do the bar's job, and the focus goes back to the card. */
  const pillAct = (id: PillActionId): void => {
    if (id === 'type_instead' || id === 'carry_on') toTyping()
    else sendButton.current?.focus()
    pill?.act(id)
  }
  // What to say to the card before any words: its company while it waits on one (PLAN-V24 T3-2),
  // else "send it".
  const suggested =
    draft.action !== 'email' &&
    draft.company.found === null &&
    (isSuggested(draft.company) ||
      (draft.action === 'log_call' && isPersonFirst(draft) && isSuggested(draft.person)))
  const pillHint = suggested
    ? SAY_YES
    : draft.action !== 'email' && draft.company.found === null
      ? SAY_COMPANY
      : SAY_SEND_IT

  // A call is put off, not cancelled: it waits in Call logs (PLAN-V23 T4-2).
  const putOff = draft.action === 'log_call' ? LATER : CANCEL
  // The server's lines the parts don't say themselves (PLAN-V23 T1-6: "Say it once").
  const unsure = unsureLeft(draft.unsure, cardLinesOf(draft))
  // A call saved before its company, still to pick (PLAN-V24 T3-2).
  const callWaits = draft.action === 'log_call' && waitsForCompany && draft.company.found === null

  let layout
  switch (draft.action) {
    case 'log_call':
      layout = (
        <CallLayout
          draft={draft}
          onDraft={setDraft}
          note={note.data}
          preview={notePreview.data}
          options={options.data}
          today={today}
          onOpenCallLogs={openCallLogs}
          onEdit={editCall}
          onLeaveBox={leaveBox}
          previewMs={t.preview}
          voice={companyVoice}
          onCompany={changeCallCompany}
          onCallType={changeCallType}
        />
      )
      break
    case 'task':
      layout = (
        <TaskLayout
          draft={draft}
          onDraft={setDraft}
          preview={taskPreview.data}
          mic={mic}
          today={today}
          checked={checked}
          needsTeammate={teammate}
          previewMs={t.preview}
          voice={companyVoice}
        />
      )
      break
    case 'email':
      layout = (
        <EmailLayout
          draft={draft}
          onDraft={setDraft}
          preview={emailPreview.data}
          mic={mic}
          checked={checked}
        />
      )
      break
  }

  return (
    <MicSheet
      open={open}
      opener={null}
      className={WIDTH}
      onOpenChange={(next) => {
        if (!next) cancel()
      }}
      onKeyDown={onKeyDown}
      onEscapeKeyDown={onEscape}
      onCloseAutoFocus={(event) => {
        // The conversation listens on: the bar comes back as the card goes, and takes the focus
        // for its keys (PLAN-V24 T2-6), unless another card took its place. Without one, the
        // focus goes back as before.
        const back =
          conversation?.isLive() && openedCard() === null
            ? document.querySelector<HTMLElement>(VOICE_BAR)
            : null
        if (!back) return
        event.preventDefault()
        back.focus()
      }}
      describedBy={listening || talking ? listenId : undefined}
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        // An empty card (PLAN-V23 T4-3), or a call that needs its company, starts in its first box
        // (above): nothing to send yet. Boxes drawn a moment later take the focus then.
        if (toFirstBox.current && (focusFirstBox() || toFirstBox.current)) return
        // The focus starts on Send (choice 19).
        sendButton.current?.focus()
      }}
      // The voice bar, shrunk to a pill beside the card while its mic is on (PLAN-V24 T5-1).
      aside={
        <ListeningPill
          shown={pillShown}
          state={pill}
          hint={pillHint}
          hintId={listenId}
          onStop={stopTalk}
          onAct={pillAct}
          onFocus={() => {
            setInBox(false)
            setInFind(false)
          }}
        />
      }
    >
      <div
        ref={card}
        data-slot="review-card"
        data-action={draft.action}
        className="flex min-h-0 flex-col"
        onPointerDown={stopListening}
        onFocus={onFocus}
      >
        <div className="flex flex-col gap-4 p-5">
          <MicSheetTitle data-slot="read-back" className="text-body">
            {readBackOf(draft, today, note.data)}
          </MicSheetTitle>
          {unsure && !draft.edited ? (
            <p className="text-ui text-pretty text-muted-foreground">{unsure}</p>
          ) : null}
          {whole ? (
            <>
              {layout}
              {saveProblem ? <PartProblem>{saveProblem}</PartProblem> : null}
              {previewProblem ? <PartProblem>{previewProblem}</PartProblem> : null}
              {callWaits ? (
                <>
                  {/* Why a pick wasn't taken, or why Send waits (choices 18 and 21), where a
                      screen reader hears it. With neither it takes no room. */}
                  <div
                    role="status"
                    data-slot="needs-company"
                    className="flex flex-col gap-2 empty:sr-only"
                  >
                    {pickProblem ? <PartProblem>{pickProblem}</PartProblem> : null}
                    {sendWhy ? <PartProblem>{needsCompanySendWords(1)}</PartProblem> : null}
                  </div>
                  {sendWhy ? (
                    <div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="touch:h-11"
                        onClick={openCallLogs}
                      >
                        {OPEN_CALL_LOGS}
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
        </div>
        {/* Kept in view at the card's foot while its boxes scroll: a call's boxes make the card
            taller than a phone (PLAN-V23 T4-2). */}
        <div className="sticky bottom-0 flex flex-col gap-3 border-t bg-popover px-5 py-3">
          {voice ? (
            <VoiceStrip
              ref={changeLine}
              snapshot={snapshot}
              line={stripLine}
              onTyped={(text) => {
                voice.setDraft(text)
              }}
              onSendTyped={() => {
                voice.sendTyped()
              }}
              // Unclear words wait in the strip's text line (PLAN-V23 T1-6): say them again.
              onSayAgain={
                snapshot.problem?.kind === 'unclear' && snapshot.voice
                  ? () => {
                      voice.tryAgain()
                    }
                  : undefined
              }
            />
          ) : listening ? (
            <ListenStrip id={listenId} ms={t.listen} />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {/* V's key cap is on the pill while it shows: said once (principles 03 #2). */}
            <HintBar inBox={inBox} find={inFind} escape={putOff} v={pillShown ? null : undefined} />
            <div className="ml-auto flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="touch:h-11"
                aria-keyshortcuts="Escape"
                onClick={cancel}
              >
                {putOff}
              </Button>
              <Button
                ref={sendButton}
                type="button"
                size="sm"
                className="touch:h-11 aria-disabled:opacity-50"
                aria-keyshortcuts="Enter"
                aria-disabled={ready ? undefined : true}
                onClick={() => {
                  trySend('click')
                }}
              >
                <Send aria-hidden="true" />
                {SEND}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </MicSheet>
  )
}

export default function ReviewCard(props: ReviewCardProps) {
  const { request, onClose } = props
  const client = useQueryClient()
  // The draft is made once, as the card opens.
  const [first] = useState<CardDraft | null>(() =>
    request.kind === 'draft'
      ? request.draft
      : request.kind === 'command'
        ? draftOf(request, signedInAs(client))
        : request.kind === 'empty'
          ? emptyDraftOf(request.action, signedInAs(client))
          : null,
  )
  const preRead = request.kind === 'command' && request.command.action === 'pre_read'
  // PLAN-V27 T4-2: a research to ask about, or a maybe to settle first.
  const research = request.kind === 'command' && request.command.action === 'research'
  useEffect(() => {
    if (!preRead && !research && first === null) onClose()
  }, [preRead, research, first, onClose])
  if (request.kind === 'command' && preRead) {
    return <PreReadCard command={request.command} open={props.open} onClose={onClose} />
  }
  if (request.kind === 'command' && research) {
    return (
      <ResearchCard
        command={request.command}
        source={request.source === 'mic' ? 'mic' : 'typed'}
        open={props.open}
        onClose={onClose}
        env={props.env}
        makeTool={props.makeTool}
        times={props.times}
        conversation={props.conversation ?? null}
        pill={props.pill ?? null}
      />
    )
  }
  if (first === null) return null
  return <DraftCard {...props} first={first} />
}
