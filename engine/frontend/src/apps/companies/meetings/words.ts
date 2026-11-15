/**
 * The words of Meetings (PLAN-V17 "The screens", part 5): plain, sentence case, no em dash, and no
 * setting or file name (the screen-words test reads them). The wording is Al-khair's to change.
 */
import type { MeetingWhen, MeetingWhere } from '@/api/v17'
import { addDays } from '@/lib/due-date'
import { formatNumber, formatTime, melbourneDate } from '@/lib/format'
import type { DayGroup, RowStatus } from './rows'

export const MEETINGS_TITLE = 'Client meetings'
export const MEETINGS_DESCRIPTION =
  'Draft the pre-read for each client meeting, check it, then send it to the team.'

export const UPCOMING = 'Upcoming'
export const PAST = 'Past'
export const WHEN_LABEL = 'Upcoming or past meetings'
export const TEAM_SWITCH = "The team's meetings"
export const SEARCH_LABEL = 'Find a meeting by company, title or date'
export const SEARCH_PLACEHOLDER = 'Find a meeting'

export const GROUP_LABELS: Readonly<Record<DayGroup, string>> = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  this_week: 'This week',
  later: 'Later',
}

export const PAST_LIST = 'Past meetings'

/**
 * Teams or in person, as a word beside its icon (the plan's words). `online` is any video call,
 * which is Teams at Contour (TBC: a client's own video link would also read "Teams"). A meeting
 * whose place isn't known, a phone call included, says nothing.
 */
export const WHERE_WORDS: Readonly<Record<Exclude<MeetingWhere, 'unknown'>, string>> = {
  online: 'Teams',
  in_person: 'In person',
}

export const STATUS_WORDS: Readonly<Record<RowStatus, string>> = {
  needs: 'Needs pre-read',
  drafting: 'Drafting',
  draft: 'Draft ready',
  sent: 'Sent',
  failed: 'Draft failed',
  notes_logged: 'Notes logged',
  no_notes: 'No notes yet',
  cancelled: 'Cancelled',
}

export const DRAFT_IT = 'Draft it'
export const CHECK_AND_SEND = 'Check and send'
export const OPEN = 'Open'

/** Whose meeting, on the team's list. */
export const YOURS = 'Yours'
export const NO_OWNER = 'No owner'

// --- The states -----------------------------------------------------------------------------

export const LOADING = 'Loading your meetings.'
export const LOAD_FAILED = "Your meetings couldn't be loaded."
export const OFF_TITLE = 'Pre-meeting forms are switched off.'
export const OFF_DESCRIPTION =
  'Ask an admin to switch them on. Until then, prepare the pre-read as before.'

interface Empty {
  title: string
  description: string
}

/** The serif voice of an empty list: what it is, and what puts something there. */
export function emptyWords(when: MeetingWhen, team: boolean): Empty {
  if (when === 'past') {
    return {
      title: 'No past meetings yet.',
      description: team
        ? "The team's client meetings show here once they are over."
        : 'Your client meetings show here once they are over.',
    }
  }
  return {
    title: 'No meetings this week.',
    description: team
      ? "The team's client meetings from HubSpot show here."
      : "Your client meetings from HubSpot show here. For one that isn't in HubSpot, start a new pre-read.",
  }
}

/** An empty list while meetings can't come from HubSpot yet (waiting, or not connected). */
export const EMPTY_WAITING: Empty = {
  title: 'No meetings from HubSpot yet.',
  description: 'For a meeting coming up, start a new pre-read.',
}

/** A search that finds nothing, with where else to look. */
export function noMatchWords(q: string, when: MeetingWhen): Empty {
  return {
    title: `No meeting matches "${q.trim()}".`,
    description:
      when === 'past'
        ? 'Try the company, the title or a date, like 26 nov. Meetings still to come are under Upcoming.'
        : 'Try the company, the title or a date, like 26 nov. Meetings that are over are under Past.',
  }
}

/**
 * The quiet line while meetings can't come from HubSpot (waiting, or not connected): the server's
 * own sentence, like "HubSpot isn't connected, so meetings can't be read from it.", then what
 * still works.
 */
export function waitingLine(sentence: string | null): string {
  const reason = sentence?.trim() || "Meetings can't be read from HubSpot yet."
  return `${/[.!?]$/.test(reason) ? reason : `${reason}.`} You can still start a new pre-read.`
}

/** Under a list cut at its limit: "Showing the first 100 of 120." */
export function firstOfWords(shown: number, total: number): string {
  return `Showing the first ${formatNumber(shown)} of ${formatNumber(total)}.`
}

// --- New pre-read ---------------------------------------------------------------------------

export const NEW_PRE_READ = 'New pre-read'
export const NEW_DESCRIPTION =
  "For a meeting that isn't in HubSpot. It is drafted from what we know about the company."
export const COMPANY = 'Company'
export const PICK_COMPANY = 'Pick a company'
export const WHICH_MEETING_COMPANY = 'Which company is the meeting with?'
export const TITLE = 'Title'
export const TITLE_PLACEHOLDER = 'Like: Office walk-through'
export const DAY = 'Day'
export const DAY_PLACEHOLDER = 'Like thu or 26 nov'
export const TIME = 'Time'
export const TIME_PLACEHOLDER = 'Like 10am or 14:30'
export const WHERE = 'Teams or in person'
export const DRAFT_THE_PRE_READ = 'Draft the pre-read'
export const CANCEL = 'Cancel'

export const PICK_THE_COMPANY = 'Pick the company.'
export const TITLE_EMPTY = 'Give the meeting a title.'
export const DAY_EMPTY = 'Type the day of the meeting.'
export const DAY_UNREADABLE = "That day couldn't be read. Try 26 nov, 26/11 or thu."
export const DAY_PAST = 'That day has gone. Type a day still to come.'
export const TIME_EMPTY = 'Type the time it starts.'
export const TIME_UNREADABLE = "That time couldn't be read. Try 10am or 14:30."

// --- When a meeting is ----------------------------------------------------------------------

const dayParts = new Intl.DateTimeFormat('en-AU', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

/** "Thu 26 Nov", or "Tue 5 Jan 2027" in another year, for a Melbourne day (YYYY-MM-DD). */
export function dayText(day: string, today: string): string {
  const parts = dayParts.formatToParts(new Date(`${day}T12:00:00Z`))
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? ''
  const words = `${part('weekday')} ${part('day')} ${part('month')}`
  return day.slice(0, 4) === today.slice(0, 4) ? words : `${words} ${part('year')}`
}

/**
 * When an upcoming meeting starts, as its group needs it: only the time under Today and Tomorrow
 * ("10:00 am"), the weekday too under This week ("Thu, 10:00 am"), and the day under Later
 * ("Tue 1 Dec, 10:00 am"). In Melbourne time.
 */
export function upcomingWhen(at: string, group: DayGroup, today: string): string {
  const time = formatTime(at)
  if (group === 'today' || group === 'tomorrow') return time
  const day = dayText(melbourneDate(at), today)
  return group === 'this_week' ? `${day.split(' ')[0] ?? day}, ${time}` : `${day}, ${time}`
}

/** When a past meeting was: "Today, 9:00 am", "Yesterday, 4:00 pm" or "Thu 12 Nov, 9:00 am". */
export function pastWhen(at: string, today: string): string {
  const day = melbourneDate(at)
  const time = formatTime(at)
  if (day === today) return `Today, ${time}`
  if (day === addDays(today, -1)) return `Yesterday, ${time}`
  return `${dayText(day, today)}, ${time}`
}
