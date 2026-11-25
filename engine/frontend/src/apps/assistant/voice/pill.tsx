/**
 * The Listening pill (PLAN-V24 T5-1, choices 29 to 31): while a review card is open, the voice bar
 * shrinks to this small box beside it, so a rep can always see that the mic is on, and stop it.
 *
 * - **Where:** under the card, in the card's own dialog layer (`MicSheet`'s `aside`): the card is a
 *   modal dialog, so anything outside it could be neither clicked nor reached by the keyboard. The
 *   card keeps its place in the middle of the window as the pill comes and goes.
 * - **What:** the bars, where the conversation stands in the bar's own words ("Listening",
 *   "Reconnecting", "Working it out", "Getting voice ready on this phone"), and Stop (V). Under
 *   them, the words as they come, else the conversation's last line ("Send or keep this one
 *   first."), else what to say to the card. "Now using {mic}." shows under that when the mic moved.
 *   While the model downloads, its progress shows instead, with Type instead and no Stop.
 * - **Once the conversation stops with a line** (the quiet stop, or a problem), the pill keeps the
 *   line and the bar's buttons for it: Start again (V), Try again, Type instead, Carry on. It goes
 *   when the card closes. Stop, "that's all" and V end the conversation, and the pill goes.
 * - **It isn't a pill in shape:** DESIGN.md has no fully round parts, so it has the 10px corner,
 *   and its buttons sit 4px in with the 6px one. "Pill" is only its name (TBC at the look).
 * - **A screen reader** hears each line once (choice 31): the pill's own line starts silent, since
 *   the card that opens with it says what is going on, and then says each change once. "Now
 *   using {mic}." is said once in all, where it first shows: the bar or the pill (`useSaidOnce`).
 * - **Moves:** it fades and rises 4px as it comes, on `smooth`, and fades in 150ms as it goes.
 *   Nothing in it moves but the bars, which follow the voice. With reduced motion it simply shows.
 *
 * The voice bar gives it everything it says (`PillState`), from the bar's own words, so the pill
 * says what the bar would. The card adds what to say to it, and puts the focus back on itself.
 *
 * **Live voice** (PLAN-V28 T2-4): the same pill, with live voice's states in its title
 * (`liveTitle`: Connecting, Listening, Working it out, Speaking, Reconnecting, Muted), the captions
 * (`LiveCaptions`: the rep's words as Google hears them, then the Assistant's) in place of the
 * words, and Mute beside Stop.
 */
import { CircleAlert } from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { LiveWords } from '@/apps/companies/call-notes/mic/live-words'
import type { MicDevice } from '@/apps/companies/call-notes/mic/devices'
import {
  downloadedOf,
  nowUsing,
  ONLY_ONCE,
  VOICE_DOWNLOAD,
} from '@/apps/companies/call-notes/mic/words'
import { FrequencyBars } from '@/components/motion/frequency-bars'
import { INSTANT, springs } from '@/components/motion/springs'
import { useStill } from '@/components/motion/use-still'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import type { Notice } from './bar-session'
import { LiveCaptions, MuteToggle } from './live/view'
import { lineOf, micIsOn, useSaidOnce, type PillActionId, type PillState } from './pill-state'
import { useVKeyOn } from './v-switch'
import { DONE, STOP, TYPE_INSTEAD, VOICE_BAR_NAME } from './words'

/** How far the pill rises as it comes, in px. */
const RISE = 4

/** The pill takes clicks inside the card's layer, which takes none itself (`MicSheet`). */
const TAKES_CLICKS = { pointerEvents: 'auto' } as const

/** "Now using {mic}." (PLAN-V24 T1-2), said once in all, in the bar or the pill. */
export function MovedLine({ device, className }: { device: MicDevice; className?: string }) {
  const sayIt = useSaidOnce(device)
  return (
    <p
      role={sayIt ? 'status' : undefined}
      data-slot="voice-moved"
      className={cn('text-caption text-muted-foreground', className)}
    >
      {nowUsing(device.name)}
    </p>
  )
}

/**
 * Why the free mic listens in live voice's place (PLAN-V28 T4-1), like "Live voice can't reach
 * Google. Using the free mic.": said once in all, in the bar or the pill.
 */
