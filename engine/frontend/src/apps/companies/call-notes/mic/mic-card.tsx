/**
 * The mic card (PLAN-V18 T3-4 and T3-5, "How it should look and move"): it opens in the middle of
 * the window (`MicSheet`; Al-khair, 17 Nov 2026), checks the mic in under 2 seconds, then listens,
 * with live bars that follow the voice (`FrequencyBars`), a timer, and the words as they come.
 *
 * - **Its title says what is happening:** "Checking your mic", "Speak now", "Writing it out",
 *   "Done", and "Reconnecting" during a network blip (PLAN-V24 T1-3). A screen reader hears each
 *   change once (a status line), and never each word.
 * - **The check:** four lines, each ticked by its real result, at least 40ms apart. A failure
 *   turns its line Terracotta, with its fix under it and its buttons (the plan's table), and the
 *   card never shakes. Everything else still works: Type instead, or Cancel.
 * - **The words** fade in a chunk at a time (150ms), with no typewriter. Words still being heard
 *   are quieter (`LiveWords`, which the voice bar shares). A name heard nearly right is fixed, and
 *   the card says so once.
 * - **Which mic:** its name, with Change to pick another, remembered on this computer.
 * - **Keys:** Enter is Done, Esc is Cancel (nothing goes in the box).
 * - **Check only** ("Check my mic", from Ctrl+K or the profile menu): the same check, the bars,
 *   and Done. There is no note box, so no Type instead.
 * - **The model on the device** (PLAN-V24 T4-3): where it is the engine, it gets ready before the
 *   check. While it downloads, the title says "Getting voice ready on this computer", and its
 *   bar fills in place of the check's lines, with "Only this once." Type instead skips it. A
 *   failed download, a model that won't start and a device too slow for it each say so.
 *
 * It loads late, the first time a mic button is pressed or pointed at, so neither the first visit
 * nor the Companies page carries it. The mic is let go the moment the card closes.
 */
import { CircleAlert, CircleDashed, Mic, RotateCcw } from 'lucide-react'
import { m } from 'motion/react'
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { FrequencyBars } from '@/components/motion/frequency-bars'
import { MicSheet, MicSheetTitle } from '@/components/motion/mic-sheet'
import { EASE, INSTANT } from '@/components/motion/springs'
import { TickIn } from '@/components/motion/tick-in'
import { useStill } from '@/components/motion/use-still'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Kbd } from '@/components/ui/kbd'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { ChoiceItem } from '../../choice-item'
import { clockText } from '../words'
import { LiveWords } from './live-words'
import type { NameFix } from './name-fix'
import { CHECK_STEPS, MicSession, type MicEnv, type MicSnapshot, type Preparing } from './session'
import { browserFacts, deviceKind } from './voice-engine'
import type { VoiceToolKind, VoiceToolMaker } from './voice-tool'
import {
  ACTION_WORDS,
  CANCEL,
  CHANGE_MIC,
  CHECK_PASSED,
  CHECKING,
  DONE,
  DONE_TITLE,
  downloadedOf,
  fixedWords,
  GETTING_VOICE_READY,
  gettingVoiceReadyOn,
  LISTENING,
  MIC_NOT_READY,
  MIC_STOPPED,
  MIC_WORKS,
  nowUsing,
  ONLY_ONCE,
  problemActions,
  problemWords,
  RECONNECTING,
  SPEAK_NOW,
  speakingFor,
  STEP_WORDS,
  VOICE_DOWNLOAD,
  WHICH_MIC,
  WRITING,
  type CheckStep,
  type MicAction,
} from './words'

/** The check's ticks show at least this far apart, so two that land together still read. */
const TICK_GAP_MS = 40

/** A problem's words fade in this long (150ms, the one curve). */
const WORDS_IN = { duration: 0.15, ease: EASE } as const

