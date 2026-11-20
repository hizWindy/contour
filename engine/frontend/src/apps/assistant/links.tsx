/**
 * The Assistant's parts around the app (PLAN-V22 T2-1; Companies' until then, from PLAN-V17 T3-7,
 * "The screens" part 4): the count on Call logs' row in the menu, and the Assistant's own entries
 * in Ctrl+K: "Log a call", "Calls to confirm",
 * "Check my mic" and "Pre-read for a meeting" (T3-11, "The screens" part 7). The pages they open
 * keep their code in `apps/companies/` (PLAN-V22 choice 3).
 *
 * - **Only for a person who sees the Assistant** (the Call logs or the Meetings tick). The menu,
 *   Home and Ctrl+K draw a project's parts only for the projects this person may use
 *   (`useVisibleModules`), and each part checks its own tick, so for anyone else none of this is
 *   drawn and no call notes or meetings request is made. Home's quick buttons are on the
 *   Assistant's own card since PLAN-V22 T2-3 (`home-card.tsx`).
 * - **Only while call notes are on**, and a count only above 0, so a button never opens an empty
 *   tab. While the switches or the counts load or fail, nothing shows, and each place looks as it
 *   did before call notes. A 409 while they are off shows nothing either.
 * - **"Pre-read for a meeting" only while pre-meeting forms are on:** Meetings' counts answer 409
 *   while they are off, and the entry then isn't there.
 * - **"Check my mic"** (PLAN-V18 T3-4) in Ctrl+K and in the account menu opens the mic card in
 *   check only mode, from any page, through the part the frame draws (`MicCheckHost`). Only on a
 *   laptop, while call notes are on and the voice tool isn't typing. The card's own code loads the
 *   first time it is asked for.
 * - **The old words still find them.** Call logs was Activity, and Meetings and Call logs sat in a
 *   menu group called Relationships, so those words stay among the entries' keywords.
 * - **"Speak (V)"** (PLAN-V22 T3-1) in the top bar opens the voice bar, as V does. "Use V to
 *   speak" in the account menu switches the V key off and on (PLAN-V23 T4-1), and "Keep
 *   listening" beside it a long conversation (PLAN-V24 T2-5). "Get voice ready" after them
 *   downloads the model on the device ahead, where the model is the engine (PLAN-V24 T4-3).
 * - **"Add task" and "Email the team"** in Ctrl+K open the review card empty (PLAN-V23 T4-3).
 * - **Loaded late**, through `parts.ts`: the menu, Home and Ctrl+K are in the first visit, and this
 *   file, with its hooks, words and icons, is not. Import the parts from there, not here.
 */
