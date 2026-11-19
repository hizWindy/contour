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
 *   values now from a fresh `/call-notes/preview`.
 * - **Sending** (T3-4): Enter, a click on Send or "send it" closes the card and starts the 5 second
 *   hold (`hold.tsx`), with Undo. After a spoken command, the card listens 5 seconds for "send it"
 *   or "cancel" (`listen.ts`); any key or click stops it.
 *
 * Its code loads with the voice bar's, late, never in the first visit (`host.tsx`).
 */
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { Send } from 'lucide-react'
import {
  useEffect,
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
import type { MicEnv } from '@/apps/companies/call-notes/mic/session'
import type { VoiceToolMaker } from '@/apps/companies/call-notes/mic/voice-tool'
import { problemWords } from '@/apps/companies/call-notes/mic/words'
import { MicSheet, MicSheetTitle } from '@/components/motion/mic-sheet'
import { Button } from '@/components/ui/button'
import { useDebounced } from '@/hooks/useDebounced'
import { melbourneDate } from '@/lib/format'
import { toastProblem } from '@/lib/problems'
import { PHONE, useMediaQuery } from '@/lib/use-media-query'
import { CALL_LOGS_PATH, MEETINGS_PATH } from '../paths'
import { BarSession, type BarProblem, type BarSnapshot } from '../voice/bar-session'
import { preReadPath, startPreRead, type AfterAnswer, type Heard } from '../voice/hand-over'
import { CANT_READ_YET, NOTHING_HEARD, TOO_MANY, TOO_SLOW, VOICE_NOT_SET_UP } from '../voice/words'
import {
  applyChange,
  BOXES,
  callPatchOf,
  draftOf,
  emailBodyOf,
  missingOf,
  noteBodyOf,
  readBackOf,
  taskBodyOf,
  type Box,
  type CardDraft,
} from './draft'
import { keepCardDraft } from './drafts'
import { inTextBox, typingKey } from './keys'
import { startHold } from './hold'
import { CallLayout, EmailLayout, PreReadLayout, TaskLayout } from './layouts'
import { listenForSendIt } from './listen'
import { CARD_TIMES, type CardTimes } from './times'
import { HintBar, ListenStrip, PartProblem, VoiceStrip } from './parts'
import { previewEmail, previewTask, saveNote, sendDraft, patchNote, type SendTools } from './send'
import { openCard, type CardRequest } from './store'
import {
  CALL_WAITS,
  CANCEL,
  CARD_CAN,
  DRAFT_KEPT,
  OPEN,
  OPEN_CALL_LOGS,
  SEND,
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
}

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
  }
}

/** A refusal the preview gives (a 4xx): the send would be refused too, so it waits. */
function refusal(error: unknown): string | null {
  if (!error || isAbort(error)) return null
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
            go(MEETINGS_PATH)
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
}

function DraftCard({
  request,
  open,
  onClose,
  env,
  makeTool,
  read = readCommand,
  times,
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
  // After a spoken command, the card listens for "send it" as it opens (choice 23), once the voice
  // tool setting is known and it is the speech service.
  const spoken = request.kind === 'command' && request.source === 'mic'
  const canListen = spoken && !options.isPending && tool === 'browser_service'
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

  const latest = useRef<Latest>({ draft, ready, today, note: note.data, outcomes: [] })
  useLayoutEffect(() => {
    latest.current = {
      draft,
      ready,
      today,
      note: note.data,
      outcomes: options.data?.outcomes ?? [],
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

  const focusBox = (box: Box): void => {
    const target = card.current?.querySelector<HTMLElement>(`[data-box="${box}"]`)
    if (!target) return
    const focusable = target.matches('input, textarea, button')
      ? target
      : target.querySelector<HTMLElement>('input, textarea, button')
    focusable?.focus()
  }

  const startSend = (now: CardDraft): void => {
    closing.current = 'send'
    stopListening()
    voice?.dispose()
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

  /** Enter, a click on Send, or "send it": a choice or a box first, else the hold starts. */
  const trySend = (how: 'key' | 'click' | 'voice'): void => {
    if (closing.current) return
    if (how === 'key' && !armed.current) return
    stopListening()
    const { draft: now, ready: canSend, today: day } = latest.current
    const box = missingOf(now, day)
    if (box) {
      focusBox(box)
      return
    }
    if (!canSend) return
    startSend(now)
  }

  const cancel = (): void => {
    if (closing.current) return
    closing.current = 'cancel'
    stopListening()
    voice?.dispose()
    const now = latest.current.draft
    if (now.action === 'log_call' && now.noteId !== null) {
      toast(CALL_WAITS, {
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

  // The listening and V's answers run outside React: they call the newest of these.
  const trySendRef = useRef(trySend)
  const cancelRef = useRef(cancel)
  useLayoutEffect(() => {
    trySendRef.current = trySend
    cancelRef.current = cancel
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

  const speak = (): void => {
    stopListening()
    if (voice) {
      voice.pressV()
      return
    }
    const now = latest.current.draft
    const session = new BarSession({
      read,
      card: { action: now.action, boxes: [...BOXES[now.action]] },
      hand: onVoiceAnswer,
      onClose: () => {
        setVoice(null)
      },
      env,
      makeTool,
    })
    setVoice(session)
    session.start(tool)
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
      : snapshot.phase === 'problem' && snapshot.problem
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
      !typing
    ) {
      event.preventDefault()
      speak()
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
      // The first Esc leaves the box.
      event.preventDefault()
      sendButton.current?.focus()
    }
  }

  const onFocus = (event: FocusEvent<HTMLDivElement>): void => {
    setInBox(inTextBox(event.target))
  }

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
        />
      )
      break
    case 'email':
      layout = (
        <EmailLayout draft={draft} onDraft={setDraft} preview={emailPreview.data} mic={mic} />
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
      describedBy={listening ? listenId : undefined}
      onOpenAutoFocus={(event) => {
        // The focus starts on Send (choice 19).
        event.preventDefault()
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
          {draft.unsure && !draft.edited ? (
            <p className="text-ui text-pretty text-muted-foreground">{draft.unsure}</p>
          ) : null}
          {layout}
          {saveProblem ? <PartProblem>{saveProblem}</PartProblem> : null}
          {previewProblem ? <PartProblem>{previewProblem}</PartProblem> : null}
        </div>
        <div className="flex flex-col gap-3 border-t px-5 py-3">
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
            />
          ) : listening ? (
            <ListenStrip id={listenId} ms={t.listen} />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <HintBar inBox={inBox} />
            <div className="ml-auto flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="touch:h-11"
                onClick={cancel}
              >
                {CANCEL}
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
