/**
 * Home's "Upcoming meetings" card (PLAN-V17 T3-11, "The screens" part 7): the rep's next three
 * client meetings, each with its status and one button, as on Meetings (`row-parts.tsx`), under
 * one sentence with what needs doing in the next 7 days.
 *
 * - **Who sees it:** only a person who sees Companies (Home draws a project's cards only for
 *   them), and only while pre-meeting forms are on. The counts answer 409 while they are off, and
 *   the card then draws nothing: Home looks as it did before.
 * - **It comes late,** after the counts and then the meetings, so Home places it after every other
 *   card (`HomeCard.late`), and its coming moves none of them. It fades and rises once as it comes.
 *   Its code loads late too (`call-note-parts.ts`), so the first visit doesn't grow.
 * - **The meetings** are the list Meetings shows first (the rep's own, upcoming), so opening
 *   Meetings from here shows it at once. A cancelled meeting needs nothing, so it isn't one of the
 *   three.
 * - **Empty:** "No meetings in the next few days." in the serif voice. While HubSpot's meetings
 *   can't be read, or the rep's own can't be picked out, the server's sentence says so under it.
 *   A list that fails says so in one quiet line.
 */
import { ArrowRight, CalendarCheck, Hourglass } from 'lucide-react'
import { Link } from 'react-router'
import { isMeetingFormsOff, useMeetings, useMeetingSummary } from '@/api/hooks/meetings'
import type { MeetingItem } from '@/api/v17'
// By its own file: the kit's index would bring every part into this late file.
import { Reveal } from '@/components/motion/reveal'
import { Card } from '@/components/ui/card'
import { melbourneDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { TONE_CLASSES } from '@/shell/tone'
import { FIRST_VIEW, meetingsQuery, MEETINGS_PATH } from './params'
import { RowAction, StatusLine } from './row-parts'
import { isCancelled, rowKey, rowStatus } from './rows'
import { useDraftIt } from './use-draft-it'
import {
  MEETINGS_NOT_LOADED,
  meetingDay,
  NO_MEETINGS_SOON,
  NO_MEETINGS_SOON_NOTE,
  OPEN_MEETINGS,
  UPCOMING_MEETINGS,
  upcomingSentence,
} from './words'

const TITLE_ID = 'home-meetings'

/** How many of the next meetings the card shows. */
const SHOWN = 3

/** Ends a sentence that has no stop yet. */
function sentence(text: string): string {
  const trimmed = text.trim()
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

function UpcomingRow({ item, today }: { item: MeetingItem; today: string }) {
  const draftIt = useDraftIt(item)
  const status = draftIt.pending ? 'drafting' : rowStatus(item, false)
  const when = meetingDay(item.meeting.starts_at, today)
  return (
    <li data-slot="upcoming-meeting" className="flex flex-col gap-2 px-6 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-caption text-muted-foreground tabular-nums">{when}</p>
        <p className="font-semibold break-words text-foreground">{item.company_name}</p>
        {item.meeting.title.trim() ? (
          <p className="line-clamp-1 text-ui break-words text-foreground">{item.meeting.title}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <StatusLine status={status} />
        <RowAction
          item={item}
          status={status}
          past={false}
          draftIt={draftIt}
          context={`: ${item.company_name}, ${when}`}
        />
      </div>
    </li>
  )
}

export function UpcomingMeetings() {
  const summary = useMeetingSummary()
  const on = summary.data !== undefined
  const list = useMeetings(meetingsQuery(FIRST_VIEW), { enabled: on })
  const today = melbourneDate()
  // Off, unknown, or on its way: nothing, so Home looks as it did before.
  if (!summary.data || list.isPending || isMeetingFormsOff(list.error)) return null

  const words = upcomingSentence(summary.data.need_pre_read, summary.data.draft_ready)
  const page = list.data
  const shown = page ? page.items.filter((item) => !isCancelled(item)).slice(0, SHOWN) : []
  const waiting = page?.sentence?.trim() ? sentence(page.sentence) : null

  let body
  if (!page) {
    body = <p className="px-6 text-ui text-muted-foreground">{MEETINGS_NOT_LOADED}</p>
  } else if (shown.length === 0) {
    body = (
      <div className="flex flex-col gap-1 px-6">
        <p className="font-serif text-ui text-muted-foreground">{NO_MEETINGS_SOON}</p>
        {waiting ? null : (
          <p className="text-caption text-muted-foreground">{NO_MEETINGS_SOON_NOTE}</p>
        )}
      </div>
    )
  } else {
    body = (
      <ul className="flex flex-col divide-y border-t text-ui">
        {shown.map((item) => (
          <UpcomingRow key={rowKey(item)} item={item} today={today} />
        ))}
      </ul>
    )
  }

  return (
    <Reveal className="h-full">
      <Card role="region" aria-labelledby={TITLE_ID} className="h-full gap-4">
        <div className="flex items-center gap-3 px-6">
          <span
            aria-hidden="true"
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-lg',
              TONE_CLASSES.companies.tile,
            )}
          >
            <CalendarCheck className="size-5" />
          </span>
          <h2 id={TITLE_ID} className="flex-1 text-section font-semibold text-foreground">
            {UPCOMING_MEETINGS}
          </h2>
          <Link
            to={MEETINGS_PATH}
            aria-label={OPEN_MEETINGS}
            className="inline-flex shrink-0 items-center gap-1 rounded-sm text-ui text-link underline-offset-4 hover:underline"
          >
            Open
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
        {words ? <p className="px-6 text-ui text-foreground">{words}</p> : null}
        {waiting ? (
          <p
            role="status"
            className="flex items-start gap-2 px-6 text-caption text-muted-foreground"
          >
            <Hourglass aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            {waiting}
          </p>
        ) : null}
        {body}
      </Card>
    </Reveal>
  )
}