export function NoticeLine({ notice, className }: { notice: Notice; className?: string }) {
  const sayIt = useSaidOnce(notice)
  return (
    <p
      role={sayIt ? 'status' : undefined}
      data-slot="voice-notice"
      className={cn('text-caption text-pretty text-muted-foreground', className)}
    >
      {notice.line}
    </p>
  )
}

/**
 * The line a screen reader hears, kept in one live region. `quiet`: it says nothing of what it
 * holds as it first shows, since that was said already (by the bar, or by the card that opened
 * with the pill), and says each change after that once.
 */
export function SaidStatus({ text, quiet }: { text: string; quiet: boolean }) {
  const [first] = useState(text)
  const [changed, setChanged] = useState(false)
  if (!changed && text !== first) setChanged(true)
  return (
    <p role="status" className="sr-only">
      {quiet && !changed ? '' : text}
    </p>
  )
}

// --- The pill -------------------------------------------------------------------------------------

function VKey() {
  return (
    <Kbd aria-hidden="true" className="touch:hidden">
      V
    </Kbd>
  )
}

export interface ListeningPillProps {
  state: PillState
  /** What to say to the card, before any words: "Say 'send it' or press Enter". */
  hint: string
  /** Its id: the card's dialog reads it with its title. */
  hintId: string
  onStop: () => void
  onAct: (id: PillActionId) => void
}

/** The live pill: the bars, where it stands and Stop, then the words, the line or the hint. */
function Live({ state, hint, hintId, onStop, onAct }: ListeningPillProps) {
  const vOn = useVKeyOn()
  const { snapshot, title } = state
  const { mic, conversation } = snapshot
  // A live talk (PLAN-V28): its captions, bars and Mute in place of the free mic's.
  const talk = snapshot.live ?? null
  const preparing = mic?.preparing ?? null
  // The model downloads: its progress, as the bar shows it (PLAN-V24 T4-3).
  const download = preparing && preparing.total > 0 ? preparing : null
  const working = conversation?.working ?? null
  const line = lineOf(snapshot)
  let under: ReactNode
  if (download) {
    const loaded = Math.min(download.loaded, download.total)
    under = (
      <div data-slot="pill-download" className="flex flex-col gap-1.5">
        <p className="text-pretty text-muted-foreground">{ONLY_ONCE}</p>
        <div className="flex items-center gap-3">
          <Progress
            value={Math.round((loaded / download.total) * 100)}
            getValueLabel={() => downloadedOf(download.loaded, download.total)}
            aria-label={VOICE_DOWNLOAD}
            className="flex-1"
          />
          <span className="shrink-0 text-caption text-muted-foreground tabular-nums">
            {downloadedOf(download.loaded, download.total)}
          </span>
        </div>
      </div>
    )
  } else {
    const empty = working ? (
      // The turn the command step reads stays, quieter, until its answer comes.
      <p data-slot="pill-working" className="text-pretty text-muted-foreground">
        {working}
      </p>
    ) : line ? (
      <p data-slot="pill-line" className="text-pretty text-foreground">
        {line}
      </p>
    ) : (
      <p id={hintId} className="text-pretty text-muted-foreground">
        {hint}
      </p>
    )
    under = talk ? (
      <LiveCaptions captions={talk.captions} empty={empty} />
    ) : (
      <LiveWords chunks={mic?.chunks ?? []} hearing={mic?.hearing ?? ''} empty={empty} />
    )
  }
  const movedTo = talk ? talk.movedTo : (mic?.movedTo ?? null)
  return (
    <>
      <div className="flex min-h-10 items-center gap-3 py-1 pr-1 pl-3 touch:min-h-12">
        {preparing ? null : (
          // Small bars, for a small pill: 2px bars 2px apart. With reduced motion, one still bar.
          <FrequencyBars
            source={talk?.bars ?? mic?.bars ?? null}
            label=""
            className="h-5 shrink-0 gap-0.5 [&>[data-slot=frequency-bar]]:w-0.5"
          />
        )}
        <p data-slot="pill-title" className="min-w-0 flex-1 truncate font-semibold text-foreground">
          {title}
        </p>
        {talk && state.mute ? (
          <MuteToggle muted={talk.muted} onMute={state.mute} iconOnly className="rounded-sm" />
        ) : null}
        {preparing ? (
          // Nothing to stop yet: the model gets ready first. V still closes it.
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-sm touch:h-11"
            onClick={() => {
              onAct('type_instead')
            }}
          >
            {TYPE_INSTEAD}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-sm touch:h-11"
            aria-keyshortcuts={vOn ? 'V' : undefined}
            onClick={onStop}
          >
            {/* A conversation stops; a held V's one command is done (PLAN-V24 choice 7). */}
            {conversation ? STOP : DONE}
            {vOn ? <VKey /> : null}
          </Button>
        )}
      </div>
      <div data-slot="pill-words" className="flex flex-col gap-1 px-3 pb-2 text-ui">
        {under}
        {movedTo && !preparing ? <MovedLine key={movedTo.id} device={movedTo} /> : null}
        {snapshot.notice ? <NoticeLine notice={snapshot.notice} /> : null}
      </div>
    </>
  )
}

