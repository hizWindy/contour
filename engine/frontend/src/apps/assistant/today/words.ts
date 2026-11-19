/**
 * Today's words (PLAN-V22 T2-2, choices 6 to 9, and "Words for when things go wrong"): plain,
 * sentence case, no em dash, and no setting or file name (the screen-words test reads them). Each
 * problem says what happened, what still works, and the one thing to do. The server's own
 * sentence about the tasks (`tasks_sentence`) shows as it comes. The wording is Al-khair's to
 * change.
 */
import type { TodayTask } from '@/api/types'
import { pluralise } from '@/lib/format'

// --- The four parts, the most urgent first (choice 6) ----------------------------------------------

export const TASKS = 'Your HubSpot tasks'
export const MEETINGS = 'Your meetings today and tomorrow'
/** The pre-reads sent to me, for meetings from today on (PLAN-V23 T2-4, choice 9). */
export const PRE_READS = 'Pre-reads for you'
export const CALLS = 'Calls to confirm'
export const DEALS = 'Deals that need a nudge'

/** The tasks' groups: overdue, then today's, then the next 7 days' (folded). */
export const TASK_GROUPS: Readonly<Record<TodayTask['group'], string>> = {
  overdue: 'Overdue',
  today: 'Due today',
  soon: 'Next 7 days',
}

export const TODAY_LABEL = 'Today'
export const TOMORROW_LABEL = 'Tomorrow'

/** A task's kind, for a screen reader: its icon says it for the eye. */
export const KIND_WORDS: Readonly<Record<TodayTask['kind'], string>> = {
  call: 'Call',
  email: 'Email',
  todo: 'To-do',
}

// --- Empty --------------------------------------------------------------------------------------

/** Nothing in any part (T2-2). */
export const NOTHING_DUE = 'Nothing due today.'
export const NOTHING_DUE_NEXT = 'Press V to log a call or add a task.'
/** On a touch screen there is no V (TBC). */
export const NOTHING_DUE_NEXT_TOUCH = 'Tap Speak to log a call or add a task.'
export const NO_TASKS = 'No tasks due in the next 7 days.'
export const NO_MEETINGS = 'No meetings today or tomorrow.'
export const NO_PRE_READS = 'No pre-reads sent to you.'
export const NO_CALLS = 'No calls to confirm.'
export const NO_DEALS = 'No deals need a nudge.'

// --- Buttons --------------------------------------------------------------------------------------

export const DONE = 'Done'
export const UNDO = 'Undo'
export const OPEN = 'Open'
export const OPEN_IN_HUBSPOT = 'Open in HubSpot'
export const NEW_TAB = '(opens in a new tab)'
export const DRAFT_PRE_READ = 'Draft the pre-read'
export const SPEAK = 'Speak'
/** Sync's description: what it reads. */
export const SYNC_TASKS_NOTE = 'Reads your HubSpot tasks now.'
export const TRY_AGAIN = 'Try again'

// --- Lines -------------------------------------------------------------------------------------------

/** "Overdue, due Mon 17 Nov", "Due today", "Due Thu 20 Nov". */
export function dueWords(task: Pick<TodayTask, 'group'>, day: string): string {
  if (task.group === 'overdue') return `Overdue, due ${day}`
  if (task.group === 'today') return 'Due today'
  return `Due ${day}`
}

/** Who sent me a pre-read: "Sent by Sam Sample". */
export function sentByWords(name: string): string {
  return `Sent by ${name}`
}

/** HubSpot has more old overdue tasks than Today lists (it reads 100 at most). */
export function tasksMoreWords(count: number): string {
  return count === 1
    ? '1 older overdue task is in HubSpot too.'
    : `${String(count)} older overdue tasks are in HubSpot too.`
}

/** More quiet deals than Today lists (50 at most). */
export function dealsMoreWords(count: number): string {
  return `And ${pluralise(count, 'more deal')} that need a nudge.`
}

/** "Next 7 days (5)": the folded group's button. */
export function soonWords(count: number): string {
  return `${TASK_GROUPS.soon} (${String(count)})`
}

// --- Done and Undo (choice 7: at once, with Undo) ---------------------------------------------------

/** The toast after a Done: what was ticked. */
export function doneWords(subject: string): string {
  return `Ticked done in HubSpot: ${subject}`
}

export const OPEN_AGAIN = 'The task is open again in HubSpot.'

/** A Done that didn't go: the task is back on the list, and says why. */
export const STILL_OPEN = 'The task is still open'
/** An Undo that didn't go. */
export const STILL_DONE = 'The task is still done in HubSpot'

/** HubSpot can't be changed from Contour for now (409 `hubspot_writing_off`), for a task. */
export const TASK_WRITING_OFF = 'Changing HubSpot from Contour is off for now. Tick it in HubSpot.'

/** The account isn't linked to a HubSpot user (409 `no_hubspot_link`). */
export function noLinkWords(admin: string): string {
  return `Your account isn't linked to HubSpot yet. Ask ${admin} to link it.`
}

/** Another rep's task (403 `not_your_task`). */
export const NOT_YOUR_TASK = "That task isn't yours in HubSpot, so it wasn't changed."

/** The task is gone from HubSpot (404 `task_not_found`). */
export const TASK_GONE = "That task isn't in HubSpot any more. Today is read again."

// --- Loading and failing ---------------------------------------------------------------------------

export const LOADING_TODAY = 'Loading your day.'
export const TODAY_FAILED = "Today couldn't be loaded."

// --- Home's Assistant card (T2-3, choice 5) -----------------------------------------------------------

export const OPEN_TODAY = 'Open Today'

/** "3 tasks due, 1 overdue", "1 task due today", "No tasks due today". */
export function tasksDueWords(due: number, overdue: number): string {
  if (due === 0) return 'No tasks due today'
  const tasks = pluralise(due, 'task')
  return overdue > 0 ? `${tasks} due, ${String(overdue)} overdue` : `${tasks} due today`
}

/** "2 meetings today", "No meetings today". */
export function meetingsTodayWords(count: number): string {
  return count === 0 ? 'No meetings today' : `${pluralise(count, 'meeting')} today`
}

/** "4 calls to confirm", "No calls to confirm". */
export function callsWaitingWords(count: number): string {
  return count === 0 ? 'No calls to confirm' : `${pluralise(count, 'call')} to confirm`
}

/** "2 need a look", "1 needs a look". */
export function needLookWords(count: number): string {
  return `${String(count)} ${count === 1 ? 'needs' : 'need'} a look`
}

/** On a laptop: "Press V to speak", with V as a key. On a touch screen, the Speak button. */
export const PRESS = 'Press'
export const TO_SPEAK = 'to speak, on any page.'
export const LOADING_COUNTS = "Loading today's counts."
export const COUNTS_FAILED = "Today's counts couldn't be loaded right now."
