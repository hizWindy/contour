/**
 * The words of Activity (PLAN-V17 "The screens", part 3): plain, sentence case, no em dash, and
 * no setting or file name (the screen-words test reads them). The wording is Al-khair's to change.
 */
import type { CallNoteOut, TaskKind } from '@/api/v17'
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatTime,
  humanise,
  melbourneDate,
  pluralise,
} from '@/lib/format'

export const ACTIVITY_TITLE = 'Your call notes'
export const ACTIVITY_DESCRIPTION =
  'The calls you logged. Check them, then send them to HubSpot in one go.'

export const TAB_TO_CONFIRM = 'To confirm'
export const TAB_LOGGED = 'Logged'
export const TAB_NEEDS_LOOK = 'Needs a look'

/** The serif voice of each empty tab: what it is, and what puts something there. */
export const EMPTY = {
  to_confirm: { title: 'Nothing to confirm.', description: 'Log a call and it waits here.' },
  logged: {
    title: 'Nothing logged yet.',
    description: 'The calls you send to HubSpot show here, each with a link to it.',
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

/** A step of the write, by name: "The call", "Follow-up 2". */
export function stepName(step: string): string {
  if (step === 'call') return 'The call'
  if (step === 'fields') return 'The field changes'
  if (step === 'note') return 'The note'
  const task = /^task:(\d+)$/.exec(step)
  if (task) return `Follow-up ${task[1] ?? ''}`
  return humanise(step)
}

// --- Sending --------------------------------------------------------------------------------

export const SEND_TO_HUBSPOT = 'Send to HubSpot'
export const SEND_OFF = 'Sending is off until then.'
export const ALL_LEFT_OUT = 'Every call is left out. Put one back to send it.'
export const NONE_READY = 'Nothing is ready to send yet.'
export const SEND_DESCRIPTION = 'Check the totals. Nothing is written until you send.'
export const READING_HUBSPOT = 'Reading HubSpot. Nothing is written yet.'
export const PREVIEW_FAILED = "HubSpot's values couldn't be read, so nothing was sent."
export const ALREADY_SENDING =
  'A batch is already on its way to HubSpot. Wait for it to finish, then send the rest.'
export const NOT_SENT = 'Not sent to HubSpot'

/**
 * The plain sentence beside the button: what the number means. "7 calls to send. 1 left out.",
 * or, with only notes being sorted, "1 call still sorting."
 */
export function batchSentence(included: number, leftOut: number, sorting: number): string {
  const parts: string[] = []
  if (included > 0) parts.push(`${pluralise(included, 'call')} to send.`)
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

/** The send dialog's title: "Send 7 calls to HubSpot?" */
export function sendTitle(count: number): string {
  return `Send ${pluralise(count, 'call')} to HubSpot?`
}

/** "7 calls, 3 tasks, 2 field changes" */
export function totalsWords(totals: { calls: number; tasks: number; changes: number }): string {
  return [
    pluralise(totals.calls, 'call'),
    pluralise(totals.tasks, 'task'),
    pluralise(totals.changes, 'field change'),
  ].join(', ')
}

/** "1 field change is held: HubSpot's value changed since you saw it." */
export function heldWords(count: number): string {
  return `${pluralise(count, 'field change')} ${count === 1 ? 'is' : 'are'} held: HubSpot's value changed since you saw it.`
}

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

// --- Logged ---------------------------------------------------------------------------------

/** "Logged 15 Nov 2026, 3:05 pm" */
export function loggedWhen(at: string | null): string {
  return at ? `Logged ${formatDateTime(at)}` : 'Logged'
}

// --- Log call -------------------------------------------------------------------------------

export const WHICH_COMPANY = 'Which company was the call with?'
export const FIND_COMPANY = 'Find a company'
export const TYPE_TWO = 'Type 2 letters or more.'
export const NO_MATCH = 'No company matches.'
export const LOOKING = 'Looking.'