/** The pill once the conversation stopped with a line: the line and its buttons. */
function Stopped({
  state,
  stopped,
  onAct,
}: {
  state: PillState
  stopped: NonNullable<PillState['stopped']>
  onAct: (id: PillActionId) => void
}) {
  const vOn = useVKeyOn()
  // The main button goes last, at the right, as in the bar. All are quiet: the card has the one
  // Navy button, Send.
  const [main, ...rest] = state.actions
  const ordered = main ? [...rest, main] : rest
  return (
    <>
      <div className="px-3 pt-2 pb-1">
        {stopped.quiet ? (
          <p data-slot="pill-stopped" className="text-pretty text-muted-foreground">
            {stopped.line}
          </p>
        ) : (
          <p
            role="alert"
            data-slot="pill-stopped"
            className="flex items-start gap-2 text-pretty text-destructive-ink"
          >
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{stopped.line}</span>
          </p>
        )}
      </div>
      {ordered.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-1 p-1">
          {ordered.map((action) => {
            // Start again is V's too, as the quiet stop says (choice 10).
            const byV = action.id === 'start_again' && vOn
            return (
              <Button
                key={action.id}
                type="button"
                variant="outline"
                size="sm"
                className="rounded-sm touch:h-11"
                aria-keyshortcuts={byV ? 'V' : undefined}
                onClick={() => {
                  onAct(action.id)
                }}
              >
                {action.label}
                {byV ? <VKey /> : null}
              </Button>
            )
          })}
        </div>
      ) : null}
    </>
  )
}

/** The pill itself, while it shows. */
function Pill(props: ListeningPillProps & { onFocus?: () => void }) {
  const still = useStill()
  const { snapshot, title } = props.state
  const stopped = micIsOn(snapshot) ? null : props.state.stopped
  // One live region for the pill's life, live or stopped, so each change is said once: the line,
  // or where it stands. A problem's own alert speaks for it; the quiet stop is said here.
  const status = stopped ? (stopped.quiet ? stopped.line : '') : (lineOf(snapshot) ?? title)
  return (
    <m.div
      role="group"
      aria-label={VOICE_BAR_NAME}
      data-slot="listening-pill"
      data-phase={snapshot.phase}
      className="mt-2 flex w-[min(24rem,100%)] flex-col rounded-lg border bg-popover text-ui text-popover-foreground shadow-float"
      style={TAKES_CLICKS}
      onFocus={props.onFocus}
      initial={still ? false : { opacity: 0, y: RISE }}
      animate={{ opacity: 1, y: 0, transition: still ? INSTANT : springs.smooth }}
      exit={{ opacity: 0, transition: still ? INSTANT : springs.exit }}
    >
      <SaidStatus text={status} quiet />
      {stopped ? (
        <Stopped state={props.state} stopped={stopped} onAct={props.onAct} />
      ) : (
        <Live {...props} />
      )}
    </m.div>
  )
}

export interface ListeningPillSlotProps extends Omit<ListeningPillProps, 'state'> {
  /** The pill shows: the mic is on, or it stopped with a line the card heard it stop with. */
  shown: boolean
  /** What the bar says. Null: the bar is closed, and the pill goes. */
  state: PillState | null
  /** The focus came to the pill: the card's keys say what they do there. */
  onFocus?: () => void
}

/** The pill as it comes and goes beside the card. */
export function ListeningPill({ shown, state, ...props }: ListeningPillSlotProps) {
  return (
    <AnimatePresence>
      {shown && state ? <Pill key="listening-pill" state={state} {...props} /> : null}
    </AnimatePresence>
  )
}
