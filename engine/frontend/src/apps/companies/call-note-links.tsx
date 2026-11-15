/**
 * Call notes around the app (PLAN-V17 T3-7, "The screens" part 4): the count on Activity's row in
 * the menu, the quick buttons on Home's Companies card, and "Log a call" and "Calls to confirm" in
 * Ctrl+K.
 *
 * - **Only for a person who sees Companies.** The menu, Home and Ctrl+K draw a project's parts only
 *   for the projects this person may use (`useVisibleModules`), so for anyone else none of this is
 *   drawn and no call notes request is made.
 * - **Only while call notes are on**, and a count only above 0, so a button never opens an empty
 *   tab. While the switches or the counts load or fail, nothing shows, and each place looks as it
 *   did before call notes. A 409 while they are off shows nothing either.
 * - **Loaded late**, through `call-note-parts.ts`: the menu, Home and Ctrl+K are in the first visit,
 *   and this file, with its hooks, words and icons, is not. Import the parts from there, not here.
 */
import { ClipboardCheck, NotebookPen, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router'
import { useCallNoteCounts, useCallNoteOptions } from '@/api/hooks/call-note-counts'
import { RollingNumber } from '@/components/motion/rolling-number'
import { Button } from '@/components/ui/button'
import { CommandItem } from '@/components/ui/command'
import { MenuCount } from '@/shell/menu-count'
import type { CommandsProps } from '@/shell/nav'
import { activityHref } from './activity/params'
import { CALLS_TO_CONFIRM, LOG_A_CALL, needsLookTail, toConfirmTail, toConfirmWords } from './words'

/** Activity's row in the menu: how many calls wait to be confirmed. */
export function ToConfirmCount() {
  const { counts } = useCallNoteCounts()
  const count = counts?.to_confirm ?? 0
  return count > 0 ? <MenuCount value={count} words={toConfirmWords(count)} /> : null
}

/**
 * Home's Companies card: a button for each kind of work waiting, with its count. Each opens its
 * tab on Activity: "7 calls to confirm" To confirm, "2 need a look" Needs a look.
 */
export function CallNoteButtons() {
  const { counts } = useCallNoteCounts()
  const toConfirm = counts?.to_confirm ?? 0
  const needsLook = counts?.needs_look ?? 0
  if (toConfirm <= 0 && needsLook <= 0) return null
  return (
    <div data-slot="call-note-buttons" className="flex flex-wrap gap-2">
      {/* 44px on a touch screen (DESIGN.md "Touch"), as Activity's buttons are. */}
      {toConfirm > 0 ? (
        <Button asChild variant="outline" size="sm" className="touch:h-11">
          <Link to={activityHref('to_confirm')}>
            <ClipboardCheck aria-hidden="true" />
            <span>
              <RollingNumber value={toConfirm} /> {toConfirmTail(toConfirm)}
            </span>
          </Link>
        </Button>
      ) : null}
      {needsLook > 0 ? (
        <Button asChild variant="outline" size="sm" className="touch:h-11">
          <Link to={activityHref('needs_look')}>
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
 * Ctrl+K, under Companies, while call notes are on: "Log a call" opens Activity with its company
 * picker open (the page takes the focus), and "Calls to confirm" opens To confirm. It needs only
 * the switches, not the counts.
 */
export function CallNoteCommands({ go }: CommandsProps) {
  const options = useCallNoteOptions()
  if (options.data?.enabled !== true) return null
  return (
    <>
      <CommandItem
        value={LOG_A_CALL}
        keywords={['call notes', 'note', 'activity', 'dictate']}
        onSelect={() => {
          go(activityHref('to_confirm', { log: true }))
        }}
      >
        <NotebookPen aria-hidden="true" />
        <span>{LOG_A_CALL}</span>
      </CommandItem>
      <CommandItem
        value={CALLS_TO_CONFIRM}
        keywords={['call notes', 'activity', 'send', 'hubspot']}
        onSelect={() => {
          go(activityHref('to_confirm'))
        }}
      >
        <ClipboardCheck aria-hidden="true" />
        <span>{CALLS_TO_CONFIRM}</span>
      </CommandItem>
    </>
  )
}
