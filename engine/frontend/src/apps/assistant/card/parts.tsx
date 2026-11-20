/**
 * The review card's small parts (PLAN-V22 T3-3, choices 19 and 20): a choice to make ("Which
 * James?"), a box with its own mic, a line of the card, the hint bar with real key caps, and the
 * strips at the card's foot (V's change, the listening for "send it", and the voice bar's
 * conversation while the card hears it, PLAN-V24 T2-3).
 *
 * - **A choice** is a group of buttons: the arrow keys move between them, and Enter (or a click)
 *   picks. Not a list box: the card keeps its own keys.
 * - **A box's mic** writes straight into it (the call note box's `NoteMic`), on a laptop only, and
 *   only where the voice works.
 * - Every part a send can be blocked on carries `data-box`, so Enter can jump there.
 */
import { CircleAlert } from 'lucide-react'
import { forwardRef, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import type { VoiceToolKind } from '@/api/types'
import { LiveWords } from '@/apps/companies/call-notes/mic/live-words'
import {
  GETTING_VOICE_READY,
  gettingVoiceReadyOn,
  RECONNECTING,
  STEP_WORDS,
} from '@/apps/companies/call-notes/mic/words'
import { NoteMic } from '@/apps/companies/call-notes/note-mic'
import { FrequencyBars } from '@/components/motion/frequency-bars'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Textarea } from '@/components/ui/textarea'
import { isMac } from '@/lib/platform'
import { cn } from '@/lib/utils'
import type { BarSnapshot } from '../voice/bar-session'
import { useVKeyOn } from '../voice/v-switch'
import { SAY_IT_AGAIN, STOP } from '../voice/words'
import { CountdownBar } from './countdown'
import type { Box } from './draft'
import {
  CANCEL,
  KEYS_NAME,
  LEAVE_BOX,
  LISTENING,
  SAY_SEND_IT,
  SEND,
  SPEAK,
  TYPE_CHANGE,
  WORKING,
} from './words'

// --- A line of the card ---------------------------------------------------------------------------

/** One part of the card: a quiet label, then what it says. */
export function CardLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption text-muted-foreground">{label}</span>
      <div className="text-ui text-foreground">{children}</div>
    </div>
  )
}

