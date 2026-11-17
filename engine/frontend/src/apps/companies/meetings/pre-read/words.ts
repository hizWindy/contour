/**
 * The words of the pre-read's page (PLAN-V17 "The screens", part 6): plain, sentence case, no em
 * dash, and no setting or file name (the screen-words test reads them). The wording is Al-khair's
 * to change.
 */
import { toApiProblem } from '@/api/client'
import type { FormRecipient, HubSpotCopy, MeetingFormOut } from '@/api/types'
import { formatDate, formatNumber, formatTime, melbourneDate, pluralise, TIME_ZONE } from '@/lib/format'
import { formatMoney, parseMoney } from '@/lib/money'
import { changeDetail } from '@/lib/problems'
import { MOST_PEOPLE, type SendBlock } from './rules'

export const PRE_READ = 'Pre-read'
export const MEETINGS = 'Meetings'
export const LOADING = 'Loading the pre-read.'
export const LOAD_FAILED = "This pre-read couldn't be loaded."
export const OPEN_IN_HUBSPOT = 'Open in HubSpot'
export const NEW_TAB = '(opens in a new tab)'

/** Ends a sentence that has no stop yet. */
function sentence(text: string): string {
  const trimmed = text.trim()
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

// --- Not there ---------------------------------------------------------------------------------

export const MISSING_TITLE = "We can't find that pre-read."
export const MISSING_DESCRIPTION =
  'It may have been removed, or the link is wrong. Every pre-read is on Meetings, beside its meeting.'
export const BACK_TO_MEETINGS = 'Back to Meetings'

// --- The form's sections (PLAN-V18 T2-5) ------------------------------------------------------

export const THE_MEETING = 'The meeting'
export const THE_COMPANY = 'The company'
export const THE_SUMMARIES = 'The summaries'

// --- The facts ---------------------------------------------------------------------------------

export const FACTS_NOTE = 'From HubSpot and our notes, with no AI.'
export const FACTS_COMING = 'The facts show in a moment.'
export const NO_FACTS = "The facts weren't read. Try again to read them."
export const DATE = 'Date'
export const TIME = 'Time'
export const WHERE_LABEL = 'Teams or in person'
export const WHO_WE_MEET = 'Who we meet'
export const CONTOUR_PEOPLE = 'Contour people'
export const COMPANY = 'Company'
export const NOT_KNOWN = 'Not known'
/** Where the meeting's date and time come from, when the server doesn't say. */
export const HUBSPOT_MEETING = 'HubSpot meeting'
export const TYPED_IN = 'Typed in'

const fullDateParts = new Intl.DateTimeFormat('en-AU', {
  timeZone: 'Australia/Melbourne',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

/** "Fri 27 Nov 2026": the meeting's day in Melbourne, in full, for the form's Date field. */
export function fullDate(at: string): string {
  const parts = fullDateParts.formatToParts(new Date(at))
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? ''
  return `${part('weekday')} ${part('day')} ${part('month')} ${part('year')}`
}

// --- The summaries ------------------------------------------------------------------------------

export const SUMMARIES_NOTE =
  'Written by AI from the facts. Change any of them: your words stay through a redraft.'
export const SUMMARY_TITLES = {
  what_they_do: 'What they do',
  what_we_know: 'What we know about the project',
  talks_so_far: 'The talks so far',
} as const

export const WRITTEN_BY_AI = 'Written by AI'
export const EDITED_BY_YOU = 'Edited by you'
export const WRITING = 'Writing the summaries.'
/** The box of a summary the AI found nothing for. */
export const NOTHING_FROM_AI = 'Nothing in the facts for this yet. Write it here.'
/** The box of a summary the rep emptied. */
export const LEFT_EMPTY = 'Left empty. Write it here.'

export const FAILED_TITLE = "The summaries weren't written"
export const FAILED_FALLBACK = 'Something went wrong while writing them. Try again.'

// --- While AI drafts it (PLAN-V18 T2-4) ---------------------------------------------------------

/** The draft's steps, each filled when its real state arrives: the facts, the summaries, ready. */
export const DRAFT_STEPS = [
  'Reading HubSpot',
  'Writing the summaries',
  'Ready for you to check',
] as const
export const DRAFT_STEPS_LABEL = 'How the draft is going'
export const DRAFTING_TITLE = 'AI is drafting this pre-read'
export const DRAFTED_TITLE = 'AI drafted this pre-read'
export const DRAFT_STOPPED = 'The draft stopped'
export const CHECK_BEFORE_SENDING = 'You check it before anyone gets it.'

/**
 * Why a draft failed, in the server's plain words (PLAN-V18 "Words for when things go wrong"):
 * "The summaries weren't written: today's AI spending limit is reached. Write them yourself, or
 * draft again tomorrow." A sentence that doesn't say what wasn't written gets the title first.
 */
export function failedReason(error: string | null | undefined): string {
  const reason = error?.trim() || FAILED_FALLBACK
  if (reason.toLowerCase().startsWith(FAILED_TITLE.toLowerCase())) return sentence(reason)
  return `${FAILED_TITLE}. ${sentence(reason)}`
}
export const TRY_AGAIN = 'Try again'
export const REDRAFT = 'Redraft'
export const EDITS_KEPT = 'Your edits are kept.'

/**
 * What one draft costs, for Redraft's button, as measured: PLAN-V17 T2-16 found about US$0.007 for
 * each of 3 real pre-reads, and one draft on 16 Nov 2026 cost US$0.0071 (PLAN-V18 M1). Not the
 * server's: its `cost_usd` adds every draft of the pre-read together, and Track 2 keeps no cost for
 * each one, so it can't say what the next draft costs: the page shows it as what was spent so far
 * (`costSoFar`).
 */
export const DRAFT_ESTIMATE = 'under US$0.01'

/** "Redraft (under US$0.01)": the button says what one more draft costs, as measured. */
export function withEstimate(label: string): string {
  return `${label} (${DRAFT_ESTIMATE})`
}

/**
 * What the pre-read's drafts have cost so far, from the server (`cost_usd`, every draft added
 * together): "US$0.06 so far.", "Under US$0.01 so far.", or null while nothing is spent.
 */
export function costSoFar(costUsd: string): string | null {
  const micros = parseMoney(costUsd)
  if (micros === null || micros <= 0n) return null
  if (micros < 10_000n) return 'Under US$0.01 so far.'
  return `${formatMoney(costUsd)} so far.`
}

/** The line beside Redraft: what it does, that the rep's edits stay, and what was spent so far. */
export function redraftHint(costUsd: string): string {
  return [`It writes the three summaries again. ${EDITS_KEPT}`, costSoFar(costUsd)]
    .filter(Boolean)
    .join(' ')
}

// --- The two blanks -----------------------------------------------------------------------------

export const YOUR_PART = 'Your part'
export const YOUR_PART_NOTE = 'Never filled by AI. Each saves when you leave it.'
export const NEXT_STEP = 'Ideal next step'
export const NEXT_STEP_PLACEHOLDER = 'Like: Book a site visit for early December.'
export const GOING = 'Who is going'
export const GOING_PLACEHOLDER = 'Like: Jo Sample and Mia Sample.'
export const SAVING = 'Saving.'
export const SAVED = 'Saved.'
export const NOT_SAVED = 'Not saved yet. Try again.'

/**
 * The status at the left of the form's footer (PLAN-V18 T2-5): "Draft ready", then when it was
 * last saved on this visit, "Draft ready, saved 2:14 pm".
 */
export function formStatusWords(statusWord: string, savedAt: string | null): string {
  return savedAt ? `${statusWord}, saved ${formatTime(savedAt)}` : statusWord
}

/** "Too long: 1,050 of 1,000 characters." */
export function tooLongWords(count: number, most: number): string {
  return `Too long: ${formatNumber(count)} of ${formatNumber(most)} characters.`
}

/** Why a save didn't go, then "Not saved yet. Try again.": "You're offline. Not saved yet. Try again." */
export function notSavedWords(error: unknown): string {
  const title = toApiProblem(error).title
  return title.trim() ? `${sentence(title)} ${NOT_SAVED}` : NOT_SAVED
}

/**
 * A blank or a summary whose save failed after the rep left the page, for a toast, since the page
 * that would say so is gone: what wasn't saved, why, and on which pre-read. `"Ideal next step"
 * wasn't saved`, then "You're offline. Open the pre-read for Sample Logistics Pty Ltd and write it
 * again."
 */
export function leftNotSavedWords(
  what: string,
  companyName: string,
  error: unknown,
): { title: string; description: string } {
  const why = toApiProblem(error).title.trim()
  return {
    title: `"${what}" wasn't saved`,
    description: [
      why ? sentence(why) : null,
      `Open the pre-read for ${companyName} and write it again.`,
    ]
      .filter(Boolean)
      .join(' '),
  }
}

// --- Check and send -----------------------------------------------------------------------------

export const CHECK_AND_SEND = 'Check and send'

/** The reason beside a greyed "Check and send". */
export const SEND_REASONS: Readonly<Record<SendBlock, string>> = {
  both: 'Fill in the ideal next step and who is going first.',
  next_step: 'Fill in the ideal next step first.',
  going: 'Fill in who is going first.',
  not_saved: "Your part isn't saved yet. Try again first.",
  drafting: 'The summaries are still being written.',
  failed: "The summaries weren't written. Try again first.",
}

// --- The send dialog (T3-11, V19 T2-3..T2-5) ----------------------------------------------------

export const SEND_TITLE = 'Send the pre-read?'
export const SEND_DESCRIPTION =
  'Check the HubSpot task, the email and who gets it. Nothing is sent until you press Send.'
export const GETTING_READY = 'Getting the pre-read ready.'
export const SAVING_FIRST = 'Saving your part first.'
export const PREVIEW_FAILED = "The pre-read couldn't be made ready, so nothing was sent."
export const THE_TASK = 'The HubSpot task'
export const TASK_BOX = 'The HubSpot task as it will arrive'
export const DUE_LABEL = 'Due:'
export const THE_EMAIL = 'The email'
export const EMAIL_BOX = 'The email as it will arrive'
export const SUBJECT = 'Subject:'
export const WHO_GETS_IT = 'Who gets it'
export const WHO_GETS_HINT =
  'Pick who gets a HubSpot task. Anyone added by email gets an email (Contour addresses only).'
export const ONLY_CONTOUR = 'Only Contour addresses can get it.'
export const TEAM_LOADING = 'Loading the team list.'
export const TEAM_UNAVAILABLE = "The team list didn't load. Add people by email, or try again."
export const YOU_TAG = 'You'
export const ALSO_EMAIL_THEM = 'Also email them'
export const ALSO_EMAIL_HINT =
  'Also emails picked team members who have a Contour account. Added email addresses always get the email.'
export const GETS_TASK = 'HubSpot task'
export const GETS_EMAIL = 'Email'
export const GETS_BOTH = 'HubSpot task · Email'
export const NO_CONTOUR_ACCOUNT = 'No Contour account · HubSpot task only'
export const NOBODY_LISTED = 'Nobody yet. Pick someone from the team or add a Contour email below.'
export const NOT_CONTOUR = "Not a Contour address, so it can't get the pre-read."
export const NOT_CHECKED = 'Not checked yet. It gets nothing until it is.'
export const CHECKING = 'Checking it is a Contour address.'
export const ADD_SOMEONE = 'Add someone'
export const ADDRESS_PLACEHOLDER = 'Their email address'
export const ADD = 'Add'
export const ADDRESS_UNREADABLE = "That doesn't look like an email address."
export const ALREADY_LISTED = 'Already on the list.'
export const ALREADY_GOT_IT = 'They already got this pre-read.'
export const TOO_MANY = `Up to ${String(MOST_PEOPLE)} people can get it.`
export const NOBODY_TICKED = 'Tick someone from the team, or add a Contour address.'
export const OVER_THE_MOST = `Send it to ${String(MOST_PEOPLE)} people or fewer.`
export const SEND = 'Send'
export const SENDING = 'Sending.'
export const CANCEL = 'Cancel'
export const HUBSPOT_NOT_CONNECTED_SEND =
  "HubSpot isn't connected, so no tasks can go. Tick 'Also email them' to send it by email."
/** With no sender set up (409 `email_not_set_up`): the email can be copied instead. */
export const COPY_PRE_READ = 'Copy the pre-read'
export const COPIED = 'Copied. Paste it into an email to the team.'
export const NOT_COPIED = "It couldn't be copied. Select the email above and copy it."

const shortDayParts = new Intl.DateTimeFormat('en-AU', {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

/** "17 Nov", or "17 Nov 2027" in another year, in Melbourne time. */
export function dayShortWords(at: string, today: string = melbourneDate(new Date())): string {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return ''
  const parts = shortDayParts.formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? ''
  const dayMonth = `${part('day')} ${part('month')}`.trim()
  if (!dayMonth) return ''
  const dayIso = melbourneDate(date)
  return dayIso.slice(0, 4) === today.slice(0, 4) ? dayMonth : `${dayMonth} ${part('year')}`.trim()
}

/** "Got it 17 Nov" or "Got it". */
export function gotItWords(at: string | null | undefined): string {
  if (!at) return 'Got it'
  const day = dayShortWords(at)
  return day ? `Got it ${day}` : 'Got it'
}

/** What one person gets in a send: "HubSpot task · Email", "HubSpot task", "Email", or null. */
export function deliveryWords(what: { task: boolean; email: boolean }): string | null {
  if (what.task && what.email) return GETS_BOTH
  if (what.task) return GETS_TASK
  if (what.email) return GETS_EMAIL
  return null
}

/** A person's best label when showing recipients: name, then address, then fallback. */
export function recipientLabel(person: {
  name?: string | null
  address?: string | null
  owner_id?: string | null
}): string {
  return person.name?.trim() || person.address?.trim() || (person.owner_id ? 'Team member' : 'Someone')
}

/** "Remove mia@example.com" */
export function removeWords(address: string): string {
  return `Remove ${address}`
}

/** "Send to 4 people", "Send to 1 person". */
export function sendToWords(count: number): string {
  return `Send to ${pluralise(count, 'person', 'people')}`
}

/** The server's `why`, as the start of a line: "On the meeting". */
export function whyLine(why: string): string {
  const text = why.trim()
  return text === '' ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}

/**
 * What a refused send says, in the server's own words: its title, then what to do. An address
 * that isn't Contour's is named there ("Take out: mia@example.com."). A lost connection says
 * whether it may have gone, as every change does. A detail that starts with the title says it
 * already ("Email isn't set up yet, so nothing was sent. ..."): it is said alone, with no title,
 * as on Meetings' Sync line.
 */
export function sendProblemWords(error: unknown): { title: string | null; detail: string | null } {
  const problem = toApiProblem(error)
  if (problem.code === 'hubspot_writes_off') {
    return { title: null, detail: HUBSPOT_NOT_CONNECTED_SEND }
  }
  const detail = changeDetail(problem)
  const title = problem.title.trim()
  if (detail?.trim().toLowerCase().startsWith(title.toLowerCase())) return { title: null, detail }
  return { title: sentence(title), detail }
}

// --- Sent (T3-11, V19 T2-4) ---------------------------------------------------------------------

export const CHANGED_AFTER_SENT = 'A change makes it a draft again, so you can send the new words.'
export const CHANGED_SINCE_SENT =
  "It changed after it was sent, so it's a draft again. Send it again to share the new words."
export const SEND_TO_MORE = 'Send to more people'
export const TRY_COPY_AGAIN = 'Try the HubSpot copy again'
export const NOBODY_EMAILED_AGAIN = 'Nobody is emailed again.'
export const TRYING_COPY = 'Trying the copy again. Nobody is emailed again.'
export const TASK_RETRY_HINT = 'Tries the task only. Nobody is emailed.'
export const TRYING_TASKS = 'Trying the HubSpot task again. Nobody is emailed.'

/** "Jo Sample", or "Jo Sample, Mia Sample and Al Sample": each by name, else by address. */
export function recipientsWords(people: readonly FormRecipient[]): string {
  const names = people.map((person) => recipientLabel(person))
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`
}

/**
 * "Sent to Jo Sample and Mia Sample on 26 Nov 2026 at 9:12 am, by Al Sample.", or "Last sent to
 * ..." for a pre-read that changed after it went.
 */
export function sentWords(
  form: Pick<MeetingFormOut, 'sent_to' | 'sent_at' | 'sent_by'>,
  last = false,
): string {
  const to = recipientsWords(form.sent_to)
  const when = form.sent_at ? ` on ${formatDate(form.sent_at)} at ${formatTime(form.sent_at)}` : ''
  const by = form.sent_by?.trim() ? `, by ${form.sent_by.trim()}` : ''
  const sent = last ? 'Last sent' : 'Sent'
  return `${to ? `${sent} to ${to}` : sent}${when}${by}.`
}

/** What one recipient got: "HubSpot task · Email · Got it 17 Nov", etc. */
export function recipientStatusWords(recipient: FormRecipient): string {
  const parts: string[] = []
  if (recipient.task === 'sent') parts.push(GETS_TASK)
  else if (recipient.task === 'waiting') parts.push('HubSpot task waiting')
  else if (recipient.task === 'failed') parts.push("HubSpot task didn't go")
  if (recipient.email) parts.push(GETS_EMAIL)
  if (recipient.at) parts.push(gotItWords(recipient.at))
  return parts.join(' · ')
}

/**
 * "Jo Sample's HubSpot task didn't go. The email still went.", or plural / without email note
 * when no one was emailed.
 */
export function tasksFailedWords(
  failed: readonly FormRecipient[],
  emailedAny: boolean,
): string {
  const who = recipientsWords(failed)
  const head =
    failed.length === 1
      ? `${who}'s HubSpot task didn't go.`
      : `${who}'s HubSpot tasks didn't go.`
  return emailedAny ? `${head} The email still went.` : head
}

/** "Jo Sample's HubSpot task waits for HubSpot write access." */
export function tasksWaitingWords(waiting: readonly FormRecipient[]): string {
  const who = recipientsWords(waiting)
  return waiting.length === 1
    ? `${who}'s HubSpot task waits for HubSpot write access.`
    : `${who}'s HubSpot tasks wait for HubSpot write access.`
}

/** "The HubSpot task wasn't tried again. ..." */
export function tasksNotTriedWords(error: unknown): string {
  const problem = toApiProblem(error)
  if (problem.code === 'hubspot_writes_off') {
    return "The HubSpot task wasn't tried again. HubSpot isn't connected."
  }
  const detail = changeDetail(problem)
  const title = problem.title.trim()
  const titleText =
    detail?.trim().toLowerCase().startsWith(title.toLowerCase()) || !title ? null : sentence(title)
  return ["The HubSpot task wasn't tried again.", titleText, detail].filter(Boolean).join(' ')
}

/**
 * Where the copy in HubSpot stands, in words, for each state: the server's sentence when it sends
 * one (it says why: "Waiting for HubSpot write access.", "This company isn't in HubSpot yet, so no
 * copy was saved there."), else these. Saved has no sentence.
 */
const COPY_WORDS: Readonly<Record<HubSpotCopy['state'], string>> = {
  saved: 'A copy is saved in HubSpot, as a note on the company.',
  waiting: 'The copy waits for HubSpot write access. The email still went.',
  off: "No copy in HubSpot: the company isn't in HubSpot yet.",
  failed: "The copy in HubSpot didn't save. The email still went.",
}

export function hubspotCopyWords(copy: HubSpotCopy): string {
  return copy.sentence?.trim() ? sentence(copy.sentence) : COPY_WORDS[copy.state]
}

/** "The copy wasn't tried again. You're offline. ..." */
export function copyNotTriedWords(error: unknown): string {
  const { title, detail } = sendProblemWords(error)
  return ["The copy wasn't tried again.", title, detail].filter(Boolean).join(' ')
}
