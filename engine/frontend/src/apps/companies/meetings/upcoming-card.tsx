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
 * - **The meetings** are the rep's own, upcoming: My meetings on Meetings, which shows everyone's
 *   first (PLAN-V18 T2-3). The card's sentence counts the rep's own, so its rows are the rep's own
 *   too (TBC at Al-khair's look). With sign-in off there is no "me" and the counts cover everyone's,
 *   so the rows are everyone's (All), as Meetings shows then. A cancelled meeting needs nothing, so
 *   it isn't one of the three.
 * - **Empty:** "No meetings in the next few days." in the serif voice. While HubSpot's meetings
 *   can't be read, or the rep's own can't be picked out, the server's sentence says so under it,
 *   in Meetings' own quiet line (`WaitingLine`). A list that fails says so in one quiet line.
 * - **The rep's own can't be picked out** (their account isn't linked to a HubSpot owner): the
 *   sentence says All shows everyone's, so "Show all meetings" under it opens Meetings, on All.
 *
 * **The first visit:** this file's imports decide how the bundler (Rolldown) splits the code that
 * every first visit loads, so three of them are chosen by measuring (`node
 * scripts/bundle-report.js`, T3-11). Importing the Card part, or Reveal by its own file, from here
 * split five small parts out of the main file into files of their own: the first visit grew from 34
 * files to 39 and by about 1.6 kB gzip, though no byte of this card was in it. So the card draws
 * the Card part's own classes, and takes Reveal from the motion kit's index, as Home does (Home
 * loads that file already). Using Meetings' `states.tsx` keeps two icons in one file, as before.
 */
import { ArrowRight, CalendarCheck } from 'lucide-react'
import { Link } from 'react-router'
import { useMe } from '@/api/hooks'
import { isMeetingFormsOff, useMeetings, useMeetingSummary } from '@/api/hooks/meetings'
import type { MeetingItem } from '@/api/types'
import { Reveal } from '@/components/motion'
import { melbourneDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { TONE_CLASSES } from '@/shell/tone'
import { FIRST_VIEW, meetingsQuery, MEETINGS_PATH, type MeetingsView } from './params'
import { RowAction, StatusLine } from './row-parts'
import { isCancelled, rowKey, rowStatus } from './rows'
import { WaitingLine } from './states'
import { useDraftIt } from './use-draft-it'
import {
  MEETINGS_NOT_LOADED,
  meetingDay,
  NO_MEETINGS_SOON,
  NO_MEETINGS_SOON_NOTE,
  OPEN_MEETINGS,
  SHOW_ALL,
  UPCOMING_MEETINGS,
  upcomingSentence,
} from './words'

const TITLE_ID = 'home-meetings'

/** How many of the next meetings the card shows. */
const SHOWN = 3

/**
 * The Card part's own classes (`components/ui/card.tsx`), drawn here instead of importing the part:
 * see "The first visit" above. Keep them the same as the part's.
 */
const CARD =
  'flex h-full flex-col gap-4 overflow-hidden rounded-lg border bg-card py-6 text-ui text-card-foreground'

/** A link to another page, which ends in an arrow (DESIGN.md "Home"). */
const LINK =
  'inline-flex shrink-0 items-center gap-1 rounded-sm text-ui text-link underline-offset-4 hover:underline'

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
        <StatusLine status={status} form={item.form} />
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

/**
 * Whose upcoming meetings the card lists: the rep's own (My meetings), as its sentence counts them.
 * With sign-in off there is no "me", and the counts cover everyone's, so it lists All, as Meetings
 * does then.
 */
function homeView(signInOff: boolean): MeetingsView {
  return { ...FIRST_VIEW, who: signInOff ? 'all' : 'mine' }
}

export function UpcomingMeetings() {
  const summary = useMeetingSummary()
  const on = summary.data !== undefined
  const view = homeView(useMe().data?.state === 'off')
  const list = useMeetings(meetingsQuery(view), { enabled: on })
  const today = melbourneDate()
  // Off, unknown, or on its way: nothing, so Home looks as it did before.
  if (!summary.data || list.isPending || isMeetingFormsOff(list.error)) return null

  const words = upcomingSentence(summary.data.need_pre_read, summary.data.draft_ready)
  const page = list.data
  const shown = page ? page.items.filter((item) => !isCancelled(item)).slice(0, SHOWN) : []
  const waiting = page?.sentence?.trim() || null
  // My meetings can't pick out the rep's own: the sentence says All shows everyone's, and All is
  // on Meetings.
  const showAll = waiting !== null && view.who === 'mine' && page?.meetings_state === 'ready'

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
      <section data-slot="card" aria-labelledby={TITLE_ID} className={CARD}>
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
          <Link to={MEETINGS_PATH} aria-label={OPEN_MEETINGS} className={LINK}>
            Open
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
        {words ? <p className="px-6 text-ui text-foreground">{words}</p> : null}
        {waiting ? (
          <div className="flex flex-col gap-2 px-6">
            <WaitingLine sentence={waiting} />
            {showAll ? (
              // Under the sentence's words, past its icon.
              <Link to={MEETINGS_PATH} className={cn(LINK, 'ml-6 self-start')}>
                {SHOW_ALL}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            ) : null}
          </div>
        ) : null}
        {body}
      </section>
    </Reveal>
  )
}