export interface MicCardProps {
  open: boolean
  /** `note`: the words go in the note box. `check`: check the mic only. */
  mode: 'note' | 'check'
  tool: VoiceToolKind
  /** The company's and the person's names, for the name fix. */
  names?: readonly string[]
  /** The button that opened it: the focus goes back to it. Null: back to where it was. */
  opener: RefObject<HTMLElement | null> | null
  /** Done: the words for the note box, and the names fixed. */
  onDone?: (text: string, fixes: readonly NameFix[]) => void
  /** Type instead (or Carry on): what was said so far, maybe nothing, goes in the box. */
  onTypeInstead?: (text: string) => void
  /** The card is shut, whatever shut it. */
  onClose: () => void
  /** Where the focus goes after Done or Type instead: the note box. */
  focusAfter?: RefObject<HTMLElement | null>
  /** For tests: the browser and the voice tool. */
  env?: MicEnv
  makeTool?: VoiceToolMaker | null
}

const NO_SESSION_SNAPSHOT: MicSnapshot = {
  phase: 'checking',
  steps: { found: 'waiting', allowed: 'waiting', hear: 'waiting', ready: 'waiting' },
  failedAt: null,
  problem: null,
  device: null,
  devices: [],
  bars: null,
  chunks: [],
  hearing: '',
  fixes: [],
  listeningSince: null,
  movedTo: null,
  reconnecting: false,
  preparing: null,
}

const noSubscribe = (): (() => void) => () => undefined

/** The card's title for where it stands. */
function titleOf(snapshot: MicSnapshot): string {
  switch (snapshot.phase) {
    case 'listening':
      // A network blip, tried again quietly (PLAN-V24 T1-3): the words so far stay.
      return snapshot.reconnecting ? RECONNECTING : SPEAK_NOW
    case 'writing':
      return WRITING
    case 'done':
      return DONE_TITLE
    case 'checked':
      return MIC_WORKS
    case 'failed':
      if (snapshot.problem === 'cut_off' || snapshot.problem === 'device_too_slow') {
        return MIC_STOPPED
      }
      if (snapshot.problem === 'too_slow') return WRITING
      // The model on the device couldn't get ready (PLAN-V24 T4-3): the mic wasn't opened.
      if (snapshot.problem === 'download_failed' || snapshot.problem === 'model_failed') {
        return STEP_WORDS.ready.fail
      }
      return snapshot.failedAt === 'ready' ? MIC_WORKS : MIC_NOT_READY
    case 'checking': {
      // The model on the device gets ready before the check (PLAN-V24 T4-3).
      const preparing = snapshot.preparing
      if (!preparing) return CHECKING
      return preparing.total > 0 ? gettingVoiceReadyOn(preparing.device) : GETTING_VOICE_READY
    }
  }
}

/**
 * The model's download, in place of the check's lines and as tall (PLAN-V24 T4-3): "Only this
 * once.", and a bar that fills with the megabytes.
 */
function VoiceDownload({ preparing }: { preparing: Preparing }) {
  const { loaded, total } = preparing
  const shown = downloadedOf(loaded, total)
  return (
    <div data-slot="mic-download" className="flex min-h-[6.5rem] flex-col justify-center gap-3">
      <p className="text-ui text-pretty text-foreground">{ONLY_ONCE}</p>
      <div className="flex items-center gap-3">
        <Progress
          value={Math.round((Math.min(loaded, total) / total) * 100)}
          getValueLabel={() => shown}
          aria-label={VOICE_DOWNLOAD}
          className="flex-1"
        />
        <span className="shrink-0 text-caption text-muted-foreground tabular-nums">{shown}</span>
      </div>
    </div>
  )
}

/**
 * How many passed lines to show: the first at once, then one more at least 40ms after the one
 * before it, so two results that land together still read as two ticks. With reduced motion, all
 * at once.
 */
