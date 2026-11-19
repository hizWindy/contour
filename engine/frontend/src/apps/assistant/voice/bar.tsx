/**
 * The voice bar (PLAN-V22 T3-1 and T3-2, "How it should look and move"): V on any page, or
 * "Speak (V)" in the top bar, and it rises from the bottom and listens. It holds the live bars, the
 * word "Listening", the words as they come, and the keys on its buttons. When the talk is over it
 * keeps the words and says "Working it out" (nothing spins), then hands the command step's answer
 * on (`hand-over.ts`).
 *
 * - **Keys:** V again is Done (the words are kept), Esc is Cancel (thrown away), on any page part
 *   but a box. In the text line, V types a "v" and Enter sends.
 * - **Moves:** it rises on `smooth` and leaves in 150ms, and the page behind stays as it is. With
 *   reduced motion it simply appears and goes.
 * - **A screen reader** hears where it stands once ("Listening", "Working it out"), and never each
 *   word. The focus goes to the bar as it opens (the text line, when typing), and back where it was
 *   as it closes.
 * - **Not a dialog that holds the page:** the page behind still works, so a rep can read it while
 *   speaking. The bar is a dialog only for the keys: other keys of the page wait while it is open.
 *
 * Its code loads late (`key.tsx`), so the first visit doesn't carry it. The review card a command
 * opens (`card/`) sits beside it and comes with it.
 */
import { CircleAlert, RotateCcw } from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router'
import { readCommand } from '@/api/hooks/assistant'
import { useCallNoteOptions, voiceToolOf } from '@/api/hooks/call-note-counts'
import type { SignIn } from '@/api/hooks/auth'
import { queryKeys } from '@/api/query'
import type { AssistantCommand, AssistantCommandIn, CallNoteOptions } from '@/api/types'
import { LiveWords } from '@/apps/companies/call-notes/mic/live-words'
import type { MicEnv } from '@/apps/companies/call-notes/mic/session'
import type { VoiceToolMaker } from '@/apps/companies/call-notes/mic/voice-tool'
import {
  fixedWords,
  problemActions,
  problemWords,
  STEP_WORDS,
  type MicAction,
} from '@/apps/companies/call-notes/mic/words'
import { canWrite, useIsViewer } from '@/auth/can'
import { FrequencyBars } from '@/components/motion/frequency-bars'
import { INSTANT, springs } from '@/components/motion/springs'
import { useStill } from '@/components/motion/use-still'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { isTyping } from '@/lib/is-typing'
import { useBarRoom } from '@/lib/use-bar-room'
import { CardHost } from '../card/host'
import { openCard } from '../card/store'
import { BarSession, MAX_CHARS, type BarProblem, type BarSnapshot, type Times } from './bar-session'
import { handOver } from './hand-over'
import { isPlainV, somethingElseOpen, VOICE_BAR } from './keys'
import { namesOnPage } from './names'
import { onPageOf, panelCompany } from './on-page'
import { onScreen } from './on-screen'
import { closeVoiceBar, useVoiceBarOpen } from './store'
import { useVKeyOn } from './v-switch'
import {
  CANCEL,
  CARRY_ON,
  CLOSE,
  DONE,
  LISTENING,
  NOTHING_HEARD,
  NOTHING_HEARD_TOUCH,
  SAY_EXAMPLES,
  SEND,
  TOO_MANY,
  TOO_SLOW,
  TRY_AGAIN,
  TRY_SAYING,
  TYPE_EXAMPLE,
  TYPE_INSTEAD,
  TYPE_WHAT,
  VOICE_BAR_NAME,
  VOICE_NOT_SET_UP,
  WORKING,
} from './words'

/** How far the bar rises as it comes, in px. */
const RISE = 24

/** Before the first word: what a rep can say, one example for each card action. */
function SayExamples() {
  return (
    <div
      data-slot="voice-examples"
      className="flex flex-col gap-1 text-caption text-muted-foreground"
    >
      <p>{TRY_SAYING}</p>
      <ul className="flex flex-col gap-0.5">
        {SAY_EXAMPLES.map((line) => (
          <li key={line}>“{line}”</li>
        ))}
      </ul>
    </div>
  )
}

const CLOSED: BarSnapshot = {
  phase: 'starting',
  mic: null,
  words: '',
  draft: '',
  problem: null,
  answer: null,
  voice: true,
  fixes: [],
}

/** A rep who may log a call now: the Call logs tick, not a Viewer, and call notes on. */
function canLogCalls(client: QueryClient): boolean {
  const options = client.getQueryData<CallNoteOptions>(queryKeys.companies.callNoteOptions())
  return (
    options?.enabled === true &&
    canWrite(client.getQueryData<SignIn>(queryKeys.auth.me()), 'companies.call_logs')
  )
}

