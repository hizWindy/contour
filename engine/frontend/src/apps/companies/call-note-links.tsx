/**
 * Call notes around the app (PLAN-V17 T3-7, "The screens" part 4): the count on Call logs' row in
 * the menu, the quick buttons on Home's Companies card, and "Log a call" and "Calls to confirm" in
 * Ctrl+K. Ctrl+K also gains the pre-read's entry here (T3-11, "The screens" part 7): Companies has
 * one place for its own Ctrl+K entries.
 *
 * - **Only for a person who sees Companies.** The menu, Home and Ctrl+K draw a project's parts only
 *   for the projects this person may use (`useVisibleModules`), so for anyone else none of this is
 *   drawn and no call notes or meetings request is made.
 * - **Only while call notes are on**, and a count only above 0, so a button never opens an empty
 *   tab. While the switches or the counts load or fail, nothing shows, and each place looks as it
 *   did before call notes. A 409 while they are off shows nothing either.
 * - **"Pre-read for a meeting" only while pre-meeting forms are on:** Meetings' counts answer 409
 *   while they are off, and the entry then isn't there.
 * - **"Check my mic"** (PLAN-V18 T3-4) in Ctrl+K and in the account menu opens the mic card in
 *   check only mode, from any page, through the part the frame draws (`MicCheckHost`). Only on a
 *   laptop, while call notes are on and the voice tool isn't typing. The card's own code loads the
 *   first time it is asked for.
 * - **Loaded late**, through `call-note-parts.ts`: the menu, Home and Ctrl+K are in the first visit,
 *   and this file, with its hooks, words and icons, is not. Import the parts from there, not here.
 */
import { ClipboardCheck, FileText, Mic, NotebookPen, TriangleAlert } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { Link } from 'react-router'
import {
  useCallNoteCounts,
  useCallNoteOptions,
  voiceToolOf,
  type VoiceToolKind,
} from '@/api/hooks/call-note-counts'
import { useMeetingSummary } from '@/api/hooks/meeting-summary'
import { RollingNumber } from '@/components/motion/rolling-number'
import { Button } from '@/components/ui/button'
import { CommandItem } from '@/components/ui/command'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { PHONE, useMediaQuery } from '@/lib/use-media-query'
import { MenuCount } from '@/shell/menu-count'
import type { CommandsProps } from '@/shell/nav'
import { callLogsHref } from './call-logs/params'
import { closeMicCheck, openMicCheck, useMicCheckOpen } from './call-notes/mic/check-store'
import { CHECK_MY_MIC } from './call-notes/mic/words'
import { MEETINGS_PATH } from './meetings/params'
import {
  CALLS_TO_CONFIRM,
  LOG_A_CALL,
  needsLookTail,
  PRE_READ_FOR_A_MEETING,
  toConfirmTail,
  toConfirmWords,
} from './words'

/** Call logs' row in the menu: how many calls wait to be confirmed. */
export function ToConfirmCount() {
  const { counts } = useCallNoteCounts()
  const count = counts?.to_confirm ?? 0
  return count > 0 ? <MenuCount value={count} words={toConfirmWords(count)} /> : null
}

/**
 * Home's Companies card: a button for each kind of work waiting, with its count. Each opens its
 * tab on Call logs: "7 calls to confirm" To confirm, "2 need a look" Needs a look.
 */
export function CallNoteButtons() {
  const { counts } = useCallNoteCounts()
  const toConfirm = counts?.to_confirm ?? 0
  const needsLook = counts?.needs_look ?? 0
  if (toConfirm <= 0 && needsLook <= 0) return null
  return (
    <div data-slot="call-note-buttons" className="flex flex-wrap gap-2">
      {/* 44px on a touch screen (DESIGN.md "Touch"), as Call logs' buttons are. */}
      {toConfirm > 0 ? (
        <Button asChild variant="outline" size="sm" className="touch:h-11">
          <Link to={callLogsHref('to_confirm')}>
            <ClipboardCheck aria-hidden="true" />
            <span>
              <RollingNumber value={toConfirm} /> {toConfirmTail(toConfirm)}
            </span>
          </Link>
        </Button>
      ) : null}
      {needsLook > 0 ? (
        <Button asChild variant="outline" size="sm" className="touch:h-11">
          <Link to={callLogsHref('needs_look')}>
            <TriangleAlert aria-hidden="true" />
            <span>
              <RollingNumber value={needsLook} /> {needsLookTail(needsLook)}
            </span>
          </Link>
        </Button>
      ) : null}
    </div>
  )
}

/**
 * Ctrl+K, under Companies, while call notes are on: "Log a call" opens Call logs with its company
 * picker open (the page takes the focus), and "Calls to confirm" opens To confirm. It needs only
 * the switches, not the counts.
 */
function CallNoteCommands({ go }: CommandsProps) {
  const options = useCallNoteOptions()
  if (options.data?.enabled !== true) return null
  return (
    <>
      <CommandItem
        value={LOG_A_CALL}
        keywords={['call notes', 'note', 'call logs', 'activity', 'dictate']}
        onSelect={() => {
          go(callLogsHref('to_confirm', { log: true }))
        }}
      >
        <NotebookPen aria-hidden="true" />
        <span>{LOG_A_CALL}</span>
      </CommandItem>
      <CommandItem
        value={CALLS_TO_CONFIRM}
        keywords={['call notes', 'call logs', 'activity', 'send', 'hubspot']}
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

/**
 * Ctrl+K, under Companies, while pre-meeting forms are on (T3-11): "Pre-read for a meeting" opens
 * Meetings, upcoming, where each meeting's pre-read is drafted, checked and sent.
 */
function PreReadCommand({ go }: CommandsProps) {
  const summary = useMeetingSummary()
  if (!summary.data) return null
  return (
    <CommandItem
      value={PRE_READ_FOR_A_MEETING}
      keywords={['pre-read', 'pre-meeting form', 'client meeting', 'check and send', 'teams']}
      onSelect={() => {
        go(MEETINGS_PATH)
      }}
    >
      <FileText aria-hidden="true" />
      <span>{PRE_READ_FOR_A_MEETING}</span>
    </CommandItem>
  )
}

// --- Check my mic (PLAN-V18 T3-4) -------------------------------------------------------------

/** The voice tool, while the mic can be checked here: a laptop, call notes on, not typing. */
function useCheckableTool(): VoiceToolKind | null {
  const options = useCallNoteOptions()
  const onPhone = useMediaQuery(PHONE)
  if (onPhone || options.data?.enabled !== true) return null
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

const MicCard = lazy(() => import('./call-notes/mic/mic-card'))

function MicCheckCard({ open }: { open: boolean }) {
  const options = useCallNoteOptions()
  return (
    <Suspense fallback={null}>
      <MicCard
        open={open}
        mode="check"
        tool={voiceToolOf(options.data)}
        anchor={null}
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

/** Companies' own entries in Ctrl+K: call notes', the mic check, then the pre-read's. */
export function CompaniesCommands({ go, run }: CommandsProps) {
  return (
    <>
      <CallNoteCommands go={go} run={run} />
      <MicCheckCommand run={run} />
      <PreReadCommand go={go} run={run} />
    </>
  )
}