function useStagger(target: number, still: boolean): number {
  const [shown, setShown] = useState(target)
  const last = useRef(0)
  // A new check starts the lines again.
  if (shown > target) setShown(target)
  useEffect(() => {
    if (still || shown >= target) return undefined
    const wait = Math.max(0, last.current + TICK_GAP_MS - Date.now())
    const timer = window.setTimeout(() => {
      last.current = Date.now()
      setShown((now) => Math.min(target, now + 1))
    }, wait)
    return () => {
      window.clearTimeout(timer)
    }
  }, [target, shown, still])
  return still ? target : Math.min(shown, target)
}

/** How long the four ticks stay in view once they all passed, before the words take their place. */
const HOLD_MS = 500

/** True a moment after `ready` turns true, and false again as soon as it turns false. */
function useFolded(ready: boolean): boolean {
  const [folded, setFolded] = useState(false)
  if (!ready && folded) setFolded(false)
  useEffect(() => {
    if (!ready) return undefined
    const timer = window.setTimeout(() => {
      setFolded(true)
    }, HOLD_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [ready])
  return ready && folded
}

function CheckLine({
  step,
  state,
  current,
  problem,
}: {
  step: CheckStep
  state: 'waiting' | 'pass' | 'fail'
  current: boolean
  problem: string | null
}) {
  const still = useStill()
  const words = STEP_WORDS[step][state === 'waiting' ? 'waiting' : state]
  return (
    <li data-slot="mic-check-line" data-state={state} className="flex items-start gap-2.5">
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        {state === 'pass' ? (
          <TickIn className="text-pass-ink" />
        ) : state === 'fail' ? (
          <CircleAlert aria-hidden="true" className="size-4 text-destructive-ink" />
        ) : (
          <CircleDashed
            aria-hidden="true"
            className={cn('size-3', current ? 'text-foreground' : 'text-muted-foreground')}
          />
        )}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span
          className={cn(
            state === 'fail' && 'font-semibold text-destructive-ink',
            state === 'pass' && 'text-foreground',
            state === 'waiting' && (current ? 'text-foreground' : 'text-muted-foreground'),
          )}
        >
          {words}
        </span>
        {problem ? (
          <m.span
            data-slot="mic-problem"
            className="text-pretty text-foreground"
            initial={still ? false : { opacity: 0 }}
            animate={{ opacity: 1, transition: still ? INSTANT : WORDS_IN }}
          >
            {problem}
          </m.span>
        ) : null}
      </span>
    </li>
  )
}

/** "0:42" while the rep speaks, from when the card said "Speak now". */
function SpeakTimer({ since, now }: { since: number; now: () => number }) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => {
      setSeconds(Math.max(0, Math.floor((now() - since) / 1000)))
    }, 1000)
    return () => {
      window.clearInterval(timer)
    }
  }, [since, now])
  const clock = clockText(seconds)
  return (
    <span className="text-ui text-muted-foreground tabular-nums">
      <span className="sr-only">{speakingFor(clock)}</span>
      <span aria-hidden="true">{clock}</span>
    </span>
  )
}

