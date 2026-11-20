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
 * - **A call** is saved as the card opens (`POST /call-notes`, once its company is known), so the
 *   server sorts it while the rep reads. The card shows the sort when it is ready, with HubSpot's
 *   values now from a fresh `/call-notes/preview`. Each of its parts takes typing too (PLAN-V23
 *   T4-2): a box saves when it is left (`PATCH /call-notes/{id}`), and Esc leaves it, as above.
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
 *   first." (TBC). Its foot shows the mic is on ("Listening", the bars, the words, Stop (V)), and
 *   V stops the conversation. After a send, the bar comes back and says "Sent.".
 * - **V with "Keep listening" on** and the bar closed starts a conversation, which the card hears
 *   (`converse`). With it off, V speaks one change, as before.
 * - **Its question by voice** (PLAN-V24 T2-4, choice 14): while it asks "Which Sample?", "the
 *   second one" or a name from its list picks it, in the code, with no AI (`choose.ts`). A person's
 *   or a teammate's name that isn't there changes nothing, and the card says so.
 *
 * Its code loads with the voice bar's, late, never in the first visit (`host.tsx`).
 */
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { Send } from 'lucide-react'
import {
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
} from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { isAbort, toApiProblem } from '@/api/client'
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
  CallNoteOut,
} from '@/api/types'
import { NOT_CHANGED } from '@/apps/companies/call-logs/words'
import type { MicEnv } from '@/apps/companies/call-notes/mic/session'
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
import { isVKeyOn } from '../voice/v-switch'
import {
  CANT_READ_YET,
  LEFT_PAGE,
  NOTHING_HEARD,
  QUIET_STOP,
  STOP,
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
  missingOf,
  noteBodyOf,
  readBackOf,
  taskBodyOf,
  type Box,
  type CardDraft,
} from './draft'
import { pickByVoice } from './choose'
import { keepCardDraft } from './drafts'
import { inTextBox, typingKey } from './keys'
import { startHold } from './hold'
import { CallLayout, EmailLayout, PreReadLayout, TaskLayout, type EditCall } from './layouts'
import { cardLinesOf, unsureLeft } from './lines'
import { listenForSendIt } from './listen'
import { CARD_TIMES, type CardTimes } from './times'
import { ConversationStrip, HintBar, ListenStrip, PartProblem, VoiceStrip } from './parts'
import { previewEmail, previewTask, saveNote, sendDraft, patchNote, type SendTools } from './send'
import { openCard, type CardRequest } from './store'
import { isNoHubSpotUser, needsTeammate } from './teammate-rules'
import {
  CALL_KEPT,
  CANCEL,
  CARD_CAN,
  DRAFT_KEPT,
  LATER,
  noOneHereWords,
  OPEN,
  OPEN_CALL_LOGS,
  PICK_ONE,
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

/** A problem of V's strip, in the voice bar's words. */
function stripProblem(problem: BarProblem): string {
  switch (problem.kind) {
    case 'nothing_heard':
      return NOTHING_HEARD
    case 'too_many':
      return TOO_MANY
    case 'too_slow':
      return TOO_SLOW
    case 'mic':
      return problemWords(problem.problem)
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
  }
}

/** A V key, with or without Shift. */
function isVKey(event: { key: string }): boolean {
  return event.key === 'v' || event.key === 'V'
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
    >
      <div data-slot="review-card" data-action="pre_read" className="flex flex-col gap-4 p-5">
        <MicSheetTitle className="text-body">{command.read_back || WHICH_MEETING}</MicSheetTitle>
        {command.unsure ? (
          <p className="text-ui text-pretty text-muted-foreground">{command.unsure}</p>
        ) : null}
        <PreReadLayout
          meetings={command.meeting?.choices ?? []}
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
  // A box still to fill shows as one: at once for a command, which was meant to fill it; on an empty
  // card (PLAN-V23 T4-3), only once Send was tried, not before the rep has typed anything.
  const [checked, setChecked] = useState(request.kind !== 'empty')
  // The card's first render holds its frame, its read-back and its buttons; its boxes come in a
  // second one, while the card still fades in from nothing (PLAN-V23 T4-4), so the frame it
  // appears in holds less. With reduced motion the card shows at once, so it is drawn whole.
  const still = useStill()
  const whole = useDeferredValue(true, still)
  // After a spoken command, the card listens for "send it" as it opens (choice 23), once the voice
  // tool setting is known and it is the speech service. Opened while a conversation listens, it
  // hears that instead, and never opens a mic of its own (PLAN-V24 T2-3).
  const spoken = request.kind === 'command' && request.source === 'mic'
  const [inConversation] = useState(() => conversation?.isLive() === true)
  const canListen = spoken && !options.isPending && tool === 'browser_service' && !inConversation
  const [listenOver, setListenOver] = useState(false)
  const listening = canListen && !listenOver
  const [voice, setVoice] = useState<BarSession | null>(null)
  const [saveProblem, setSaveProblem] = useState<string | null>(null)
  const armed = useRef(false)
  const closing = useRef<'send' | 'cancel' | null>(null)
  const stopListen = useRef<((quietly?: boolean) => void) | null>(null)
  const card = useRef<HTMLDivElement>(null)
  const sendButton = useRef<HTMLButtonElement>(null)
  const changeLine = useRef<HTMLInputElement>(null)
  // A screen reader hears "Say 'send it' or press Enter" with the read-back as the card opens.
  const listenId = useId()

  // --- A call: saved once its company is known, then read until sorted, then previewed ---------
  const noteBody = draft.action === 'log_call' && draft.noteId === null ? noteBodyOf(draft) : null
  const noteAsk = noteBody ? JSON.stringify(noteBody) : null
  const { key } = draft
  useEffect(() => {
    if (noteAsk === null) return undefined
    let live = true
    saveNote(JSON.parse(noteAsk) as Parameters<typeof saveNote>[0], key).then(
      (note) => {
        client.setQueryData(queryKeys.companies.callNote(note.id), note)
        markCountsOld(client)
        void refreshCallNoteLists(client)
        if (!live) return
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
  }, [noteAsk, key, client])

  const noteId = draft.action === 'log_call' ? draft.noteId : null
  const note = useQuery({
    ...callNoteQueryOptions(noteId ?? ''),
    enabled: noteId !== null,
    refetchInterval: (query) => (query.state.data?.status === 'sorting' ? t.sort : false),
  })
  const sortedId = note.data && note.data.status !== 'sorting' ? note.data.id : null
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
  })

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

  // An empty card (PLAN-V23 T4-3) starts in its first box, as soon as its boxes are drawn.
  const toFirstBox = useRef(request.kind === 'empty')
  const focusFirstBox = (): void => {
    if (!toFirstBox.current) return
    const box = missingOf(latest.current.draft, latest.current.today)
    if (!box || focusBox(box)) toFirstBox.current = false
  }
  const boxesDrawn = useEffectEvent(focusFirstBox)
  useEffect(() => {
    if (whole) boxesDrawn()
  }, [whole])

  // A company picked on the card (a choice, the search list, Use, or one added; PLAN-V23 T1-6):
  // the part it was picked in goes, so the focus would fall to the page. It goes on to the next
  // box still to fill, else to Send, so the keyboard carries on from there.
  const pickedKey = draft.action === 'email' ? null : (draft.company.found?.key ?? null)
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

  const startSend = (now: CardDraft): void => {
    closing.current = 'send'
    stopListening()
    voice?.dispose()
    // The bar comes back as the card goes, and says it (PLAN-V24 choice 13).
    conversation?.say(SENT)
    // Kept from now: a page closed in the 5 seconds sends nothing, and the next page offers it.
    keepCardDraft(now, true)
    onClose()
    startHold({
      action: now.action,
      ms: t.hold,
      stillSignedIn: () => signedInAs(client) === now.by,
      send: () => {
        void sendDraft(now, tools)
      },
      onUndo: () => {
        openCard({ kind: 'draft', draft: now })
      },
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
      focusBox(box)
      return false
    }
    if (!canSend) return false
    startSend(now)
    return true
  }

  /**
   * Cancel, or Later on a call (PLAN-V23 T4-2), and Esc on the card. A call that is saved stays in
   * Call logs' To confirm, with its words and every change typed in, to send with the others in one
   * go. A call not saved yet (no company picked) and any other draft are kept in this browser.
   */
  const cancel = (): void => {
    if (closing.current) return
    closing.current = 'cancel'
    stopListening()
    voice?.dispose()
    leaveCallBox()
    const now = latest.current.draft
    if (now.action === 'log_call' && now.noteId !== null) {
      toast(CALL_KEPT, {
        action: {
          label: OPEN_CALL_LOGS,
          onClick: () => {
            void navigate(CALL_LOGS_PATH)
          },
        },
      })
    } else {
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
    onClose()
  }

  /**
   * A turn of the conversation, read by the card first, with no AI (PLAN-V24 T2-3): "send it" sends
   * (or goes to a choice still to make, as Enter does), and "later" or "cancel" does what Later or
   * Cancel does. Then the card's question (T2-4): "the second one", or a name from its list. Null:
   * none of these, and it goes to the command step.
   */
  const takeTurn = (words: string): CardTook | null => {
    if (closing.current) return null
    const fixed = cardWordsOf(words)
    if (fixed === 'send') return { line: trySend('voice') ? SENT : null }
    if (fixed === 'later') {
      cancel()
      return { line: null }
    }
    const pick = pickByVoice(latest.current.draft, words)
    if (pick?.kind === 'picked') {
      setDraft(pick.draft)
      return { line: null }
    }
    if (pick?.kind === 'none') return { line: noOneHereWords(pick.words) }
    if (pick?.kind === 'which') return { line: PICK_ONE }
    return null
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
      env,
      makeTool,
      ms: t.listen,
    })
    stopListen.current = stop
    return () => {
      stop(true)
    }
  }, [listening, env, makeTool, t.listen])

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
  const changeCall = (change: AssistantChange): boolean => {
    const { note: saved, outcomes } = latest.current
    if (!saved) return false
    const patch = callPatchOf(saved, change, outcomes)
    if (!patch) return false
    patchNote(saved.id, patch).then((updated) => {
      client.setQueryData(queryKeys.companies.callNote(updated.id), updated)
      // The read-back follows the change.
      setDraft((now) => (now.action === 'log_call' ? { ...now, edited: true } : now))
      void client.invalidateQueries({
        queryKey: queryKeys.companies.callNotePreview([updated.id]),
      })
    }, toastProblem)
    return true
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
      case 'log_call':
      case 'task':
      case 'email':
      case 'pre_read':
      case 'open':
        // A new command while this card is open: this one first (PLAN-V24 choice 13, TBC).
        return { kind: 'show', line: SEND_OR_KEEP, unsure: null, again: false }
      case 'unclear':
        // The words wait in the strip's text line, to fix or say again (PLAN-V23 T1-6).
        return unclearAnswer(command, heard.words)
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
          if (changeCall(change)) return { kind: 'close' }
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
    return { kind: 'show', line: CARD_CAN, unsure: command.unsure, again: true }
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
  // It stopped with a line while the card heard it: the quiet stop, or a problem. V listens again.
  const [heardTalk, setHeardTalk] = useState(false)
  if (talking && !heardTalk) setHeardTalk(true)
  const talkEnded =
    heardTalk && conversation !== null && talk.phase === 'problem' && talk.problem
      ? stripProblem(talk.problem)
      : null

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
        ? stripProblem(snapshot.problem)
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
      // In a conversation, V stops it, or listens again once it stopped (PLAN-V24 T2-3).
      if (conversation?.pressV()) {
        vTaken.current = true
        conversation.vDown()
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
  }

  // A call is put off, not cancelled: it waits in Call logs (PLAN-V23 T4-2).
  const putOff = draft.action === 'log_call' ? LATER : CANCEL
  // The server's lines the parts don't say themselves (PLAN-V23 T1-6: "Say it once").
  const unsure = unsureLeft(draft.unsure, cardLinesOf(draft))

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
          onOpenCallLogs={() => {
            cancel()
            void navigate(CALL_LOGS_PATH)
          }}
          onEdit={editCall}
          onLeaveBox={leaveBox}
          previewMs={t.preview}
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
      describedBy={listening || talking ? listenId : undefined}
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        // An empty card (PLAN-V23 T4-3) starts in its first box (above): nothing to send yet.
        if (toFirstBox.current) {
          focusFirstBox()
          return
        }
        // The focus starts on Send (choice 19).
        sendButton.current?.focus()
      }}
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
            </>
          ) : null}
        </div>
        {/* Kept in view at the card's foot while its boxes scroll: a call's boxes make the card
            taller than a phone (PLAN-V23 T4-2). */}
        <div className="sticky bottom-0 flex flex-col gap-3 border-t bg-popover px-5 py-3">
          {talking || talkEnded ? (
            <ConversationStrip
              snapshot={talk}
              hintId={listenId}
              ended={talkEnded}
              onStop={() => {
                conversation?.done()
              }}
            />
          ) : voice ? (
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
            <HintBar inBox={inBox} escape={putOff} v={talking ? STOP : undefined} />
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
  useEffect(() => {
    if (!preRead && first === null) onClose()
  }, [preRead, first, onClose])
  if (request.kind === 'command' && preRead) {
    return <PreReadCard command={request.command} open={props.open} onClose={onClose} />
  }
  if (first === null) return null
  return <DraftCard {...props} first={first} />
}
