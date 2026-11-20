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
 *
 * PLAN-V23 Part 1:
 *
 * - **The hint list** (T1-5) loads with the bar's code (after the page is idle, or on the first
 *   V), for the company on screen, and is kept 5 minutes. The name fix uses it on every page, with
 *   the names on screen first; the speech service gets it in on-device mode only.
 * - **Hold V** (choice 6): a tap works as before; V still down after 0.4 seconds is a hold, and
 *   letting go ends the talk. A held key's repeats type nothing.
 * - **Unclear words** (T1-6) stop here, before any card: the stop line, the words in the text line
 *   (Enter sends them), and "Say it again".
 * - **"Try saying"** (T4-3) names the first company of the hint list, or Acme until it is in.
 *
 * PLAN-V24 Part 2, **a long conversation** (while "Keep listening" is on, `keep-listening.ts`):
 *
 * - **One V, many commands.** The bar listens on after each command: "Working it out" while a
 *   command is read, its line once it is answered, and the next words as they come. A page a
 *   command opens opens under it, and what is on screen is read again for each command.
 * - **Stop (V)** is its main button: the command in progress goes, then it stops listening. Esc
 *   throws that command away and closes the bar, as before. "That's all" stops it too, and 2
 *   minutes of quiet stops it with Start again (V).
 * - **Words over 2,000 characters** wait in the text line, with the plan's line, to shorten.
 * - **On a phone** (T2-5), the screen stays on while it listens; leaving the page stops it, with
 *   "The mic stopped when you left the page. What you said so far is kept." and Carry on.
 * - **The mic's own lines** (PLAN-V24 T1-2, T1-3), plainly until Part 5 polishes them (T5-1): the
 *   title says "Reconnecting" while the speech service is tried again, and "Now using {mic}." shows
 *   once under the words when the mic moved, said once to a screen reader.
 * - **A review card** a command opens hears the conversation (T2-3): the bar gives way to it while
 *   it is open, and the card's foot says the mic is on, with Stop (V). The bar comes back as it
 *   closes, still listening. V on a card with the bar closed starts a conversation.
 *
 * PLAN-V24 T5-1, **listening you can see** (choices 29 to 31):
 *
 * - **A soft tone** as listening starts and as it stops (`tone.ts`), through the session.
 *
 * PLAN-V24 T4-3, **every device** (choices 22 and 25):
 *
 * - **The model's download** shows in the bar as it opens, where the model is the engine and this
 *   browser doesn't keep its files yet: "Getting voice ready on this phone", "Only this once.",
 *   and the bar fills with the megabytes. Type instead skips it; Esc or V closes the bar. Either
 *   way, a download that started goes on quietly, so the next Speak is ready.
 * - **On a laptop that needs the model**, it downloads once the page is idle, so the first Speak
 *   needn't wait. Only once the setting is known and isn't typing, and never on a phone or a
 *   tablet, where it waits for Speak or "Get voice ready" in the profile menu.
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
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router'
import { readCommand } from '@/api/hooks/assistant'
import { namesQueryOptions } from '@/api/hooks/assistant-names'
import { useCallNoteOptions } from '@/api/hooks/call-note-counts'
import type { SignIn } from '@/api/hooks/auth'
import { queryKeys } from '@/api/query'
import type { AssistantCommand, AssistantCommandIn, CallNoteOptions } from '@/api/types'
import { LiveWords } from '@/apps/companies/call-notes/mic/live-words'
import type { MicEnv, Preparing } from '@/apps/companies/call-notes/mic/session'
import { browserFacts, deviceKind, pickEngine } from '@/apps/companies/call-notes/mic/voice-engine'
import { DEVICE_MODEL } from '@/apps/companies/call-notes/mic/voice-ready'
import type { VoiceToolMaker } from '@/apps/companies/call-notes/mic/voice-tool'
import {
  downloadedOf,
  fixedWords,
  GETTING_VOICE_READY,
  gettingVoiceReadyOn,
  nowUsing,
  ONLY_ONCE,
  problemActions,
  problemWords,
  RECONNECTING,
  STEP_WORDS,
  VOICE_DOWNLOAD,
  type MicAction,
} from '@/apps/companies/call-notes/mic/words'
import { canWrite, useIsViewer } from '@/auth/can'
import { FrequencyBars } from '@/components/motion/frequency-bars'
import { INSTANT, springs } from '@/components/motion/springs'
import { useStill } from '@/components/motion/use-still'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Progress } from '@/components/ui/progress'
import { whenIdle } from '@/lib/idle'
import { isTyping } from '@/lib/is-typing'
import { useBarRoom } from '@/lib/use-bar-room'
import { CardHost } from '../card/host'
import { cardShownOf, openCard, openedCard, useOpenCard } from '../card/store'
import { BarSession, MAX_CHARS, type BarProblem, type BarSnapshot, type Times } from './bar-session'
import { handOver } from './hand-over'
import { isKeepListeningOn, useKeepListening } from './keep-listening'
import { isPlainV, somethingElseOpen, VOICE_BAR } from './keys'
import { cachedNames, firstCompanyOf, fixNamesOf, hintsOf, namesOnPage } from './names'
import { onPageOf, panelCompany } from './on-page'
import { onScreen } from './on-screen'
import { closeVoiceBar, isVHeld, letGoV, openVoiceBarByKey, useVoiceBarOpen } from './store'
import { playTone, type Tone } from './tone'
import { useVKeyOn } from './v-switch'
import {
  CANCEL,
  CARRY_ON,
  CLOSE,
  DONE,
  LEFT_PAGE,
  LISTENING,
  NEXT_COMMAND,
  NOTHING_HEARD,
  NOTHING_HEARD_TOUCH,
  QUIET_STOP,
  sayExamples,
  SAY_IT_AGAIN,
  SEND,
  START_AGAIN,
  STOP,
  TOO_LONG,
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

/**
 * Before the first word: what a rep can say, one example for each card action, with the rep's own
 * next company (PLAN-V23 T4-3), or Acme until the hint list is in.
 */
function SayExamples({ company }: { company: string | null }) {
  return (
    <div
      data-slot="voice-examples"
      className="flex flex-col gap-1 text-caption text-muted-foreground"
    >
      <p>{TRY_SAYING}</p>
      <ul className="flex flex-col gap-0.5">
        {sayExamples(company ?? undefined).map((line) => (
          <li key={line}>“{line}”</li>
        ))}
      </ul>
    </div>
  )
}

/** A V key, with or without Shift. */
function isVKey(event: KeyboardEvent): boolean {
  return event.key === 'v' || event.key === 'V'
}

/** What is on screen as the bar opens: its company, for the hint list, and its names. */
interface Screen {
  key: string | null
  names: readonly string[]
}

const NO_SCREEN: Screen = { key: null, names: [] }

const CLOSED: BarSnapshot = {
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
  /** For tests: the tone as listening starts and stops (PLAN-V24 T5-1). Left out: the real one. */
  tone?: Tone
}

/** The model's download, while it downloads (PLAN-V24 T4-3): not while it only loads. */
function downloadOf(snapshot: BarSnapshot): Preparing | null {
  const preparing = snapshot.mic?.preparing ?? null
  return preparing && preparing.total > 0 ? preparing : null
}

/** The line at the top: where the bar stands. */
function titleOf(snapshot: BarSnapshot): string {
  switch (snapshot.phase) {
    case 'starting': {
      // The model on the device gets ready first, where it is the engine (PLAN-V24 T4-3).
      const preparing = snapshot.mic?.preparing
      if (preparing) {
        return preparing.total > 0 ? gettingVoiceReadyOn(preparing.device) : GETTING_VOICE_READY
      }
      // The mic check's own words while the mic opens. On first use the browser asks first.
      const steps = snapshot.mic?.steps
      return steps?.found === 'pass' ? STEP_WORDS.allowed.waiting : STEP_WORDS.found.waiting
    }
    case 'listening':
      // The speech service is tried again after a blip (PLAN-V24 T1-3).
      if (snapshot.mic?.reconnecting) return RECONNECTING
      // A conversation listens on while a command is read (PLAN-V24 T2-1).
      return snapshot.conversation?.working ? WORKING : LISTENING
    case 'working':
      return WORKING
    case 'typing':
      // Words that wait in the text line: the line says what to do, under the bar's name (T1-6).
      return waits(snapshot.problem) ? VOICE_BAR_NAME : TYPE_WHAT
    case 'problem':
    case 'answer':
      return VOICE_BAR_NAME
  }
}

/**
 * Words that wait in the text line, under a line that says why: unclear words (PLAN-V23 T1-6), or
 * words over the server's limit (PLAN-V24 choice 9).
 */
function waits(problem: BarProblem | null): boolean {
  return problem?.kind === 'unclear' || problem?.kind === 'too_long'
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

/**
 * A line said without alarm: why there is no mic, which isn't a failure of the moment, or a
 * conversation that stopped after its quiet.
 */
function isQuiet(problem: BarProblem): boolean {
  return (
    problem.kind === 'no_voice' ||
    problem.kind === 'quiet' ||
    (problem.kind === 'mic' && problem.problem === 'no_speech_tool')
  )
}

type BarAction = 'try_again' | 'type_instead' | 'carry_on' | 'say_again' | 'start_again'

const ACTION_LABELS: Readonly<Record<BarAction, string>> = {
  try_again: TRY_AGAIN,
  type_instead: TYPE_INSTEAD,
  carry_on: CARRY_ON,
  say_again: SAY_IT_AGAIN,
  start_again: START_AGAIN,
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
    // Unclear words wait in the text line: say them again, where the voice works (T1-6).
    if (problem.kind === 'unclear') return snapshot.voice ? ['say_again'] : []
    // The text line is there already: only a way back to the mic, where one helps.
    return problem.kind === 'mic' && problemActions(problem.problem, false).includes('try_again')
      ? ['try_again']
      : []
  }
  switch (problem.kind) {
    case 'nothing_heard':
    case 'too_slow':
      return ['try_again', 'type_instead']
    case 'quiet':
      // A conversation stopped after 2 minutes of quiet (PLAN-V24 choice 10).
      return ['start_again']
    case 'left':
      // A phone left the page: the words so far go in the text line (T2-5).
      return ['carry_on']
    case 'too_many':
    case 'no_voice':
    case 'unclear':
    case 'too_long':
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

/**
 * What a screen reader hears once, as the bar moves on. A problem's own alert speaks for it. A
 * conversation's line (a read-back, "Sent.") is said in place of "Listening".
 */
function statusOf(snapshot: BarSnapshot): string {
  if (snapshot.phase === 'answer') return snapshot.answer?.line ?? ''
  const { problem } = snapshot
  // A line said without alarm has no alert of its own: the quiet stop is said here.
  if (snapshot.phase === 'problem') return problem && isQuiet(problem) ? problemLine(problem) : ''
  if (waits(problem)) return ''
  // While a command is worked out, the title says so.
  const talk = snapshot.phase === 'listening' ? snapshot.conversation : null
  const line = talk && !talk.working ? talk.line : null
  return line ?? titleOf(snapshot)
}

function KeyHint({ children }: { children: ReactNode }) {
  return (
    <Kbd aria-hidden="true" className="touch:hidden">
      {children}
    </Kbd>
  )
}

export default function VoiceBar({
  env,
  makeTool,
  read = readCommand,
  times,
  tone = playTone,
}: VoiceBarProps) {
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
  const keepListening = useKeepListening()
  // A review card open now: the bar gives way to it, and its foot shows the conversation (T2-3).
  const card = useOpenCard()
  const shown = open && card === null

  // A new session each time the bar opens, with what is on screen as it opens.
  const [opened, setOpened] = useState(false)
  const [session, setSession] = useState<BarSession | null>(null)
  const [screen, setScreen] = useState<Screen>(NO_SCREEN)
  // The hint list (PLAN-V23 T1-5): for the address's company while the bar is shut, so it is
  // ready for the first V; for what is on screen once it opens. Never for a Viewer.
  const addressKey = onPageOf(location.pathname, location.search)?.company_key ?? null
  const hintList = useQuery({
    ...namesQueryOptions(open ? screen.key : addressKey),
    enabled: !viewer,
  })
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
      const shown: Screen = {
        key: onPage?.company_key ?? null,
        names: row ? row.names : namesOnPage(client, onPage),
      }
      // The list the page has now; one that comes later is handed on (below).
      const list = cachedNames(client, shown.key)
      setScreen(shown)
      setSession(
        new BarSession({
          onPage,
          // A conversation reads what is on screen at each command, as it may cross pages
          // (PLAN-V24 T2-1). The address is the browser's own: the app's router keeps it.
          where: () => {
            const prepped = panelCompany()
            if (prepped) return { company_key: prepped }
            const { pathname, search } = window.location
            return onScreen()?.onPage ?? onPageOf(pathname, search)
          },
          conversation: isKeepListeningOn(),
          cardOpen: () => cardShownOf(openedCard()),
          names: fixNamesOf(shown.names, list),
          hints: hintsOf(shown.names, list),
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
          tone,
        }),
      )
    }
  }

  // The hint list that came in after the bar opened: the fix and the service use it from now.
  const names = hintList.data
  useEffect(() => {
    if (session && names)
      session.setNames(fixNamesOf(screen.names, names), hintsOf(screen.names, names))
  }, [session, names, screen.names])

  // A V the bar took (the one that opened it, or one that listens again) until it comes up: its
  // repeats type nothing, even in the text line the focus may have moved to (PLAN-V23 choice 6).
  const vTaken = useRef(false)

  // It starts once the voice tool setting is known, and lets everything go when the bar closes.
  // A setting that couldn't be read opens the text line: no voice goes anywhere on a guess.
  const toolKnown = !options.isPending
  const begin = useEffectEvent((current: BarSession) => {
    current.start(options.data?.voice_tool ?? null)
    // The V that opened the bar is still down: held, letting it go ends the talk (choice 6).
    if (isVHeld()) {
      vTaken.current = true
      current.vDown()
    }
  })
  useEffect(() => {
    if (!open || !session || !toolKnown) return undefined
    begin(session)
    return () => {
      session.dispose()
    }
  }, [open, session, toolKnown])

  // On a laptop that needs the model, it downloads once the page is idle (PLAN-V24 choice 25).
  // Only once the setting is known and isn't typing: never on the default while it loads.
  const setting = options.data?.voice_tool ?? null
  useEffect(() => {
    if (viewer || setting === null || setting === 'typing') return undefined
    const computer = deviceKind((env?.browser ?? browserFacts)()) === 'computer'
    if (!computer || pickEngine(setting, env) !== 'model') return undefined
    const model = env?.model ?? DEVICE_MODEL
    return whenIdle(() => {
      // A failed download is tried again at Speak, where it can say so.
      void model.fetch().catch(() => undefined)
    })
  }, [viewer, setting, env])

  const snapshot = useSyncExternalStore(
    session?.subscribe ?? noSubscribe,
    session?.getSnapshot ?? closedSnapshot,
  )
  const { phase } = snapshot

  // A turn that waited for a card that closed, or never came to hear it, goes on (T2-3).
  useEffect(() => {
    session?.cardChanged()
  }, [session, card])

  // The bar's own keys, while it is open: V is Done (or listens again), Esc is Cancel. A V that
  // listens again and is held ends the talk as it comes up, as the V that opened the bar does.
  useEffect(() => {
    if (!open || !session) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      if (event.repeat && isVKey(event)) {
        if (vTaken.current) event.preventDefault()
        return
      }
      const inBar = event.target instanceof Element && event.target.closest(VOICE_BAR) !== null
      if (event.key === 'Escape') {
        // A box on the page keeps its own Esc, and so does another dialog or menu.
        if (somethingElseOpen() || (isTyping(event) && !inBar)) return
        event.preventDefault()
        session.cancel()
        return
      }
      if (isPlainV(event) && session.pressV()) {
        event.preventDefault()
        vTaken.current = true
        session.vDown()
      }
    }
    const letGo = (): void => {
      vTaken.current = false
      letGoV()
      session.vUp()
    }
    const onUp = (event: KeyboardEvent): void => {
      if (isVKey(event)) letGo()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('keyup', onUp)
    window.addEventListener('blur', letGo)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', letGo)
    }
  }, [open, session])

  // The focus: into the bar as it opens (the text line, when typing), and back as it closes.
  const returnTo = useRef<HTMLElement | null>(null)
  const whyId = useId()
  const bar = useRef<HTMLDivElement | null>(null)
  const line = useRef<HTMLInputElement | null>(null)
  const room = useBarRoom(shown)
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
    // Out of the text line (sent, or back to the mic), or back after a card: the bar keeps the
    // focus for its keys.
    else if (shown && document.activeElement === document.body) bar.current?.focus()
  }, [open, shown, phase])

  const title = titleOf(snapshot)
  const listening = phase === 'starting' || phase === 'listening'
  // The model gets ready first (PLAN-V24 T4-3): nothing to stop yet, and its download shows.
  const preparing = listening && Boolean(snapshot.mic?.preparing)
  const download = listening ? downloadOf(snapshot) : null
  const actions = actionsOf(snapshot)
  // One Navy button: Done (Stop, in a conversation) while listening, Send in the text line, else
  // the first action.
  const [first, ...rest] = actions
  const main = phase === 'typing' ? undefined : first
  const others = phase === 'typing' ? actions : rest
  const problem = snapshot.problem
  // A name the mic heard nearly right, and put right: said once, under the words.
  const fixes = listening ? (snapshot.mic?.fixes ?? []) : snapshot.fixes
  const act = (action: BarAction): void => {
    if (!session) return
    if (action === 'try_again' || action === 'say_again' || action === 'start_again') {
      session.tryAgain()
    } else session.typeInstead()
  }
  // The rep's own next company, for "Try saying" (PLAN-V23 T4-3).
  const nextCompany = firstCompanyOf(names ?? cachedNames(client, screen.key))
  // Words that wait in the text line: the line comes before it (T1-6, PLAN-V24 choice 9).
  const waiting = waits(problem)
  // A conversation listens (PLAN-V24 T2-1): the command being read, and the next words.
  const conversation = listening ? snapshot.conversation : null
  // Over the server's limit, the words can't go until they are shortened.
  const tooLong = snapshot.draft.trim().length > MAX_CHARS

  const problemView = problem ? (
    isQuiet(problem) ? (
      <p id={whyId} data-slot="voice-problem" className="text-pretty text-muted-foreground">
        {problemLine(problem)}
      </p>
    ) : (
      <p
        id={waiting ? whyId : undefined}
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
  ) : null

  return (
    <>
      <AnimatePresence>
        {shown ? (
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
              {listening && !preparing ? (
                // With reduced motion: one still bar beside the word above. Not while the model
                // gets ready: no mic is open yet, and the title needs the room on a phone.
                <FrequencyBars source={snapshot.mic?.bars ?? null} label="" className="h-6" />
              ) : null}
            </div>

            {waiting ? problemView : null}

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
                  // Why the voice can't work here, or why the words wait here, read with the line.
                  aria-describedby={problem && (isQuiet(problem) || waiting) ? whyId : undefined}
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
                  disabled={snapshot.draft.trim() === '' || tooLong}
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
            ) : download ? (
              // The model's download (PLAN-V24 choice 25), as tall as the words it gives way to.
              <div
                data-slot="voice-download"
                className="flex min-h-12 flex-col justify-center gap-2"
              >
                <p className="text-pretty text-muted-foreground">{ONLY_ONCE}</p>
                <div className="flex items-center gap-3">
                  <Progress
                    value={Math.round(
                      (Math.min(download.loaded, download.total) / download.total) * 100,
                    )}
                    getValueLabel={() => downloadedOf(download.loaded, download.total)}
                    aria-label={VOICE_DOWNLOAD}
                    className="flex-1"
                  />
                  <span className="shrink-0 text-caption text-muted-foreground tabular-nums">
                    {downloadedOf(download.loaded, download.total)}
                  </span>
                </div>
              </div>
            ) : (
              <div
                data-slot="voice-words"
                className="flex max-h-32 min-h-12 flex-col gap-1 overflow-y-auto text-body text-foreground"
              >
                {conversation?.working ? (
                  // The command being read stays, quieter, above the next words.
                  <p data-slot="voice-working" className="text-pretty text-muted-foreground">
                    {conversation.working}
                  </p>
                ) : null}
                {listening ? (
                  <LiveWords
                    chunks={snapshot.mic?.chunks ?? []}
                    hearing={snapshot.mic?.hearing ?? ''}
                    empty={
                      !conversation || conversation.turns === 0 ? (
                        <SayExamples company={nextCompany} />
                      ) : conversation.working ? (
                        false
                      ) : (
                        // The last command's line ("Sent.", a read-back), or what to say next.
                        <p data-slot="voice-line" className="text-pretty text-muted-foreground">
                          {conversation.line ?? NEXT_COMMAND}
                        </p>
                      )
                    }
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

            {listening && snapshot.mic?.movedTo ? (
              // The mic moved by itself, a headset plugged in (PLAN-V24 T1-2): said once.
              <p
                role="status"
                data-slot="voice-moved"
                className="text-caption text-muted-foreground"
              >
                {nowUsing(snapshot.mic.movedTo.name)}
              </p>
            ) : null}

            {waiting ? null : problemView}

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
                {preparing ? null : listening ? (
                  <Button
                    type="button"
                    size="sm"
                    className="touch:h-11"
                    aria-keyshortcuts={vOn ? 'V' : undefined}
                    onClick={() => {
                      session?.done()
                    }}
                  >
                    {/* A conversation stops; one command is done (PLAN-V24 T2-1). */}
                    {conversation ? STOP : DONE}
                    {vOn ? <KeyHint>V</KeyHint> : null}
                  </Button>
                ) : main ? (
                  <Button
                    type="button"
                    size="sm"
                    className="touch:h-11"
                    // Start again is V's too, as the quiet stop says (PLAN-V24 choice 10).
                    aria-keyshortcuts={main === 'start_again' && vOn ? 'V' : undefined}
                    onClick={() => {
                      act(main)
                    }}
                  >
                    {main === 'try_again' ? <RotateCcw aria-hidden="true" /> : null}
                    {ACTION_LABELS[main]}
                    {main === 'start_again' && vOn ? <KeyHint>V</KeyHint> : null}
                  </Button>
                ) : null}
              </div>
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>
      {/* The review card a command opens (T3-3): it hears the conversation while it listens. */}
      <CardHost
        env={env}
        makeTool={makeTool}
        read={read}
        tone={tone}
        conversation={open && session?.keepsListening ? session : null}
        converse={keepListening && !open ? openVoiceBarByKey : null}
      />
    </>
  )
}
