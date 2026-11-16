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
 * - **Loaded late**, through `call-note-parts.ts`: the menu, Home and Ctrl+K are in the first visit,
 *   and this file, with its hooks, words and icons, is not. Import the parts from there, not here.
 */
import { ClipboardCheck, FileText, NotebookPen, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router'
import { useCallNoteCounts, useCallNoteOptions } from '@/api/hooks/call-note-counts'
import { useMeetingSummary } from '@/api/hooks/meeting-summary'
import { RollingNumber } from '@/components/motion/rolling-number'
import { Button } from '@/components/ui/button'
import { CommandItem } from '@/components/ui/command'
import { MenuCount } from '@/shell/menu-count'
import type { CommandsProps } from '@/shell/nav'
import { callLogsHref } from './call-logs/params'
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

/** Companies' own entries in Ctrl+K: call notes', then the pre-read's. */
export function CompaniesCommands({ go }: CommandsProps) {
  return (
    <>
      <CallNoteCommands go={go} />
      <PreReadCommand go={go} />
    </>
  )
}