export default function MicCard({
  open,
  mode,
  tool,
  names = [],
  opener,
  onDone,
  onTypeInstead,
  onClose,
  focusAfter,
  env,
  makeTool,
}: MicCardProps) {
  const still = useStill()
  const closing = useRef<'done' | 'type' | 'cancel' | null>(null)
  const [picking, setPicking] = useState(false)
  const noteBox = mode === 'note'

  // A new session each time the card opens. The names and the tool are read as it opens: a call
  // doesn't change under an open card. It starts once it is on the page, and is let go of when
  // the card closes; while the card shrinks away it keeps showing what it had.
  const [opened, setOpened] = useState(false)
  const [session, setSession] = useState<MicSession | null>(null)
  if (open !== opened) {
    setOpened(open)
    if (open) setSession(new MicSession({ mode, tool, names, env, makeTool }))
  }
  useEffect(() => {
    if (!open || !session) return undefined
    closing.current = null
    session.start()
    return () => {
      session.close()
    }
  }, [open, session])

  const snapshot = useSyncExternalStore(
    session?.subscribe ?? noSubscribe,
    session?.getSnapshot ?? (() => NO_SESSION_SNAPSHOT),
  )

  const close = (reason: 'done' | 'type' | 'cancel'): void => {
    closing.current = reason
    onClose()
  }

  // Done: the words go in the box as the card shrinks back to the mic.
  const phase = snapshot.phase
  useEffect(() => {
    if (phase !== 'done' || !session || closing.current) return
    onDone?.(session.text(), session.getSnapshot().fixes)
    close('done')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, session])

  const typeInstead = (): void => {
    onTypeInstead?.(session?.text() ?? '')
    close('type')
  }

  const act = (action: MicAction): void => {
    switch (action) {
      case 'try_again':
        session?.retry()
        return
      case 'pick_mic':
        setPicking(true)
        return
      case 'type_instead':
      case 'carry_on':
        typeInstead()
    }
  }

  const passed = CHECK_STEPS.findIndex((step) => snapshot.steps[step] !== 'pass')
  const allPassed = passed === -1
  const shownPassed = useStagger(allPassed ? CHECK_STEPS.length : passed, still)
  const listening = phase === 'listening' || phase === 'writing'
  const done = phase === 'done'
  // The lines stay until the last tick has been seen, then give way to the words.
  const folded = useFolded(listening && shownPassed >= CHECK_STEPS.length)
  const showSteps =
    !done && !(listening && folded) && !(phase === 'failed' && snapshot.failedAt === null)
  // The model's problems offer the keyboard's mic on a phone or a tablet only (the browser check).
  const device = deviceKind((env?.browser ?? browserFacts)())
  const problem = snapshot.problem ? problemWords(snapshot.problem, device) : null
  const actions = snapshot.problem ? problemActions(snapshot.problem, noteBox) : []
  const [main, ...others] = actions
  const title = titleOf(snapshot)
  const canFinish = noteBox && phase === 'listening'
  // The model's download, before the check (PLAN-V24 T4-3): not while it only loads.
  const preparing = phase === 'checking' ? snapshot.preparing : null
  const download = preparing && preparing.total > 0 ? preparing : null

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // The card's keys stay in the card: the note view and the panel behind it (Ctrl+Enter saves,
    // L logs a call) never hear them. Esc is the dialog's own, so it goes on.
    if (event.key !== 'Escape') event.stopPropagation()
    if (event.key !== 'Enter' || event.defaultPrevented) return
    if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement) {
      return
    }
    if (canFinish) {
      event.preventDefault()
      session?.finish()
    } else if (!noteBox && phase !== 'failed') {
      event.preventDefault()
      close('cancel')
    }
  }

  // The mic moved by itself (PLAN-V24 T1-2): the mic's row shows its name, and a screen reader
  // hears "Now using {mic}." once.
  const said = [title, problem].filter(Boolean).join('. ')
  const status = snapshot.movedTo
    ? `${said}${/[.!?]$/.test(said) ? ' ' : '. '}${nowUsing(snapshot.movedTo.name)}`
    : said
  const deviceName = snapshot.device?.name ?? null

  return (
    <MicSheet
      open={open}
      opener={opener}
      onOpenChange={(next) => {
        if (!next) close('cancel')
      }}
      onKeyDown={onKeyDown}
      onOpenAutoFocus={(event) => {
        // The card itself takes the focus, so Enter is Done and nothing is pressed by mistake.
        event.preventDefault()
        if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus()
      }}
      onCloseAutoFocus={(event) => {
        const box = focusAfter?.current
        if ((closing.current === 'done' || closing.current === 'type') && box) {
          event.preventDefault()
          box.focus()
          if (box instanceof HTMLTextAreaElement) {
            box.setSelectionRange(box.value.length, box.value.length)
          }
        }
      }}
    >
      <div data-slot="mic-card" data-phase={phase} className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-foreground">
              <Mic aria-hidden="true" className="size-5" />
            </span>
            <MicSheetTitle>{title}</MicSheetTitle>
          </div>
          {listening && snapshot.listeningSince !== null && session ? (
            <SpeakTimer since={snapshot.listeningSince} now={session.now} />
          ) : null}
        </div>
        <p role="status" className="sr-only">
          {status}
        </p>

        <FrequencyBars source={snapshot.bars} label={LISTENING} />

        {download ? (
          <VoiceDownload preparing={download} />
        ) : showSteps ? (
          <ul aria-label={CHECKING} className="flex flex-col gap-2 text-ui">
            {CHECK_STEPS.map((step, index) => {
              const state = snapshot.steps[step]
              // A pass shows in turn, at least 40ms after the one before it.
              const shownState = state === 'pass' && index >= shownPassed ? 'waiting' : state
              return (
                <CheckLine
                  key={step}
                  step={step}
                  state={shownState}
                  current={shownState === 'waiting' && index === Math.max(0, shownPassed)}
                  problem={state === 'fail' ? problem : null}
                />
              )
            })}
          </ul>
        ) : null}

        {!showSteps ? (
          // As tall as the four check lines it takes the place of, so the card doesn't jump.
          <div
            data-slot="mic-words"
            className="max-h-40 min-h-[6.5rem] overflow-y-auto rounded-md border bg-card p-3 text-body text-foreground"
          >
            <LiveWords chunks={snapshot.chunks} hearing={snapshot.hearing} />
          </div>
        ) : null}

        {!showSteps && problem ? (
          <p role="alert" data-slot="mic-problem" className="text-pretty text-destructive-ink">
            {problem}
          </p>
        ) : null}

        {snapshot.fixes.length > 0 ? (
          <p className="text-caption text-muted-foreground">{fixedWords(snapshot.fixes)}</p>
        ) : null}

        {phase === 'checked' ? (
          <p className="text-ui text-muted-foreground">{CHECK_PASSED}</p>
        ) : null}

        {snapshot.devices.length > 0 || deviceName ? (
          <div className="flex items-center gap-2 text-ui">
            <Mic aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-foreground" title={deviceName ?? ''}>
              <span className="sr-only">{WHICH_MIC}: </span>
              {deviceName ?? snapshot.devices[0]?.name}
            </span>
            {snapshot.devices.length > 1 ? (
              <DropdownMenu open={picking} onOpenChange={setPicking}>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="touch:h-11"
                    aria-label={`${CHANGE_MIC} the mic`}
                  >
                    {CHANGE_MIC}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel>{WHICH_MIC}</DropdownMenuLabel>
                  {snapshot.devices.map((device) => (
                    <ChoiceItem
                      key={device.id}
                      checked={device.id === snapshot.device?.id}
                      onPick={() => {
                        session?.pick(device.id)
                      }}
                    >
                      <span className="truncate">{device.name}</span>
                    </ChoiceItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t bg-popover px-5 py-3">
        {noteBox && !snapshot.problem && phase !== 'writing' ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2 touch:h-11"
            onClick={typeInstead}
          >
            {ACTION_WORDS.type_instead}
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
            {ACTION_WORDS[action]}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {noteBox || main ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="touch:h-11"
              onClick={() => {
                close('cancel')
              }}
            >
              {noteBox ? CANCEL : DONE}
            </Button>
          ) : null}
          {main ? (
            <Button
              type="button"
              size="sm"
              className="touch:h-11"
              onClick={() => {
                act(main)
              }}
            >
              {main === 'try_again' ? <RotateCcw aria-hidden="true" /> : null}
              {ACTION_WORDS[main]}
            </Button>
          ) : noteBox ? (
            <Button
              type="button"
              size="sm"
              className="touch:h-11"
              disabled={!canFinish}
              aria-keyshortcuts="Enter"
              onClick={() => {
                session?.finish()
              }}
            >
              {DONE}
              <Kbd aria-hidden="true" className="touch:hidden">
                Enter
              </Kbd>
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              className="touch:h-11"
              onClick={() => {
                close('cancel')
              }}
            >
              {DONE}
            </Button>
          )}
        </div>
      </div>
    </MicSheet>
  )
}