import {
  CircleCheck,
  ClipboardCheck,
  Download,
  Ear,
  FileText,
  ListPlus,
  Mail,
  Mic,
  NotebookPen,
  Speech,
} from 'lucide-react'
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useCallNoteCounts, useCallNoteOptions, voiceToolOf } from '@/api/hooks/call-note-counts'
import { useMeetingSummary } from '@/api/hooks/meeting-summary'
import type { VoiceToolKind } from '@/api/types'
import { callLogsHref } from '@/apps/companies/call-logs/params'
import {
  closeMicCheck,
  openMicCheck,
  useMicCheckOpen,
} from '@/apps/companies/call-notes/mic/check-store'
import { browserFacts, deviceKind, pickEngine } from '@/apps/companies/call-notes/mic/voice-engine'
import { fetchVoice, lookAtVoice, useVoiceReady } from '@/apps/companies/call-notes/mic/voice-ready'
import {
  CHECK_MY_MIC,
  downloadedOf,
  GETTING_VOICE_READY,
} from '@/apps/companies/call-notes/mic/words'
import {
  CALLS_TO_CONFIRM,
  LOG_A_CALL,
  PRE_READ_FOR_A_MEETING,
  toConfirmWords,
} from '@/apps/companies/words'
import { useCan, useCanWrite, useIsViewer } from '@/auth/can'
import { Button } from '@/components/ui/button'
import { CommandItem } from '@/components/ui/command'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Kbd } from '@/components/ui/kbd'
import { SwitchMark } from '@/components/ui/switch'
import { PHONE, useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { MenuCount } from '@/shell/menu-count'
import type { CommandsProps } from '@/shell/nav'
import { openCard } from './card/store'
import { MEETINGS_PATH } from './paths'
import { setKeepListening, useKeepListening } from './voice/keep-listening'
import { openVoiceBar } from './voice/store'
import { setVKeyOn, useVKeyOn } from './voice/v-switch'
import {
  GET_READY_FAILED,
  GET_VOICE_READY,
  getReadyHint,
  KEEP_LISTENING,
  SPEAK,
  SPEAK_KEY,
  USE_V,
  voiceReadyOn,
} from './voice/words'
import { ADD_TASK, ASSISTANT_KEYWORDS, EMAIL_THE_TEAM } from './words'

function ToConfirmCountContent() {
  const { counts } = useCallNoteCounts()
  const count = counts?.to_confirm ?? 0
  return count > 0 ? <MenuCount value={count} words={toConfirmWords(count)} /> : null
}

/** Call logs' row in the menu: how many calls wait to be confirmed. */
export function ToConfirmCount() {
  if (!useCan('companies.call_logs')) return null
  return <ToConfirmCountContent />
}

/**
 * Ctrl+K, under the Assistant, while call notes are on: "Log a call" opens Call logs with its
 * company picker open (the page takes the focus), and "Calls to confirm" opens To confirm. It needs
 * only the switches, not the counts.
 */
function CallNoteCommands({ go }: CommandsProps) {
  const canSeeLogs = useCan('companies.call_logs')
  const options = useCallNoteOptions(canSeeLogs)
  const viewer = useIsViewer()
  const canCallLogs = useCanWrite('companies.call_logs')
  if (!canSeeLogs || options.data?.enabled !== true) return null
  return (
    <>
      {!viewer && canCallLogs ? (
        <CommandItem
          value={LOG_A_CALL}
          keywords={[
            'call notes',
            'note',
            'call logs',
            'activity',
            'dictate',
            ...ASSISTANT_KEYWORDS,
          ]}
          onSelect={() => {
            go(callLogsHref('to_confirm', { log: true }))
          }}
        >
          <NotebookPen aria-hidden="true" />
          <span>{LOG_A_CALL}</span>
        </CommandItem>
      ) : null}
      <CommandItem
        value={CALLS_TO_CONFIRM}
        keywords={['call notes', 'call logs', 'activity', 'send', 'hubspot', ...ASSISTANT_KEYWORDS]}
        onSelect={() => {
          go(callLogsHref('to_confirm'))
        }}
      >
        <ClipboardCheck aria-hidden="true" />
        <span>{CALLS_TO_CONFIRM}</span>
      </CommandItem>
    </>
  )
}

function PreReadCommandContent({ go }: Pick<CommandsProps, 'go'>) {
  const summary = useMeetingSummary()
  if (!summary.data) return null
  return (
    <CommandItem
      value={PRE_READ_FOR_A_MEETING}
      keywords={[
        'pre-read',
        'pre-meeting form',
        'meetings',
        'client meeting',
        'check and send',
        'teams',
        ...ASSISTANT_KEYWORDS,
      ]}
      onSelect={() => {
        go(MEETINGS_PATH)
      }}
    >
      <FileText aria-hidden="true" />
      <span>{PRE_READ_FOR_A_MEETING}</span>
    </CommandItem>
  )
}

/**
 * Ctrl+K, under the Assistant, while pre-meeting forms are on (T3-11): "Pre-read for a meeting"
 * opens Meetings, upcoming, where each meeting's pre-read is drafted, checked and sent.
 */
function PreReadCommand({ go }: Pick<CommandsProps, 'go'>) {
  if (!useCan('companies.meetings')) return null
  return <PreReadCommandContent go={go} />
}

// --- Check my mic (PLAN-V18 T3-4) -------------------------------------------------------------

/** The voice tool, while the mic can be checked here: a laptop, call notes on, not typing. */
function useCheckableTool(): VoiceToolKind | null {
  const canLog = useCanWrite('companies.call_logs')
  const options = useCallNoteOptions(canLog)
  const onPhone = useMediaQuery(PHONE)
  if (!canLog || onPhone || options.data?.enabled !== true) return null
  const tool = voiceToolOf(options.data)
  return tool === 'typing' ? null : tool
}

const MIC_WORDS = ['mic', 'microphone', 'headset', 'speak', 'dictate', 'test', 'sound']

/** Ctrl+K: "Check my mic". */
function MicCheckCommand({ run }: Pick<CommandsProps, 'run'>) {
  if (!useCheckableTool()) return null
  return (
    <CommandItem
      value={CHECK_MY_MIC}
      keywords={MIC_WORDS}
      onSelect={() => {
        run(openMicCheck)
      }}
    >
      <Mic aria-hidden="true" />
      <span>{CHECK_MY_MIC}</span>
    </CommandItem>
  )
}

/** The account menu: "Check my mic", before "Sign out". */
export function MicCheckMenuItem() {
  if (!useCheckableTool()) return null
  return (
    <DropdownMenuItem
      className="touch:min-h-11"
      onSelect={() => {
        // After the menu has shut and given the focus back, so the card keeps it.
        window.setTimeout(openMicCheck, 0)
      }}
    >
      <Mic aria-hidden="true" />
      {CHECK_MY_MIC}
    </DropdownMenuItem>
  )
}

const MicCard = lazy(() => import('@/apps/companies/call-notes/mic/mic-card'))

function MicCheckCard({ open }: { open: boolean }) {
  const canLog = useCanWrite('companies.call_logs')
  const options = useCallNoteOptions(canLog)
  return (
    <Suspense fallback={null}>
      <MicCard
        open={open}
        mode="check"
        tool={voiceToolOf(options.data)}
        opener={null}
        onClose={closeMicCheck}
      />
    </Suspense>
  )
}

/**
 * Drawn once in the frame: the mic card in check only mode, when Ctrl+K or the account menu asks.
 * Nothing is drawn, and nothing downloads, until the first ask.
 */
export function MicCheckHost() {
  const open = useMicCheckOpen()
  const [asked, setAsked] = useState(false)
  if (open && !asked) setAsked(true)
  return asked ? <MicCheckCard open={open} /> : null
}

// --- Speak (PLAN-V22 T3-1) ----------------------------------------------------------------------

/**
 * The top bar's mic button (choice 13): "Speak (V)" opens the voice bar, as V does, on every page.
 * On a phone it is the mic alone, and on a touch screen it is 44px, square with the 10px corner
 * (DESIGN.md: the mic button is square). Not for a Viewer (choice 18).
 */
export function SpeakButton() {
  const viewer = useIsViewer()
  // "Use V to speak" off (PLAN-V23 T4-1): the button says "Speak", with no key, and still works.
  const vOn = useVKeyOn()
  if (viewer) return null
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-2 text-muted-foreground touch:h-11 max-sm:w-10 max-sm:px-0 max-sm:touch:w-11"
      // "Speak (V)": the word on it, and its key.
      aria-label={vOn ? `${SPEAK} ${SPEAK_KEY}` : SPEAK}
      aria-keyshortcuts={vOn ? 'V' : undefined}
      onClick={openVoiceBar}
    >
      <Mic aria-hidden="true" />
      <span aria-hidden="true" className="max-sm:hidden">
        {SPEAK}
      </span>
      {vOn ? (
        <Kbd aria-hidden="true" className="touch:hidden max-sm:hidden">
          V
        </Kbd>
      ) : null}
    </Button>
  )
}

