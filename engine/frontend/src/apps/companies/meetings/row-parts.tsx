/**
 * The parts a meeting's row shows wherever it is (PLAN-V17 "The screens", parts 5 and 7): its one
 * status, as an icon and a word, and its one button. Meetings' rows and Home's "Upcoming meetings"
 * card use the same ones (DESIGN.md "Same thing, same look").
 *
 * - **Upcoming:** "Draft it" with no pre-read yet, "Check and send" for a draft ready, and "Open"
 *   for the rest. A cancelled meeting has no Draft it.
 * - **Past** (T3-11): "Log meeting" on a meeting from HubSpot that wasn't cancelled, while call
 *   notes are on (`onLogMeeting`). A meeting typed in isn't in HubSpot, so it has none: it has
 *   "Open", for its pre-read.
 *
 * Each button's name ends with the meeting (`context`, for a screen reader, which hears many such
 * buttons in a list). "Draft it" says that AI drafts it and the rep checks it first, as its
 * description: a tooltip for the pointer, and words a screen reader hears after its name
 * (PLAN-V18 T2-4).
 */
import { useId } from 'react'
import { Link } from 'react-router'
import type { MeetingItem } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { preReadHref } from './params'
import type { RowStatus } from './rows'
import { STATUS_LOOK } from './status-look'
import type { DraftIt } from './use-draft-it'
import { CHECK_AND_SEND, DRAFT_IT, DRAFT_IT_NOTE, LOG_MEETING, OPEN, STATUS_WORDS } from './words'

/** A row's one status: an icon and a word, never colour alone. */
export function StatusLine({ status }: { status: RowStatus }) {
  const { icon: Icon, ink } = STATUS_LOOK[status]
  return (
    <p className={cn('flex items-center gap-1.5 text-caption', ink)}>
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {STATUS_WORDS[status]}
    </p>
  )
}

export interface RowActionProps {
  item: MeetingItem
  status: RowStatus
  past: boolean
  draftIt: DraftIt
  /** What a screen reader hears after the button's word: ": Sample Logistics Pty Ltd, 10:00 am". */
  context: string
  /** "Log meeting" on a past meeting. Left out: call notes are off, and there is none. */
  onLogMeeting?: (item: MeetingItem) => void
}

/** A row's one button, or nothing. */
export function RowAction({ item, status, past, draftIt, context, onLogMeeting }: RowActionProps) {
  const noteId = useId()
  const heard = <span className="sr-only">{context}</span>
  if (past && !item.typed) {
    if (!onLogMeeting || item.meeting.id === '' || status === 'cancelled') return null
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="touch:h-11"
        onClick={() => {
          onLogMeeting(item)
        }}
      >
        {LOG_MEETING}
        {heard}
      </Button>
    )
  }
  if (item.form && !draftIt.pending) {
    return (
      <Button asChild variant="outline" size="sm" className="touch:h-11">
        <Link to={preReadHref(item.form.id)}>
          {status === 'draft' && !past ? CHECK_AND_SEND : OPEN}
          {heard}
        </Link>
      </Button>
    )
  }
  if (!past && status !== 'cancelled' && draftIt.possible) {
    return (
      <>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="touch:h-11"
              disabled={draftIt.pending}
              aria-describedby={noteId}
              onClick={draftIt.draft}
            >
              {DRAFT_IT}
              {heard}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{DRAFT_IT_NOTE}</TooltipContent>
        </Tooltip>
        {/* Beside the button, not in it: inside, it would be read as part of its name. */}
        <span id={noteId} className="sr-only">
          {DRAFT_IT_NOTE}
        </span>
      </>
    )
  }
  return null
}