/** A problem with a part, under it: an icon and words. */
export function PartProblem({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-caption text-destructive-ink">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

// --- A choice ("Which James?") -----------------------------------------------------------------------

export interface ChoiceOption {
  id: string
  title: string
  /** A job title, a city: what tells two alike apart. */
  detail?: string | null
}

export interface ChoiceListProps {
  /** The question, like "Which James?". It names the group. */
  label: string
  options: readonly ChoiceOption[]
  onPick: (id: string) => void
  box: Box
}

/** The options as buttons. Up and Down (or Left and Right) move; Enter or a click picks. */
export function ChoiceList({ label, options, onPick, box }: ChoiceListProps) {
  const labelId = useId()
  const group = useRef<HTMLDivElement>(null)
  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? -1
          : 0
    if (step === 0) return
    const buttons = [...(group.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const at = buttons.findIndex((button) => button === document.activeElement)
    if (buttons.length === 0) return
    event.preventDefault()
    const next = at === -1 ? 0 : (at + step + buttons.length) % buttons.length
    buttons[next]?.focus()
  }
  return (
    <div className="flex flex-col gap-2">
      <p id={labelId} className="text-ui font-semibold text-foreground">
        {label}
      </p>
      <div
        ref={group}
        role="group"
        aria-labelledby={labelId}
        data-box={box}
        className="flex flex-col gap-1"
        onKeyDown={move}
      >
        {options.map((option) => (
          <Button
            key={option.id}
            type="button"
            variant="outline"
            data-slot="card-choice"
            className="h-auto min-h-11 flex-col items-start justify-center gap-0 py-2 text-left whitespace-normal"
            onClick={() => {
              onPick(option.id)
            }}
          >
            <span className="font-semibold">{option.title}</span>
            {option.detail ? (
              <span className="text-caption font-normal text-muted-foreground">
                {option.detail}
              </span>
            ) : null}
          </Button>
        ))}
      </div>
    </div>
  )
}

// --- A box ---------------------------------------------------------------------------------------

export interface BoxFieldProps {
  label: string
  box: Box | 'more'
  value: string
  onChange: (value: string) => void
  /** Several lines (a textarea), or one. */
  lines?: boolean
  max: number
  placeholder?: string
  /** The voice tool, for the box's own mic. Null: no mic here (a phone, or no voice). */
  mic: VoiceToolKind | null
  /** Names on the card, for the mic's name fix. */
  names?: readonly string[]
  /** Under the box: what it reads as, or why it can't be read. */
  hint?: ReactNode
  invalid?: boolean
}

/** A box on the card, with its label and, on a laptop, its own mic in the corner. */
export const BoxField = forwardRef<HTMLTextAreaElement | HTMLInputElement, BoxFieldProps>(
  function BoxField(
    {
      label,
      box,
      value,
      onChange,
      lines = false,
      max,
      placeholder,
      mic,
      names = [],
      hint,
      invalid,
    },
    ref,
  ) {
    const id = useId()
    const hintId = useId()
    const own = useRef<HTMLTextAreaElement | null>(null)
    const setRef = (element: HTMLTextAreaElement | HTMLInputElement | null): void => {
      own.current = element as HTMLTextAreaElement | null
      if (typeof ref === 'function') ref(element)
      else if (ref) ref.current = element
    }
    const field = {
      id,
      value,
      maxLength: max,
      placeholder,
      'data-box': box,
      'aria-invalid': invalid ? true : undefined,
      'aria-describedby': hint ? hintId : undefined,
      autoComplete: 'off',
    } as const
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-caption text-muted-foreground">
          {label}
        </label>
        <div className="relative">
          {lines ? (
            <Textarea
              {...field}
              ref={setRef}
              className={cn('min-h-24 touch:text-body', mic && 'pb-12')}
              onChange={(event) => {
                onChange(event.target.value)
              }}
            />
          ) : (
            <Input
              {...field}
              ref={setRef}
              className={cn('touch:text-body', mic && 'pr-11')}
              onChange={(event) => {
                onChange(event.target.value)
              }}
            />
          )}
          {mic ? (
            <NoteMic
              // Nested corners: inside the box's 10px corner, 2 to 4px in, a smaller one.
              className={cn('absolute right-1 size-8 rounded-sm', lines ? 'bottom-1' : 'top-0.5')}
              tool={mic}
              box={own}
              names={names}
              onText={(text) => {
                const now = value.trimEnd()
                onChange((now ? `${now} ${text}` : text).slice(0, max))
              }}
            />
          ) : null}
        </div>
        {hint ? (
          <div id={hintId} className="text-caption text-muted-foreground">
            {hint}
          </div>
        ) : null}
      </div>
    )
  },
)

// --- The hint bar (choice 20) ------------------------------------------------------------------------

function Hint({ keys, words }: { keys: string; words: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <Kbd>{keys}</Kbd>
      <span>{words}</span>
    </span>
  )
}

/**
 * Real key caps: on the card, or inside a box. Not on a touch screen. `escape` is what Esc does
 * on the card: Cancel, or Later on a call (PLAN-V23 T4-2). V shows only while "Use V to speak" is
 * on (T4-1), and says Stop while a conversation listens (PLAN-V24 T2-3).
 */
export function HintBar({
  inBox,
  escape = CANCEL,
  v = SPEAK,
}: {
  inBox: boolean
  escape?: string
  v?: string
}) {
  const ctrl = isMac() ? '⌘' : 'Ctrl'
  const vOn = useVKeyOn()
  return (
    <div
      data-slot="card-hints"
      role="group"
      aria-label={KEYS_NAME}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted-foreground touch:hidden"
    >
      {inBox ? (
        <>
          <Hint keys={`${ctrl}+Enter`} words={SEND} />
          <Hint keys="Esc" words={LEAVE_BOX} />
        </>
      ) : (
        <>
          <Hint keys="Enter" words={SEND} />
          <Hint keys="Esc" words={escape} />
          {vOn ? <Hint keys="V" words={v} /> : null}
        </>
      )}
    </div>
  )
}

// --- The strips at the card's foot --------------------------------------------------------------

export interface ConversationStripProps {
  /** The voice bar's conversation, which the card hears while it is open (PLAN-V24 T2-3). */
  snapshot: BarSnapshot
  /** The quiet line under "Listening", which describes the card too ("Say 'send it'..."). */
  hintId: string
  /** The line the conversation said last, if it stopped: the quiet stop, or a problem. */
  ended: string | null
  onStop: () => void
}

/**
 * While a conversation listens with the card open (PLAN-V24 T2-3): the mic is on, so the card says
 * so, with the bars, the words as they come, and Stop (V). Kept small on purpose: Part 5 turns it
 * into a pill beside the card (T5-1). Once the conversation stops with a line (the quiet stop, a
 * problem), the line stays until the card closes, and V listens again.
 */
export function ConversationStrip({ snapshot, hintId, ended, onStop }: ConversationStripProps) {
  const vOn = useVKeyOn()
  const { phase, conversation } = snapshot
  const live = (phase === 'starting' || phase === 'listening') && conversation !== null
  if (!live) {
    return ended ? (
      <div data-slot="card-conversation" data-phase={phase}>
        <p role="status" className="text-ui text-pretty text-muted-foreground">
          {ended}
        </p>
      </div>
    ) : null
  }
  const title =
    phase === 'starting'
      ? snapshot.mic?.steps.found === 'pass'
        ? STEP_WORDS.allowed.waiting
        : STEP_WORDS.found.waiting
      : snapshot.mic?.reconnecting
        ? RECONNECTING
        : conversation.working
          ? WORKING
          : LISTENING
  const line = conversation.working ? null : conversation.line
  return (
    <div data-slot="card-conversation" data-phase={phase} className="flex flex-col gap-2">
      {/* A screen reader hears where it stands, and each line, once. */}
      <p role="status" className="sr-only">
        {line ?? title}
      </p>
      <div className="flex min-h-6 items-center gap-3">
        <p className="min-w-0 flex-1 truncate font-semibold text-foreground">{title}</p>
        <FrequencyBars source={snapshot.mic?.bars ?? null} label="" className="h-6" />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="touch:h-11"
          aria-keyshortcuts={vOn ? 'V' : undefined}
          onClick={onStop}
        >
          {STOP}
          {vOn ? (
            <Kbd aria-hidden="true" className="touch:hidden">
              V
            </Kbd>
          ) : null}
        </Button>
      </div>
      <div className="min-h-6 text-ui text-foreground">
        <LiveWords
          chunks={snapshot.mic?.chunks ?? []}
          hearing={snapshot.mic?.hearing ?? ''}
          empty={
            <p id={hintId} className="text-pretty text-muted-foreground">
              {SAY_SEND_IT}
            </p>
          }
        />
      </div>
      {line ? (
        <p data-slot="card-conversation-line" className="text-ui text-pretty text-foreground">
          {line}
        </p>
      ) : null}
    </div>
  )
}

/** While the card listens for "send it" (choice 23): the words, and a bar that empties once. */
export function ListenStrip({ id, ms }: { id: string; ms: number }) {
  return (
    <div data-slot="card-listen" className="flex flex-col gap-2">
      <p id={id} className="text-ui text-muted-foreground">
        {SAY_SEND_IT}
      </p>
      <CountdownBar ms={ms} />
    </div>
  )
}

export interface VoiceStripProps {
  snapshot: BarSnapshot
  /** The line a problem or an answer says, or why typed words wait (unclear words, T1-6). */
  line: string | null
  onTyped: (text: string) => void
  onSendTyped: () => void
  /** Unclear words (PLAN-V23 T1-6): listen again. */
  onSayAgain?: () => void
}

/**
 * V on the card (choice 19): it listens, then works it out, as the voice bar does. Words too
 * unclear to make a change wait in its text line, under the stop line, with "Say it again".
 */
export const VoiceStrip = forwardRef<HTMLInputElement, VoiceStripProps>(function VoiceStrip(
  { snapshot, line, onTyped, onSendTyped, onSayAgain },
  ref,
) {
  const { phase } = snapshot
  const lineId = useId()
  const listening = phase === 'starting' || phase === 'listening'
  // The model on the device gets ready first, where it is the engine (PLAN-V24 T4-3): its line,
  // as the voice bar's, and no bars until a mic is open.
  const preparing = listening ? (snapshot.mic?.preparing ?? null) : null
  const title = preparing
    ? preparing.total > 0
      ? gettingVoiceReadyOn(preparing.device)
      : GETTING_VOICE_READY
    : listening
      ? LISTENING
      : phase === 'working'
        ? WORKING
        : phase === 'typing'
          ? TYPE_CHANGE
          : null
  return (
    <div
      data-slot="card-voice"
      data-phase={phase}
      className="flex flex-col gap-2 rounded-md border bg-card p-3"
    >
      <p role="status" className="sr-only">
        {title ?? line ?? ''}
      </p>
      {title ? (
        <div className="flex min-h-6 items-center gap-3">
          <p className="min-w-0 flex-1 font-semibold text-foreground">{title}</p>
          {listening && !preparing ? (
            <FrequencyBars source={snapshot.mic?.bars ?? null} label="" className="h-6" />
          ) : null}
        </div>
      ) : null}
      {phase === 'typing' ? (
        <>
          {line ? (
            <p id={lineId} role="alert" className="text-ui text-pretty text-foreground">
              {line}
            </p>
          ) : null}
          <form
            onSubmit={(event) => {
              event.preventDefault()
              onSendTyped()
            }}
          >
            <Input
              ref={ref}
              className="touch:text-body"
              value={snapshot.draft}
              aria-label={TYPE_CHANGE}
              aria-describedby={line ? lineId : undefined}
              placeholder={TYPE_CHANGE}
              autoComplete="off"
              onChange={(event) => {
                onTyped(event.target.value)
              }}
            />
          </form>
          {onSayAgain ? (
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="touch:h-11"
                onClick={onSayAgain}
              >
                {SAY_IT_AGAIN}
              </Button>
            </div>
          ) : null}
        </>
      ) : listening ? (
        <div className="min-h-6 text-body text-foreground">
          <LiveWords chunks={snapshot.mic?.chunks ?? []} hearing={snapshot.mic?.hearing ?? ''} />
        </div>
      ) : snapshot.words && phase === 'working' ? (
        <p className="text-body text-pretty text-foreground">{snapshot.words}</p>
      ) : null}
      {line && !title ? <p className="text-ui text-pretty text-foreground">{line}</p> : null}
    </div>
  )
})