const noSubscribe = (): (() => void) => () => undefined
const closedSnapshot = (): BarSnapshot => CLOSED

export interface VoiceBarProps {
  /** For tests: the browser, the voice tool, the command step and the waits. */
  env?: MicEnv
  makeTool?: VoiceToolMaker | null
  read?: (body: AssistantCommandIn, signal: AbortSignal) => Promise<AssistantCommand>
  times?: Partial<Times>
}

/** The line at the top: where the bar stands. */
function titleOf(snapshot: BarSnapshot): string {
  switch (snapshot.phase) {
    case 'starting': {
      // The mic check's own words while the mic opens. On first use the browser asks first.
      const steps = snapshot.mic?.steps
      return steps?.found === 'pass' ? STEP_WORDS.allowed.waiting : STEP_WORDS.found.waiting
    }
    case 'listening':
      return LISTENING
    case 'working':
      return WORKING
    case 'typing':
      return TYPE_WHAT
    case 'problem':
    case 'answer':
      return VOICE_BAR_NAME
  }
}

/** A problem's sentence. */
function problemLine(problem: BarProblem): string {
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
      return problem.detail ? `${problem.title}. ${problem.detail}` : problem.title
  }
}

/** A line that says why there is no mic, without alarm: it isn't a failure of the moment. */
function isQuiet(problem: BarProblem): boolean {
  return (
    problem.kind === 'no_voice' || (problem.kind === 'mic' && problem.problem === 'no_speech_tool')
  )
}

type BarAction = 'try_again' | 'type_instead' | 'carry_on'

const ACTION_LABELS: Readonly<Record<BarAction, string>> = {
  try_again: TRY_AGAIN,
  type_instead: TYPE_INSTEAD,
  carry_on: CARRY_ON,
}

/** The mic's own buttons (PLAN-V18's table), as the bar has them: no mic picker here. */
function micActions(actions: readonly MicAction[]): BarAction[] {
  return actions.flatMap((action): BarAction[] =>
    action === 'pick_mic' ? [] : action === 'carry_on' ? ['carry_on'] : [action],
  )
}

/** The buttons for where the bar stands, the main one first. */
function actionsOf(snapshot: BarSnapshot): BarAction[] {
  const { phase, problem, answer } = snapshot
  if (phase === 'answer') return answer?.again ? ['try_again'] : []
  if (!problem) return []
  if (phase === 'typing') {
    // The text line is there already: only a way back to the mic, where one helps.
    return problem.kind === 'mic' && problemActions(problem.problem, false).includes('try_again')
      ? ['try_again']
      : []
  }
  switch (problem.kind) {
    case 'nothing_heard':
    case 'too_slow':
      return ['try_again', 'type_instead']
    case 'too_many':
    case 'no_voice':
      return []
    case 'other':
      return problem.resend ? ['try_again', 'type_instead'] : ['type_instead']
    case 'mic': {
      const actions = micActions(problemActions(problem.problem, true))
      // Typing always works: the words said so far can go in the text line.
      return actions.includes('type_instead') || actions.includes('carry_on')
        ? actions
        : [...actions, 'type_instead']
    }
  }
}

/** What a screen reader hears once, as the bar moves on. */
function statusOf(snapshot: BarSnapshot): string {
  if (snapshot.phase === 'answer') return snapshot.answer?.line ?? ''
  if (snapshot.phase === 'problem') return ''
  return titleOf(snapshot)
}

function KeyHint({ children }: { children: ReactNode }) {
  return (
    <Kbd aria-hidden="true" className="touch:hidden">
      {children}
    </Kbd>
  )
}

