/**
 * The words of Call logs (PLAN-V17 "The screens", part 3; called Activity until PLAN-V18 T3-2):
 * plain, sentence case, no em dash, and no setting or file name (the screen-words test reads them).
 * The wording is Al-khair's to change.
 */
import type { CallNoteOut, TaskKind } from '@/api/types'
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatTime,
  humanise,
  melbourneDate,
  pluralise,
} from '@/lib/format'

export const CALL_LOGS_TITLE = 'Call logs'
export const CALL_LOGS_DESCRIPTION =
  'Every call you logged. Check new ones, send them to HubSpot, and look back at old ones.'

export const TAB_TO_CONFIRM = 'To confirm'
export const TAB_HISTORY = 'History'
export const TAB_NEEDS_LOOK = 'Needs a look'

/** The serif voice of each empty tab: what it is, and what puts something there. */
export const EMPTY = {
  to_confirm: { title: 'Nothing to confirm.', description: 'Log a call and it waits here.' },
  history: {
    title: 'No calls logged yet.',
    description: 'Press Log call after your next call, and it shows here.',
  },
  needs_look: {
    title: 'Nothing needs a look.',
    description: "A call HubSpot didn't take shows here, with what to do.",
  },
} as const

export const OFF_TITLE = 'Call notes are switched off.'
export const OFF_DESCRIPTION =
  'Ask an admin to switch them on. Until then, log your calls in HubSpot as before.'

export const LOAD_FAILED = "Your calls couldn't be loaded."
export const LOADING = 'Loading your calls.'

// --- One call -------------------------------------------------------------------------------

export const NO_ONE = 'No one in particular'
export const NO_OUTCOME = 'No outcome'
export const OUTCOME = 'Outcome'
export const SUMMARY = 'Summary'
export const CHANGES = 'Changes'
export const FOLLOW_UPS = 'Follow-ups'
export const EMPTY_VALUE = 'Empty'
export const SORTING = 'Sorting the note.'
export const CHECK_THIS_ONE = 'Check this one.'
export const HELD = 'Held until you check it.'
export const KEEP_MINE = 'Keep mine'
export const LEFT_OUT = 'Left out of this batch.'
export const LEAVE_OUT = 'Leave out'
export const PUT_BACK = 'Put back'
export const EDIT = 'Edit'
export const DONE = 'Done'
export const REMOVE = 'Remove'
export const SENDING = 'Sending to HubSpot.'
export const LOGGED = 'Logged'
export const NEEDS_LOOK = 'Needs a look'
export const ADD = 'Add'
export const CANCEL = 'Cancel'
export const VALUE = 'New value'
export const WHAT_TO_DO = 'What to do'
export const KIND = 'Kind'
export const WHEN = 'When'
export const NOT_CHANGED = "Your change wasn't saved"
export const VALUE_UNREADABLE = "That value couldn't be read. Try 30/6/2028 or 1200."
/** A card's text folded to two lines, and open in full. */
export const SHOW_ALL = 'Show all'
export const SHOW_LESS = 'Show less'

export const KIND_LABELS: Readonly<Record<TaskKind, string>> = {
  call: 'Call',
  email: 'Email',
  todo: 'To-do',
}

/** "Jo Sample, Office Manager", or "No one in particular". */
export function personLine(person: CallNoteOut['person']): string {
  if (!person) return NO_ONE
  return person.title ? `${person.name}, ${person.title}` : person.name
}

/** "Today, 3:05 pm", or "12 Nov 2026, 3:05 pm", in Melbourne time. */
export function callWhen(at: string, today: string = melbourneDate()): string {
  return melbourneDate(at) === today ? `Today, ${formatTime(at)}` : formatDateTime(at)
}

/** A logged meeting's notes (T3-11): they go to HubSpot as a note, not a call. */
export const MEETING_NOTES = 'Meeting notes'

/** A note from a meeting's transcript ("Log meeting", T3-11), not from a call. */
export function isMeetingNotes(note: Pick<CallNoteOut, 'source'>): boolean {
  return note.source === 'transcript'
}

/**
 * The line under a card's company: who, when and the outcome, "Jo Sample, Office Manager · Today,
 * 3:05 pm · Connected". A logged meeting reads as meeting notes, with no call outcome: "Meeting
 * notes · 12 Nov 2026, 9:00 am".
 */
