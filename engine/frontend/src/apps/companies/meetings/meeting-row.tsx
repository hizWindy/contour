/**
 * One meeting on Meetings (PLAN-V17 "The screens", part 5): when, the company, the title, Teams or
 * in person, then one status and one button (`row-parts.tsx`). A list used all day barely moves
 * (principles 02 #20), so a row never fades, slides or glides: a new status simply shows.
 *
 * - **Needs pre-read:** "Draft it" starts the form, then the pre-read's page opens. While the
 *   server answers, the row already says "Drafting". If it says no, the row goes back and a toast
 *   says why (`use-draft-it.ts`).
 * - **Drafting, Sent, Draft failed:** "Open". **Draft ready:** "Check and send". Both open the
 *   pre-read's page.
 * - **A past meeting** says whether what was said is logged, with "Log meeting" (T3-11), which
 *   opens the transcript box (`log-meeting.tsx`). It stays after the notes are logged, for a second
 *   part of the meeting. One typed in with New pre-read isn't in HubSpot, so it has no notes to
 *   log: it says where its pre-read stands, with "Open".
 * - **A cancelled meeting** says "Cancelled", dimmed with the quieter text colour, never lower
 *   opacity, so every line stays readable (as a card left out of a batch is). It keeps "Open"
 *   while it has a pre-read.
 * - **The team's list** says whose each meeting is: its owner, as our copy of HubSpot names them
 *   (`owner_name`, T3-11). Nothing shows when the server doesn't know.
 *
 * Each button's name ends with the meeting ("Draft it: Sample Logistics Pty Ltd, 10:00 am") for a
 * screen reader, which hears many such buttons in a list.
 */
import { MapPin, UserRound, Video } from 'lucide-react'
import type { MeetingItem } from '@/api/types'
import { cn } from '@/lib/utils'
import { RowAction, StatusLine } from './row-parts'
import { rowStatus, type RowStatus } from './rows'
import { useDraftIt } from './use-draft-it'
import { whereWords, WHOSE } from './words'

export interface MeetingRowProps {
  item: MeetingItem
  /** When it is, as its group writes it: "10:00 am", "Thu, 10:00 am", "Yesterday, 4:00 pm". */
  when: string
  past: boolean
  /** The team's list: the row says whose meeting it is. */
  team?: boolean
  /** "Log meeting" on a past meeting. Left out: call notes are off, and there is none. */
  onLogMeeting?: (item: MeetingItem) => void
}

export function MeetingRow({ item, when, past, team = false, onLogMeeting }: MeetingRowProps) {
  const draftIt = useDraftIt(item)
  const { meeting } = item
  // "Draft it" shows its result at once: the row says Drafting while the server answers.
  const status: RowStatus = draftIt.pending ? 'drafting' : rowStatus(item, past)
  const cancelled = status === 'cancelled'
  // Teams, Zoom, Google Meet or In person; nothing when it isn't known.
  const where = whereWords(meeting)
  const WhereIcon = meeting.where === 'online' ? Video : MapPin
  const owner = team ? item.owner_name?.trim() || null : null

  return (
    <li
      data-slot="meeting-row"
      data-status={status}
      className="flex flex-col gap-2 px-4 py-3 sm:grid sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4"
    >
      <p
        className={cn(
          'text-ui tabular-nums',
          cancelled ? 'text-muted-foreground' : 'text-foreground',
        )}
      >
        {when}
      </p>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p
          className={cn(
            'font-semibold break-words',
            cancelled ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {item.company_name}
        </p>
        {meeting.title.trim() ? (
          <p
            className={cn(
              'line-clamp-1 break-words',
              cancelled ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            {meeting.title}
          </p>
        ) : null}
        {where || owner ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-caption text-muted-foreground">
            {where ? (
              <span className="flex items-center gap-1.5">
                <WhereIcon aria-hidden="true" className="size-3.5 shrink-0" />
                {where}
              </span>
            ) : null}
            {owner ? (
              <span data-slot="meeting-owner" className="flex min-w-0 items-center gap-1.5">
                <UserRound aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="sr-only">{WHOSE} </span>
                <span className="break-words">{owner}</span>
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 sm:w-72 sm:flex-nowrap">
        <StatusLine status={status} />
        <RowAction
          item={item}
          status={status}
          past={past}
          draftIt={draftIt}
          context={`: ${item.company_name}, ${when}`}
          onLogMeeting={onLogMeeting}
        />
      </div>
    </li>
  )
}
