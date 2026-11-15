/**
 * The words of the pre-read's page (PLAN-V17 "The screens", part 6): plain, sentence case, no em
 * dash, and no setting or file name (the screen-words test reads them). The wording is Al-khair's
 * to change.
 */
import { toApiProblem } from '@/api/client'
import type { FormRecipient, HubSpotCopy, MeetingFormOut } from '@/api/v17'
import { formatDate, formatNumber, formatTime, melbourneDate } from '@/lib/format'
import { formatMoney, parseMoney } from '@/lib/money'
import { dayText } from '../words'
import type { SendBlock } from './rules'

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

export const MISSING_TITLE = "We can't find that pre-read"
export const MISSING_DESCRIPTION =
  'It may have been removed, or the link is wrong. Every pre-read is on Meetings, beside its meeting.'
export const BACK_TO_MEETINGS = 'Back to Meetings'

// --- The facts ---------------------------------------------------------------------------------

export const FACTS = 'The facts'
export const FACTS_NOTE = 'From HubSpot and our notes, with no AI.'
export const FACTS_COMING = 'The facts show in a moment.'
export const NO_FACTS = "The facts weren't read. Try again to read them."

// --- The summaries ------------------------------------------------------------------------------

export const SUMMARIES = 'Summaries'
export const SUMMARY_TITLES = {
  what_they_do: 'What they do',
  what_we_know: 'What we know about the project',
  talks_so_far: 'The talks so far',
} as const

export const WRITTEN_BY_AI = 'Written by AI'
export const EDITED_BY_YOU = 'Edited by you'
export const WRITING = 'Writing the summaries.'
/** A summary the AI found nothing for. */
export const NOTHING_FROM_AI = 'Nothing in the facts for this yet. Write it with the pencil.'
/** A summary the rep emptied. */
export const LEFT_EMPTY = 'Left empty. Write it with the pencil.'
export const SUMMARY_HINT = "Your words take the place of the AI's, and stay through a redraft."

export const FAILED_TITLE = "The summaries weren't written"
export const FAILED_FALLBACK = 'Something went wrong while writing them. Try again.'
export const TRY_AGAIN = 'Try again'
export const REDRAFT = 'Redraft'
export const EDITS_KEPT = 'Your edits are kept.'

/**
 * What a redraft costs, for its button: "about US$0.03", "under US$0.01", or null with nothing to
 * go by (no draft has cost anything yet). `cost_usd` is what the pre-read has cost so far: Track 2
 * adds each draft's cost to it, so after a redraft it is the drafts' total (TBC: the last draft's
 * own cost, a question for Track 2).
 */
export function redraftCost(costUsd: string): string | null {
  const micros = parseMoney(costUsd)
  if (micros === null || micros <= 0n) return null
  if (micros < 10_000n) return 'under US$0.01'
  return `about ${formatMoney(costUsd)}`
}

/** "Redraft (about US$0.03)", or the label alone with nothing to go by. */
export function withCost(label: string, costUsd: string): string {
  const cost = redraftCost(costUsd)
  return cost ? `${label} (${cost})` : label
}

/** The line beside Redraft: what it does, that it costs money, and that the rep's edits stay. */
export function redraftHint(costUsd: string): string {
  return redraftCost(costUsd)
    ? `It writes the three summaries again. ${EDITS_KEPT}`
    : `It writes the three summaries again, and costs money. ${EDITS_KEPT}`
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

/** "Too long: 1,050 of 1,000 characters." */
export function tooLongWords(count: number, most: number): string {
  return `Too long: ${formatNumber(count)} of ${formatNumber(most)} characters.`
}

/** Why a save didn't go, then "Not saved yet. Try again.": "You're offline. Not saved yet. Try again." */
export function notSavedWords(error: unknown): string {
  const title = toApiProblem(error).title
  return title.trim() ? `${sentence(title)} ${NOT_SAVED}` : NOT_SAVED
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

// --- Sent ------------------------------------------------------------------------------------------

export const CHANGED_AFTER_SENT = 'A change makes it a draft again, so you can send the new words.'
export const CHANGED_SINCE_SENT =
  "It changed after it was sent, so it's a draft again. Send it again to share the new words."

/** "Jo Sample", or "Jo Sample, Mia Sample and Al Sample": each by name, else by address. */
export function recipientsWords(people: readonly FormRecipient[]): string {
  const names = people.map((person) => person.name?.trim() || person.email)
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

/** Where the copy in HubSpot stands, in words: the server's sentence, else these. */
const COPY_WORDS: Readonly<Record<HubSpotCopy['state'], string>> = {
  saved: 'A copy is saved in HubSpot, as a note on the company.',
  waiting: "The copy waits for HubSpot: writing to it isn't on yet. The email still went.",
  off: "No copy in HubSpot: the company isn't in HubSpot.",
  failed: "The copy in HubSpot didn't save. Sending again tries it again.",
}

export function hubspotCopyWords(copy: HubSpotCopy): string {
  return copy.sentence?.trim() ? sentence(copy.sentence) : COPY_WORDS[copy.state]
}

// --- When the meeting is -------------------------------------------------------------------------

/**
 * "Thu 26 Nov, 10:00 am to 11:00 am", in Melbourne time, with the year only for another year. A
 * meeting that ends on another day writes that day too.
 */
export function meetingWhen(startsAt: string, endsAt: string | null, today: string): string {
  const day = melbourneDate(startsAt)
  const start = `${dayText(day, today)}, ${formatTime(startsAt)}`
  if (!endsAt) return start
  const endDay = melbourneDate(endsAt)
  const end =
    endDay === day ? formatTime(endsAt) : `${dayText(endDay, today)}, ${formatTime(endsAt)}`
  return `${start} to ${end}`
}
