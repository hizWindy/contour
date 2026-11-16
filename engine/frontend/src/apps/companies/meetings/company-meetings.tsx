/**
 * A company's meetings on its record (PLAN-V17 T3-11, "The screens" part 7): its next three,
 * soonest first, then its last three, newest first (`CompanyDetail.meetings`), each with its
 * status and a link: to its pre-read when it has one, else to Meetings, found by the company's
 * name, the team's too (a company's meetings may be anyone's).
 *
 * A record is a long read, so these are links, not buttons that act: the work is on Meetings and
 * on the pre-read. Each says whose meeting it is, when the server knows. The server sends none
 * while pre-meeting forms are off, while HubSpot's meetings aren't read yet, and for a company
 * that isn't in HubSpot: the record then shows no Meetings section at all, as before.
 */
import { useId } from 'react'
import { Link } from 'react-router'
import type { MeetingItem } from '@/api/types'
import { Button } from '@/components/ui/button'
import { meetingsHref, preReadHref } from './params'
import { StatusLine } from './row-parts'
import { rowKey, rowStatus } from './rows'
import {
  CHECK_AND_SEND,
  COMING_UP,
  companyMeetingsQuery,
  meetingDay,
  OPEN_MEETINGS,
  OPEN_PRE_READ,
  PAST,
  whereWords,
} from './words'

function MeetingLine({
  item,
  past,
  companyName,
  today,
}: {
  item: MeetingItem
  past: boolean
  companyName: string
  today: string
}) {
  const { meeting } = item
  const status = rowStatus(item, past)
  const when = meetingDay(meeting.starts_at, today)
  const title = meeting.title.trim()
  const facts = [when, whereWords(meeting), item.owner_name?.trim() || null]
    .filter(Boolean)
    .join(' · ')
  const href = item.form
    ? preReadHref(item.form.id)
    : meetingsHref({
        when: past ? 'past' : 'upcoming',
        q: companyMeetingsQuery(companyName),
      })
  // A past meeting's draft opens as any pre-read does: Check and send is for one still to come.
  const label = item.form
    ? status === 'draft' && !past
      ? CHECK_AND_SEND
      : OPEN_PRE_READ
    : OPEN_MEETINGS
  return (
    <li
      data-slot="company-meeting"
      className="flex flex-col gap-2 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        {title ? <span className="font-semibold break-words">{title}</span> : null}
        <span className="text-caption text-muted-foreground">{facts}</span>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
        <StatusLine status={status} />
        <Button asChild variant="outline" size="sm" className="touch:h-11">
          <Link to={href}>
            {label}
            <span className="sr-only">{`: ${title || companyName}, ${when}`}</span>
          </Link>
        </Button>
      </div>
    </li>
  )
}

/** One group of the company's meetings, under its own small heading. */
function Group({
  title,
  items,
  past,
  companyName,
  today,
}: {
  title: string
  items: readonly MeetingItem[]
  past: boolean
  companyName: string
  today: string
}) {
  const headingId = useId()
  if (items.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <h4 id={headingId} className="text-caption text-muted-foreground">
        {title}
      </h4>
      <ul aria-labelledby={headingId} className="flex flex-col gap-2">
        {items.map((item) => (
          <MeetingLine
            key={rowKey(item)}
            item={item}
            past={past}
            companyName={companyName}
            today={today}
          />
        ))}
      </ul>
    </div>
  )
}

export function CompanyMeetings({
  meetings,
  companyName,
  today,
}: {
  meetings: readonly MeetingItem[]
  companyName: string
  today: string
}) {
  // A past meeting has no group: the server says which are still to come.
  const upcoming = meetings.filter((item) => item.group !== null)
  const past = meetings.filter((item) => item.group === null)
  return (
    <div className="flex flex-col gap-4">
      <Group
        title={COMING_UP}
        items={upcoming}
        past={false}
        companyName={companyName}
        today={today}
      />
      <Group title={PAST} items={past} past companyName={companyName} today={today} />
    </div>
  )
}