export default function VoiceBar({ env, makeTool, read = readCommand, times }: VoiceBarProps) {
  // Never for a Viewer (choice 18), whatever asked for it: V and "Speak (V)" don't either.
  const viewer = useIsViewer()
  const asked = useVoiceBarOpen()
  const open = asked && !viewer
  const options = useCallNoteOptions()

  const navigate = useNavigate()
  const location = useLocation()
  const client = useQueryClient()
  const still = useStill()
  // "Use V to speak" off (PLAN-V23 T4-1): V is no key here either, so no key cap says it is.
  const vOn = useVKeyOn()

  // A new session each time the bar opens, with what is on screen as it opens.
  const [opened, setOpened] = useState(false)
  const [session, setSession] = useState<BarSession | null>(null)
  if (open !== opened) {
    setOpened(open)
    if (open) {
      // Call prep's company while its panel is open (PLAN-V23 T4-1), then a row the page says is
      // on screen (Today's active row, choice 8), else the address.
      const panel = panelCompany()
      const row = panel ? null : onScreen()
      const onPage = panel
        ? { company_key: panel }
        : (row?.onPage ?? onPageOf(location.pathname, location.search))
      setSession(
        new BarSession({
          onPage,
          names: row ? row.names : namesOnPage(client, onPage),
          read,
          hand: (heard) =>
            handOver(heard, {
              go: (to) => {
                void navigate(to)
              },
              // With the AI off, the words open Log call for a rep who logs calls (choice 17).
              // Read as the answer comes: the switches may load after the bar opened.
              dictate: (words, source) => {
                if (!canLogCalls(client)) return false
                openCard({ kind: 'dictation', words, source })
                return true
              },
            }),
          onClose: closeVoiceBar,
          env,
          makeTool,
          times,
        }),
      )
    }
  }

  // It starts once the voice tool setting is known, and lets everything go when the bar closes.
  const toolKnown = !options.isPending
  const begin = useEffectEvent((current: BarSession) => {
    current.start(voiceToolOf(options.data))
  })
  useEffect(() => {
    if (!open || !session || !toolKnown) return undefined
    begin(session)
    return () => {
      session.dispose()
    }
  }, [open, session, toolKnown])

  const snapshot = useSyncExternalStore(
    session?.subscribe ?? noSubscribe,
    session?.getSnapshot ?? closedSnapshot,
  )
  const { phase } = snapshot

  // The bar's own keys, while it is open: V is Done (or listens again), Esc is Cancel.
  useEffect(() => {
    if (!open || !session) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      const inBar = event.target instanceof Element && event.target.closest(VOICE_BAR) !== null
      if (event.key === 'Escape') {
        // A box on the page keeps its own Esc, and so does another dialog or menu.
        if (somethingElseOpen() || (isTyping(event) && !inBar)) return
        event.preventDefault()
        session.cancel()
        return
      }
      if (isPlainV(event) && session.pressV()) event.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [open, session])

  // The focus: into the bar as it opens (the text line, when typing), and back as it closes.
  const returnTo = useRef<HTMLElement | null>(null)
  const whyId = useId()
  const bar = useRef<HTMLDivElement | null>(null)
  const line = useRef<HTMLInputElement | null>(null)
  const room = useBarRoom(open)
  const setBar = useCallback(
    (element: HTMLDivElement | null) => {
      bar.current = element
      room(element)
    },
    [room],
  )
  useLayoutEffect(() => {
    if (open) {
      const active = document.activeElement
      returnTo.current = active instanceof HTMLElement && active !== document.body ? active : null
      bar.current?.focus()
      return
    }
    const back = returnTo.current
    returnTo.current = null
    if (back?.isConnected) back.focus()
  }, [open])
  useEffect(() => {
    if (open && phase === 'typing') line.current?.focus()
    // Out of the text line (sent, or back to the mic): the bar keeps the focus for its keys.
    else if (open && document.activeElement === document.body) bar.current?.focus()
  }, [open, phase])

  const title = titleOf(snapshot)
  const listening = phase === 'starting' || phase === 'listening'
  const actions = actionsOf(snapshot)
  // One Navy button: Done while listening, Send in the text line, else the first action.
  const [first, ...rest] = actions
  const main = phase === 'typing' ? undefined : first
  const others = phase === 'typing' ? actions : rest
  const problem = snapshot.problem
  // A name the mic heard nearly right, and put right: said once, under the words.
  const fixes = listening ? (snapshot.mic?.fixes ?? []) : snapshot.fixes
  const act = (action: BarAction): void => {
    if (!session) return
    if (action === 'try_again') session.tryAgain()
    else session.typeInstead()
  }

  return (
    <>
      <AnimatePresence>
        {open ? (
          <m.div
            key="voice-bar"
            ref={setBar}
            // Above call prep's panel (a later layer at z-50), which V works over (PLAN-V23 T4-1).
            role="dialog"
            aria-label={VOICE_BAR_NAME}
            data-slot="voice-bar"
            data-phase={phase}
            tabIndex={-1}
            className="fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-60 mx-auto flex w-[min(40rem,calc(100vw-2rem))] flex-col gap-3 rounded-lg border bg-popover p-4 text-ui text-popover-foreground shadow-float outline-none"
            initial={still ? false : { opacity: 0, y: RISE }}
            animate={{ opacity: 1, y: 0, transition: still ? INSTANT : springs.smooth }}
            exit={{ opacity: 0, y: RISE / 2, transition: still ? INSTANT : springs.exit }}
          >
            <p role="status" className="sr-only">
              {statusOf(snapshot)}
            </p>

            <div className="flex min-h-6 items-center gap-3">
              <p
                data-slot="voice-title"
                className="min-w-0 flex-1 truncate font-semibold text-foreground"
              >
                {title}
              </p>
              {listening ? (
                // With reduced motion: one still bar beside the word above.
                <FrequencyBars source={snapshot.mic?.bars ?? null} label="" className="h-6" />
              ) : null}
            </div>

            {phase === 'typing' ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  session?.sendTyped()
                }}
              >
                <Input
                  ref={line}
                  className="touch:text-body"
                  // Why the voice can't work here, read with the line.
                  aria-describedby={problem && isQuiet(problem) ? whyId : undefined}
                  value={snapshot.draft}
                  maxLength={MAX_CHARS}
                  aria-label={TYPE_WHAT}
                  placeholder={TYPE_EXAMPLE}
                  autoComplete="off"
                  onChange={(event) => {
                    session?.setDraft(event.target.value)
                  }}
                />
                <Button
                  type="submit"
                  size="sm"
                  className="touch:h-11"
                  aria-keyshortcuts="Enter"
                  disabled={snapshot.draft.trim() === ''}
                >
                  {SEND}
                  <KeyHint>Enter</KeyHint>
                </Button>
              </form>
            ) : phase === 'answer' ? (
              <div data-slot="voice-answer" className="flex flex-col gap-1">
                <p className="text-body text-pretty text-foreground">{snapshot.answer?.line}</p>
                {snapshot.answer?.unsure ? (
                  <p className="text-pretty text-muted-foreground">{snapshot.answer.unsure}</p>
                ) : null}
              </div>
            ) : (
              <div
                data-slot="voice-words"
                className="max-h-32 min-h-12 overflow-y-auto text-body text-foreground"
              >
                {listening ? (
                  <LiveWords
                    chunks={snapshot.mic?.chunks ?? []}
                    hearing={snapshot.mic?.hearing ?? ''}
                    empty={<SayExamples />}
                  />
                ) : snapshot.words ? (
                  <p className="text-pretty">{snapshot.words}</p>
                ) : null}
              </div>
            )}

            {fixes.length > 0 && phase !== 'answer' ? (
              <p data-slot="voice-fixes" className="text-caption text-muted-foreground">
                {fixedWords(fixes)}
              </p>
            ) : null}

            {problem ? (
              isQuiet(problem) ? (
                <p
                  id={whyId}
                  data-slot="voice-problem"
                  className="text-pretty text-muted-foreground"
                >
                  {problemLine(problem)}
                </p>
              ) : (
                <p
                  role="alert"
                  data-slot="voice-problem"
                  className="flex items-start gap-2 text-pretty text-destructive-ink"
                >
                  <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  {problem.kind === 'nothing_heard' ? (
                    vOn ? (
                      <span>
                        <span className="touch:hidden">{NOTHING_HEARD}</span>
                        <span className="hidden touch:inline">{NOTHING_HEARD_TOUCH}</span>
                      </span>
                    ) : (
                      // With V off, the words name the button, as on a touch screen.
                      <span>{NOTHING_HEARD_TOUCH}</span>
                    )
                  ) : (
                    <span>{problemLine(problem)}</span>
                  )}
                </p>
              )
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {listening ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-ml-2 touch:h-11"
                  onClick={() => {
                    session?.typeInstead()
                  }}
                >
                  {TYPE_INSTEAD}
                </Button>
              ) : null}
              {others.map((action) => (
                <Button
                  key={action}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="touch:h-11"
                  onClick={() => {
                    act(action)
                  }}
                >
                  {ACTION_LABELS[action]}
                </Button>
              ))}
              <div className="ml-auto flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="touch:h-11"
                  aria-keyshortcuts="Escape"
                  onClick={() => {
                    session?.cancel()
                  }}
                >
                  {phase === 'problem' || phase === 'answer' ? CLOSE : CANCEL}
                  <KeyHint>Esc</KeyHint>
                </Button>
                {listening ? (
                  <Button
                    type="button"
                    size="sm"
                    className="touch:h-11"
                    aria-keyshortcuts={vOn ? 'V' : undefined}
                    onClick={() => {
                      session?.done()
                    }}
                  >
                    {DONE}
                    {vOn ? <KeyHint>V</KeyHint> : null}
                  </Button>
                ) : main ? (
                  <Button
                    type="button"
                    size="sm"
                    className="touch:h-11"
                    onClick={() => {
                      act(main)
                    }}
                  >
                    {main === 'try_again' ? <RotateCcw aria-hidden="true" /> : null}
                    {ACTION_LABELS[main]}
                  </Button>
                ) : null}
              </div>
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>
      {/* The review card a command opens, after the bar closes (T3-3). */}
      <CardHost env={env} makeTool={makeTool} read={read} />
    </>
  )
}