export function noteLine(
  note: Pick<CallNoteOut, 'source' | 'person' | 'called_at' | 'call'>,
  today: string = melbourneDate(),
): string {
  if (isMeetingNotes(note)) {
    return [
      MEETING_NOTES,
      note.person ? personLine(note.person) : null,
      callWhen(note.called_at, today),
    ]
      .filter(Boolean)
      .join(' · ')
  }
  return [
    personLine(note.person),
    callWhen(note.called_at, today),
    note.call.outcome ?? NO_OUTCOME,
  ].join(' · ')
}

/** "Lease end · Perth", or the label alone when the change is for the whole company. */
export function changeLabel(label: string, office: string | null): string {
  return office ? `${label} · ${office}` : label
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** A field's value as a person reads it: "30 Jun 2027", "1,200", or "Empty". */
export function fieldValue(value: string | null, kind: 'date' | 'number' | undefined): string {
  if (value === null || value.trim() === '') return EMPTY_VALUE
  if (kind === 'date' && ISO_DAY.test(value)) return formatDate(value)
  if (kind === 'number' && /^\d+(\.\d+)?$/.test(value)) return formatNumber(Number(value))
  return value
}

/** "Changed in HubSpot since: now 30 Jun 2027." */
export function changedSince(now: string): string {
  return `Changed in HubSpot since: now ${now}.`
}

/** "For you", or "For Mia". */
export function forWhom(owner: string | null): string {
  return owner ? `For ${owner}` : 'For you'
}

/** The words a date came from, in quotes: from "next Tuesday". */
export function fromWords(words: string): string {
  return `from "${words}"`
}

/**
 * A step of the write, by name: "The call", "Follow-up 2". A logged meeting's notes go as a note,
 * its step `note`: "The meeting notes".
 */
export function stepName(step: string, meeting = false): string {
  if (step === 'call') return 'The call'
  if (step === 'fields') return 'The field changes'
  if (step === 'note') return meeting ? 'The meeting notes' : 'The note'
  const task = /^task:(\d+)$/.exec(step)
  if (task) return `Follow-up ${task[1] ?? ''}`
  return humanise(step)
}

// --- Sending --------------------------------------------------------------------------------

export const SEND_TO_HUBSPOT = 'Send to HubSpot'
/**
 * Why Send (or Try again) is greyed out while HubSpot isn't ready. It stands alone: on a phone the
 * waiting line has scrolled away by the time the bar at the bottom is read, and Needs a look says
 * it on every card.
 */
export const SEND_OFF = 'Sending waits for HubSpot.'
export const ALL_LEFT_OUT = 'Every call is left out. Put one back to send it.'
export const NONE_READY = 'Nothing is ready to send yet.'
export const SEND_DESCRIPTION = 'Check the totals. Nothing is written until you send.'
export const READING_HUBSPOT = 'Reading HubSpot. Nothing is written yet.'
export const PREVIEW_FAILED = "HubSpot's values couldn't be read, so nothing was sent."
export const ALREADY_SENDING =
  'A batch is already on its way to HubSpot. Wait for it to finish, then send the rest.'
export const NOT_SENT = 'Not sent to HubSpot'

/**
 * The quiet line beside the button says only what the button doesn't (DESIGN.md "Say it once").
 * The button has the count ("Send 7 to HubSpot"), so the line has the rest: "2 still sorting.
 * 1 left out.", or nothing. With none to send the button has no count, so a note being sorted
 * says what it is: "1 call still sorting."
 */
export function batchSentence(included: number, leftOut: number, sorting: number): string {
  const parts: string[] = []
  if (sorting > 0) {
    parts.push(
      included > 0
        ? `${formatNumber(sorting)} still sorting.`
        : `${pluralise(sorting, 'call')} still sorting.`,
    )
  }
  if (leftOut > 0) parts.push(`${formatNumber(leftOut)} left out.`)
  return parts.join(' ')
}

/** The quiet line while HubSpot isn't ready: the server's own sentence, then what still works. */
export function waitingLine(sentence: string | null): string {
  const reason = sentence?.trim() || 'Waiting for HubSpot write access.'
  return `${/[.!?]$/.test(reason) ? reason : `${reason}.`} You can still check and change your calls.`
}

/**
 * Calls and meeting notes, each kind as words: ["2 calls", "1 meeting note"], ["1 meeting note"],
 * ["3 calls"]. The calls show unless there are only meeting notes.
 */
function kinds(calls: number, meetingNotes: number): string[] {
  const parts: string[] = []
  if (calls > 0 || meetingNotes === 0) parts.push(pluralise(calls, 'call'))
  if (meetingNotes > 0) parts.push(pluralise(meetingNotes, 'meeting note'))
  return parts
}

/**
 * The send dialog's title, with only what will go: "Send 2 calls and 1 meeting note to HubSpot?".
 * With nothing to go: "Send to HubSpot?".
 */
export function sendTitle(calls: number, meetingNotes = 0): string {
  if (calls + meetingNotes === 0) return 'Send to HubSpot?'
  return `Send ${kinds(calls, meetingNotes).join(' and ')} to HubSpot?`
}

/** "2 calls, 1 meeting note, 3 tasks, 2 field changes": the meeting notes only when there are some. */
export function totalsWords(counts: {
  calls: number
  meetingNotes: number
  tasks: number
  changes: number
}): string {
  return [
    ...kinds(counts.calls, counts.meetingNotes),
    pluralise(counts.tasks, 'task'),
    pluralise(counts.changes, 'field change'),
  ].join(', ')
}

/** "1 field change is held: HubSpot's value changed since you saw it." */
export function heldWords(count: number): string {
  return `${pluralise(count, 'field change')} ${count === 1 ? 'is' : 'are'} held: HubSpot's value changed since you saw it.`
}

/**
 * Over the notes the send leaves out (`skipped`, T3-11): "1 call won't be sent:", "1 call and 1
 * meeting note won't be sent:".
 */
export function notSentHead(calls: number, meetingNotes = 0): string {
  return `${kinds(calls, meetingNotes).join(' and ')} won't be sent:`
}

/** At the top of a card the send left out, before the server's why. */
export const LEFT_BEHIND = 'Not sent.'

/** Every call of a send was left out: each card says why. */
export const NOTHING_SENT = 'Nothing was sent. Each card says why.'

/** With every call left out, Send has nothing to send. */
export const NOTHING_TO_SEND = 'None of these can be sent now.'

/** Under a list cut at its limit: "Showing the first 100 of 120." */
export function firstOfWords(shown: number, total: number): string {
  return `Showing the first ${formatNumber(shown)} of ${formatNumber(total)}.`
}

export const REST_NEXT = 'Send these, and the rest show next.'

/** "Sending 3 of 7." */
export function sendingWords(done: number, total: number): string {
  return `Sending ${formatNumber(done)} of ${formatNumber(total)}.`
}

/** What a finished batch did: "6 logged in HubSpot. 1 needs a look." */
export function batchDoneWords(logged: number, needsLook: number, back: number): string {
  const parts: string[] = []
  if (logged > 0) parts.push(`${formatNumber(logged)} logged in HubSpot.`)
  if (needsLook > 0) {
    parts.push(`${formatNumber(needsLook)} ${needsLook === 1 ? 'needs' : 'need'} a look.`)
  }
  if (back > 0) {
    parts.push(
      `${formatNumber(back)} ${back === 1 ? "wasn't" : "weren't"} sent and still wait here.`,
    )
  }
  return parts.join(' ') || 'Nothing was sent.'
}

// --- Removing -------------------------------------------------------------------------------

export const UNDO = 'Undo'
export const PUT_BACK_DONE = 'Undone. The call is back.'
export const NOT_REMOVED = 'Not removed. The call is still waiting for you to confirm.'

/** "Removed the call with Sample Logistics Pty Ltd." */
export function removedWords(companyName: string): string {
  return `Removed the call with ${companyName}.`
}

/** "Removed the change to Lease end · Perth." */
export function removedChangeWords(label: string): string {
  return `Removed the change to ${label}.`
}

/** "Removed the follow-up: Call Jo back about the lease." */
export function removedTaskWords(subject: string): string {
  return `Removed the follow-up: ${/[.!?]$/.test(subject) ? subject : `${subject}.`}`
}

// --- Needs a look ---------------------------------------------------------------------------

export const STATUS_WORDS = {
  failed: 'Not in HubSpot. Nothing landed.',
  partial: 'Partly in HubSpot. Some steps landed.',
  uncertain: 'Not sure it reached HubSpot.',
} as const

export const WHAT_HAPPENED = 'What happened'
export const TRY_AGAIN = 'Try again'
export const TRY_AGAIN_HINT = 'What landed stays. Try again sends the rest.'
export const CHECK_HUBSPOT = 'Check HubSpot, then tell us:'
export const ITS_THERE = "It's there"
export const ITS_NOT_THERE = "It's not there"
export const OPEN_IN_HUBSPOT = 'Open in HubSpot'
export const NEW_TAB = '(opens in a new tab)'
export const NOT_DONE = "That didn't go through"

// --- History (PLAN-V18 T3-6) ---------------------------------------------------------------

export const HISTORY_LIST = 'Your calls, newest first'
export const HISTORY_LOADING = 'Loading your call history.'
export const HISTORY_FAILED =
  "Your call history couldn't be loaded. Check your connection, then try again."
export const SEARCH_CALLS = 'Search your calls'
export const SEARCH_PLACEHOLDER = 'Company, person, or words in the note'
export const HOW_IT_WENT = 'How it went'
export const WHEN_LABEL = 'When'
export const WHERE_IT_STANDS = 'Where it stands'
export const SHOW_OLDER = 'Show older'
export const CLEAR_FILTERS = 'Clear the filters'
export const NO_MATCH = {
  title: 'No call matches that.',
  description: 'Clear the filters to see all your calls.',
} as const
export const THE_NOTE = 'The note'
export const WHAT_HAPPENED_TO_IT = 'In HubSpot'
export const HISTORY_KEYS = 'J and K move, Enter opens a call, and / goes to the search.'

export const WHEN_WORDS = { week: 'This week', month: 'This month', all: 'All' } as const

export const WHERE_WORDS = {
  all: 'All',
  logged: 'In HubSpot',
  to_confirm: 'To confirm',
  needs_look: 'Needs a look',
} as const

/** Where one call stands, in a word. */
export const STANDING_WORDS = {
  logged: 'In HubSpot',
  to_confirm: 'To confirm',
  sending: 'Sending',
  needs_look: 'Needs a look',
} as const

/** How a call was logged, for a screen reader and the pointer. */
export const SOURCE_WORDS = {
  mic: 'Logged by speaking',
  typed: 'Typed',
  transcript: 'From a meeting transcript',
} as const

/** "2 follow-ups", "1 field change": the small marks on a row. */
export function marksWords(tasks: number, changes: number): string[] {
  const words: string[] = []
  if (tasks > 0) words.push(pluralise(tasks, 'follow-up'))
  if (changes > 0) words.push(pluralise(changes, 'field change'))
  return words
}

/** "Log another call with Sample Logistics Pty Ltd". */
export function logAnotherWords(companyName: string): string {
  return `Log another call with ${companyName}`
}

/** "30 Jun 2026 to 30 Jun 2028", a change from HubSpot's old value to the new one. */
export function changeWords(before: string, after: string): string {
  return `${before} to ${after}`
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

/**
 * A day's heading: "Today", "Yesterday", "Mon 14 Nov", or "Mon 14 Nov 2025" in another year. Both
 * days are YYYY-MM-DD, in Melbourne time.
 */
export function dayHeading(day: string, today: string): string {
  if (day === today) return 'Today'
  const before = new Date(`${today}T00:00:00Z`)
  before.setUTCDate(before.getUTCDate() - 1)
  if (day === before.toISOString().slice(0, 10)) return 'Yesterday'
  const date = new Date(`${day}T00:00:00Z`)
  const words = `${WEEKDAYS[date.getUTCDay()] ?? ''} ${String(date.getUTCDate())} ${MONTHS[date.getUTCMonth()] ?? ''}`
  return day.slice(0, 4) === today.slice(0, 4) ? words : `${words} ${day.slice(0, 4)}`
}

// --- Logged ---------------------------------------------------------------------------------

/**
 * "Logged today, 3:05 pm", or "Logged 12 Nov 2026, 3:05 pm": the day written as `callWhen`
 * writes it on the same row.
 */
export function loggedWhen(at: string | null, today: string = melbourneDate()): string {
  if (!at) return LOGGED
  return melbourneDate(at) === today
    ? `Logged today, ${formatTime(at)}`
    : `Logged ${formatDateTime(at)}`
}

// --- Log call (the picker's own words are in ../words.ts) ------------------------------------

export const WHICH_COMPANY = 'Which company was the call with?'
