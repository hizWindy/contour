/**
 * The words of Meetings (PLAN-V17 "The screens", part 5): plain, sentence case, no em dash, and no
 * setting or file name (the screen-words test reads them). The wording is Al-khair's to change.
 */
import { toApiProblem } from '@/api/client'
import type { Meeting, MeetingWhen, MeetingWhere, MeetingWho } from '@/api/types'
import { addDays } from '@/lib/due-date'
import { formatNumber, formatTime, melbourneDate } from '@/lib/format'
import { changeDetail, problemHint } from '@/lib/problems'
import type { DayGroup, RowStatus } from './rows'

/** Ends a sentence that has no stop yet. */
function sentence(text: string): string {
  const trimmed = text.trim()
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

export const MEETINGS_TITLE = 'Client meetings'
export const MEETINGS_DESCRIPTION =
  'Draft the pre-read for each client meeting, check it, then send it to the team.'

export const UPCOMING = 'Upcoming'
export const PAST = 'Past'
export const WHEN_LABEL = 'Upcoming or past meetings'
export const WHO_LABEL = 'Whose meetings'
/** The three filters (PLAN-V18 T2-3). All is the default. */
export const WHO_WORDS: Readonly<Record<MeetingWho, string>> = {
  all: 'All',
  mine: 'My meetings',
  team: 'My team',
}
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
 * Teams or in person (the plan's words), for New pre-read's choice. On a meeting's row, use
 * `whereWords`, which names a client's own Zoom or Google Meet too.
 */
export const WHERE_WORDS: Readonly<Record<Exclude<MeetingWhere, 'unknown'>, string>> = {
  online: 'Teams',
  in_person: 'In person',
}

/** A video call's service, named in HubSpot's location (usually its link), as Track 2 reads it. */
const ZOOM = /zoom\.(?:us|com)|\bzoom\b/i
const GOOGLE_MEET = /meet\.google\.com|\bgoogle meet\b/i

/**
 * Where a meeting is, as a word beside its icon: "In person", or for a video call "Teams", which
 * Contour uses, unless HubSpot's location names Zoom or Google Meet. The pre-read's facts say the
 * same (Track 2, `0ef8754`). Null when the place isn't known, a phone call included: nothing shows.
 */
export function whereWords(meeting: Pick<Meeting, 'where' | 'location'>): string | null {
  if (meeting.where === 'in_person') return WHERE_WORDS.in_person
  if (meeting.where !== 'online') return null
  const location = meeting.location ?? ''
  if (ZOOM.test(location)) return 'Zoom'
  if (GOOGLE_MEET.test(location)) return 'Google Meet'
  return WHERE_WORDS.online
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
/** "Draft it"'s description, for the pointer and for screen readers (PLAN-V18 T2-4). */
export const DRAFT_IT_NOTE = "AI drafts it. You check it before it's sent."
export const CHECK_AND_SEND = 'Check and send'
export const OPEN = 'Open'
export const LOG_MEETING = 'Log meeting'
/** Before the owner's name on the team's list, for a screen reader: whose meeting it is. */
export const WHOSE = 'Whose meeting:'
/** The small mark on the rep's own meetings, on All and My team. */
export const YOU = 'You'

// --- Sync (PLAN-V18 T2-3) -------------------------------------------------------------------

export const SYNC = 'Sync'
export const SYNC_NOTE = "Reads HubSpot's meetings now."
export const CHECKING_HUBSPOT = 'Checking HubSpot'
export const UP_TO_DATE = 'Up to date'
/** A press while a read is running already. The seconds are TBC: T1-5 measures them. */
export const ALREADY_CHECKING = 'Already checking HubSpot. It takes about 10 seconds.'
/** A press within a minute of the last read: HubSpot isn't asked again. */
export const CHECKED_A_MOMENT_AGO = 'Up to date. Checked a moment ago.'

/**
 * The quiet line under the toolbar, from when HubSpot's meetings were last read: "Checked 2:14 pm",
 * "Checked yesterday, 4:00 pm" or "Checked Thu 12 Nov, 9:00 am", in Melbourne time.
 */
export function checkedWords(at: string, today: string): string {
  const day = melbourneDate(at)
  const time = formatTime(at)
  if (day === today) return `Checked ${time}`
  if (day === addDays(today, -1)) return `Checked yesterday, ${time}`
  return `Checked ${dayText(day, today)}, ${time}`
}

/**
 * Why a press of Sync didn't go, for the line under the toolbar: what happened, then what to do
 * (the server's words, then the hint for its code). A detail that already starts with the title
 * says it alone, so nothing is said twice.
 */
export function syncNotSentWords(error: unknown): string {
  const problem = toApiProblem(error)
  const title = problem.title.trim()
  const detail = changeDetail(problem)?.trim() ?? ''
  const hint = problemHint(problem)
  if (detail !== '' && detail.toLowerCase().startsWith(title.toLowerCase())) {
    return [sentence(detail), hint].filter(Boolean).join(' ')
  }
  return [title ? sentence(title) : null, detail || null, hint].filter(Boolean).join(' ')
}

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

/** Whose meetings an empty list would have held, for its words. */
const WHOSE_MEETINGS: Readonly<Record<MeetingWho, string>> = {
  all: 'Client meetings',
  mine: 'Your client meetings',
  team: "Your team's client meetings",
}

/** The serif voice of an empty list: what it is, and what puts something there. */
export function emptyWords(when: MeetingWhen, who: MeetingWho): Empty {
  if (when === 'past') {
    return {
      title: 'No past meetings yet.',
      description: `${WHOSE_MEETINGS[who]} show here once they are over.`,
    }
  }
  return {
    title: 'No meetings this week.',
    description:
      who === 'team'
        ? `${WHOSE_MEETINGS.team} from HubSpot show here.`
        : `${WHOSE_MEETINGS[who]} from HubSpot show here. For one that isn't in HubSpot, start a new pre-read.`,
  }
}

/**
 * My meetings or My team while it can't be filled (PLAN-V18 "Words for when things go wrong"): the
 * rep's account has no HubSpot owner, the rep is in no HubSpot team, or HubSpot has no teams. The
 * server's own sentence takes the place of the description when it sends one.
 */
export const NOT_LINKED_MINE: Empty = {
  title: 'No meetings of your own to show yet.',
  description:
    "Your account isn't linked to a HubSpot owner yet, so My meetings is empty. All shows everyone's. An admin can link you in Admin, People.",
}
export const NOT_LINKED_TEAM: Empty = {
  title: 'No team meetings to show yet.',
  description:
    "Your account isn't linked to a HubSpot owner yet, so My team is empty. All shows everyone's. An admin can link you in Admin, People.",
}
export const NO_TEAM: Empty = {
  title: 'No team meetings to show yet.',
  description: "You aren't in a HubSpot team yet, so My team is empty. All shows everyone's.",
}
export const NO_TEAMS_IN_HUBSPOT: Empty = {
  title: 'No team meetings to show.',
  description: "HubSpot has no teams set up, so My team is empty. All shows everyone's.",
}
export const SHOW_ALL = 'Show all meetings'

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
 * The quiet line while the list can't show what was asked: the server's own sentence, like
 * "HubSpot isn't connected, so meetings can't be read from it.", or that the rep's own can't be
 * picked out yet, then what still works.
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
export const NEW_DESCRIPTION = "For a meeting that isn't in HubSpot."
/**
 * Who drafts it, from what, how long it takes, and that the rep checks it first (PLAN-V18 T2-4).
 * The seconds are TBC: the real draft in T2-8 measures them.
 */
export const AI_DRAFTS_NOTE =
  'AI drafts this pre-read from what we know in HubSpot: the company, its people, calls, meetings and notes. It takes about 20 seconds. You check it before anyone gets it.'
/** What one draft costs, by the plan's estimate (PLAN-V17 "What it costs"). */
export const AI_DRAFT_COST = 'About US$0.03.'
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

/**
 * When a meeting is, with no group heading above it (Home's card, a company's record): "Today,
 * 10:00 am", "Tomorrow, 2:00 pm", "Yesterday, 4:00 pm" or "Thu 26 Nov, 10:00 am".
 */
export function meetingDay(at: string, today: string): string {
  return melbourneDate(at) === addDays(today, 1)
    ? `Tomorrow, ${formatTime(at)}`
    : pastWhen(at, today)
}

// --- Log meeting (T3-11) --------------------------------------------------------------------

export const TRANSCRIPT = 'Transcript'
export const TRANSCRIPT_PLACEHOLDER = 'Paste the transcript here.'
export const LOG_MEETING_NOTE =
  'Paste the transcript, or read a .txt or .vtt file. It joins your calls to confirm in Call logs, and nothing goes to HubSpot until you send it.'
export const READ_A_FILE = 'Read a file'
export const VTT_HINT = 'The times and cue numbers are taken out when it is saved.'
export const SAVE_NOTES = 'Save notes'
export const SAVING_NOTES = 'Saving.'
export const NOTHING_PASTED = 'Paste the transcript or read a file first.'
export const FILE_TYPE = 'Only a .txt or .vtt file can be read here. Paste the words instead.'
export const FILE_TOO_BIG = 'That file is too big to be a transcript. Paste the words instead.'
export const FILE_UNREADABLE = "That file couldn't be read as text. Paste the words instead."
export const TRANSCRIPT_UNDONE = 'Undone. The transcript is back as a draft.'
export const TRANSCRIPT_NOT_UNDONE = 'Not undone. The meeting notes still wait for you to confirm.'
/** A save that failed after the panel was closed: the words aren't lost. */
export const TRANSCRIPT_KEPT = 'Your transcript is kept. Open Log meeting again to save it.'

/** "From Sample meeting.vtt" */
export function fromFileWords(name: string): string {
  return `From ${name}`
}

/** "Remove Sample meeting.vtt" */
export function removeFileWords(name: string): string {
  return `Remove ${name}`
}

/** "54,210 of 60,000 characters", shown only near the end. */
export function charactersWords(length: number, max: number): string {
  return `${formatNumber(length)} of ${formatNumber(max)} characters`
}

/** "Too long: 61,200 of 60,000 characters. Shorten it, or split it into two." */
export function transcriptTooLongWords(length: number, max: number): string {
  return `Too long: ${charactersWords(length, max)}. Shorten it, or split it into two.`
}

/**
 * Why a transcript wasn't saved, in the server's own words, after "Not saved yet.": "Not saved
 * yet. This meeting hasn't happened yet. Log the meeting once it has been." A lost connection says
 * what every change says. The words stay in the box.
 */
export function transcriptNotSavedWords(error: unknown): string {
  const problem = toApiProblem(error)
  const fields = problem.errors.map((field) => sentence(field.message))
  return [
    'Not saved yet.',
    problem.title.trim() ? sentence(problem.title) : null,
    changeDetail(problem),
    ...fields,
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * The line under Log meeting's title: "Sample Logistics Pty Ltd · Office walk-through · Thu 12 Nov,
 * 9:00 am".
 */
export function logMeetingLine(
  companyName: string,
  title: string,
  at: string,
  today: string,
): string {
  return [companyName, title.trim(), meetingDay(at, today)].filter(Boolean).join(' · ')
}

// --- Around the app (T3-11): Home's card and a company's record -----------------------------

export const UPCOMING_MEETINGS = 'Upcoming meetings'
export const OPEN_MEETINGS = 'Open Meetings'
export const NO_MEETINGS_SOON = 'No meetings in the next few days.'
export const NO_MEETINGS_SOON_NOTE =
  'Your client meetings from HubSpot show here, with their pre-reads.'
export const MEETINGS_NOT_LOADED = "Your meetings couldn't be loaded right now."
export const COMING_UP = 'Coming up'
export const OPEN_PRE_READ = 'Open the pre-read'

/**
 * Home's sentence over the rows, from the counts for the next 7 days: "2 need a pre-read, and 1 is
 * ready to check and send." Null with nothing to do.
 */
export function upcomingSentence(needPreRead: number, draftReady: number): string | null {
  const need =
    needPreRead > 0
      ? `${formatNumber(needPreRead)} ${needPreRead === 1 ? 'needs' : 'need'} a pre-read`
      : null
  const ready =
    draftReady > 0
      ? `${formatNumber(draftReady)} ${draftReady === 1 ? 'is' : 'are'} ready to check and send`
      : null
  if (need && ready) return `${need}, and ${ready}.`
  if (need) return `${need}.`
  if (ready) {
    return draftReady === 1
      ? '1 pre-read is ready to check and send.'
      : `${formatNumber(draftReady)} pre-reads are ready to check and send.`
  }
  return null
}

/** Meetings, found by the company's name, everyone's: where a meeting with no pre-read is. */
export function companyMeetingsQuery(companyName: string): string {
  return companyName.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}