/**
 * "Use V to speak" (PLAN-V23 T4-1, from WCAG 2.2 rule 2.1.4: a one-letter shortcut must be able to
 * be switched off), in the account menu, with the sliding switch's look. The row is the control,
 * so a screen reader hears a menu checkbox, on or off. The menu stays open as it is pressed, so
 * the switch is seen to move. Kept in this browser (`voice/v-switch.ts`). Not for a Viewer, who
 * has no V (choice 18).
 */
export function VKeyMenuItem() {
  const viewer = useIsViewer()
  const on = useVKeyOn()
  if (viewer) return null
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="v-key-switch"
      checked={on}
      onCheckedChange={(checked) => {
        setVKeyOn(checked)
      }}
      onSelect={(event) => {
        event.preventDefault()
      }}
      className="relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-ui outline-hidden select-none focus:bg-accent focus:text-accent-foreground touch:min-h-11 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
    >
      <Speech aria-hidden="true" />
      <span className="flex-1">{USE_V}</span>
      <SwitchMark checked={on} />
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

/**
 * "Keep listening" (PLAN-V24 choice 6, T2-5), beside "Use V to speak" and with the same look: on,
 * one V (or Speak) listens across commands until it is stopped; off, one command per V, as before.
 * On by default, and kept in this browser (`voice/keep-listening.ts`). Not for a Viewer, who has no
 * mic (choice 18).
 */
export function KeepListeningMenuItem() {
  const viewer = useIsViewer()
  const on = useKeepListening()
  if (viewer) return null
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="keep-listening-switch"
      checked={on}
      onCheckedChange={(checked) => {
        setKeepListening(checked)
      }}
      onSelect={(event) => {
        event.preventDefault()
      }}
      className="relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-ui outline-hidden select-none focus:bg-accent focus:text-accent-foreground touch:min-h-11 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
    >
      <Ear aria-hidden="true" />
      <span className="flex-1">{KEEP_LISTENING}</span>
      <SwitchMark checked={on} />
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

/**
 * "Get voice ready" (PLAN-V24 T4-3, choice 25), after "Keep listening": downloads the model on the
 * device ahead of the first Speak, best on Wi-Fi, without loading it. Only where the model is, or
 * would be, the engine (choice 22), once the setting is known, and not for a Viewer, who has no
 * mic. The menu stays open as it is pressed, so the download is seen to start, and it goes on if
 * the menu shuts. Once this browser keeps the files, the row says so plainly, with a tick.
 */
export function VoiceReadyMenuItem() {
  const viewer = useIsViewer()
  const options = useCallNoteOptions(!viewer)
  const setting = options.data?.voice_tool ?? null
  const model = !viewer && setting !== null && pickEngine(setting) === 'model'
  const ready = useVoiceReady()
  const [device] = useState(() => deviceKind(browserFacts()))
  useEffect(() => {
    if (model) void lookAtVoice()
  }, [model])
  if (!model) return null
  if (ready.state === 'kept') {
    return (
      // Nothing to do, but still reached by the keys and read out, as unavailable: at full
      // strength, so it is read plainly.
      <DropdownMenuItem
        aria-disabled
        data-slot="voice-ready"
        className="touch:min-h-11"
        onSelect={(event) => {
          event.preventDefault()
        }}
      >
        <CircleCheck aria-hidden="true" className="text-pass-ink" />
        {voiceReadyOn(device)}
      </DropdownMenuItem>
    )
  }
  const downloading = ready.state === 'downloading'
  const hint = downloading
    ? downloadedOf(ready.loaded, ready.total)
    : ready.state === 'failed'
      ? GET_READY_FAILED
      : getReadyHint(ready.state === 'missing' ? ready.bytes : null)
  return (
    <DropdownMenuItem
      data-slot="voice-ready"
      aria-disabled={downloading ? true : undefined}
      className="items-start touch:min-h-11"
      onSelect={(event) => {
        // The menu stays open, so the download is seen to start.
        event.preventDefault()
        if (!downloading) void fetchVoice().catch(() => undefined)
      }}
    >
      <Download aria-hidden="true" className="mt-0.5" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span>{downloading ? GETTING_VOICE_READY : GET_VOICE_READY}</span>
        <span
          className={cn(
            'text-caption text-pretty',
            ready.state === 'failed' ? 'text-destructive-ink' : 'text-muted-foreground',
            downloading && 'tabular-nums',
          )}
        >
          {hint}
        </span>
      </span>
    </DropdownMenuItem>
  )
}

/**
 * The Assistant's rows in the account menu: "Use V to speak" and "Keep listening", "Get voice
 * ready" where the model is the engine, then "Check my mic".
 */
export function AssistantAccountItems() {
  return (
    <>
      <VKeyMenuItem />
      <KeepListeningMenuItem />
      <VoiceReadyMenuItem />
      <MicCheckMenuItem />
    </>
  )
}

/**
 * Ctrl+K, under the Assistant: "Add task" and "Email the team" open the review card empty, as
 * Today's buttons do (PLAN-V23 T4-3). No AI reads anything, so they work while it is off or busy.
 * Not for a Viewer, who sends nothing.
 */
function CardCommands({ run }: Pick<CommandsProps, 'run'>) {
  // Whoever may send from the Assistant: the Call logs or Meetings tick, and not a Viewer.
  if (!useCanWrite('companies.call_logs', 'companies.meetings')) return null
  return (
    <>
      <CommandItem
        value={ADD_TASK}
        keywords={['task', 'to do', 'todo', 'hubspot task', 'reminder', ...ASSISTANT_KEYWORDS]}
        onSelect={() => {
          run(() => {
            openCard({ kind: 'empty', action: 'task' })
          })
        }}
      >
        <ListPlus aria-hidden="true" />
        <span>{ADD_TASK}</span>
      </CommandItem>
      <CommandItem
        value={EMAIL_THE_TEAM}
        keywords={['email', 'mail', 'message', 'teammate', ...ASSISTANT_KEYWORDS]}
        onSelect={() => {
          run(() => {
            openCard({ kind: 'empty', action: 'email' })
          })
        }}
      >
        <Mail aria-hidden="true" />
        <span>{EMAIL_THE_TEAM}</span>
      </CommandItem>
    </>
  )
}

/**
 * The Assistant's own entries in Ctrl+K, after its pages: call notes', the empty cards, the mic
 * check, then the pre-read's. The pre-read's comes last because it waits for one more answer
 * (Meetings' counts), so its coming moves no other entry.
 */
export function AssistantCommands({ go, run }: CommandsProps) {
  return (
    <>
      <CallNoteCommands go={go} run={run} />
      <CardCommands run={run} />
      <MicCheckCommand run={run} />
      <PreReadCommand go={go} />
    </>
  )
}
