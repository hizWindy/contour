/**
 * The words of Log call (PLAN-V17 "The screens", part 1): plain, sentence case, no em dash, and
 * no setting or file name (the screen-words test reads them).
 */
import { dueDateText } from '@/lib/due-date'
import { formatNumber } from '@/lib/format'

export const LOG_CALL = 'Log call'
export const SAVE_AND_NEXT = 'Save and next'
export const BACK_TO_SCRIPT = 'Back to the script'
export const WHO_WITH = 'Who was the call with?'
export const NO_ONE = 'No one in particular'
export const NOTE_LABEL = 'Call note'
export const NOTE_PLACEHOLDER = "What happened, and what's next?"
export const OUTCOME = 'Outcome'
export const NOTHING_TO_SAVE = 'Type a note or pick an outcome first.'
export const PEOPLE_NOT_LOADED = "The people couldn't be loaded, so the call goes on the company."

export const UNDO = 'Undo'
export const TRY_AGAIN = 'Try again'
export const NOT_SAVED = 'Not saved yet. Try again.'
export const NOTE_KEPT = 'Your note is kept for this call.'
export const UNDONE = 'Undone. Your note is back as a draft.'
export const NOT_UNDONE = 'Not undone. The note is still waiting for you to confirm.'
export const FOLLOW_UP_NOT_ADDED =
  "Saved, but the follow-up wasn't added. Add it when you confirm the note."

export const FOLLOW_UP = 'Follow-up'
export const ADD_FOLLOW_UP = 'Add a follow-up'
export const REMOVE_FOLLOW_UP = 'Remove the follow-up'
export const FOLLOW_UP_WHAT = 'What to do'
export const FOLLOW_UP_WHEN = 'When'
export const WHAT_PLACEHOLDER = 'Call back about the lease'
export const WHEN_PLACEHOLDER = 'tomorrow, next tue, 24 nov'
export const WHAT_MISSING = 'Add what to do, or remove the follow-up.'
export const WHEN_MISSING = 'Add when, like tomorrow or 24 Nov.'
export const WHEN_UNREADABLE =
  "That date couldn't be read. Try tomorrow, next Tuesday, 24 Nov or 24/11."
export const WHEN_PAST = 'That day has gone. Pick today or a later day.'

/** "Saved. 7 to confirm.", or, with no count known, "Saved. Waiting for you to confirm." */
export function savedWords(toConfirm: number | null): string {
  return toConfirm === null
    ? 'Saved. Waiting for you to confirm.'
    : `Saved. ${formatNumber(toConfirm)} to confirm.`
}

/** The mic card's clock while the rep speaks: "0:42", "3:05", "1:02:05". */
export function clockText(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = String(seconds % 60).padStart(2, '0')
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${String(minutes)}:${rest}`
}

/** "5,612 of 6,000 characters", shown only near the end. */
export function countWords(length: number, max: number): string {
  return `${formatNumber(length)} of ${formatNumber(max)} characters`
}

/** The count shows from here on: the last tenth of the room. */
export function nearTheEnd(length: number, max: number): boolean {
  return max > 0 && length >= Math.floor(max * 0.9)
}

/** "Due Tue 24 Nov 2026.", and why it moved if it did. */
export function dueWords(date: string, moved: boolean): string {
  return `Due ${dueDateText(date)}${moved ? ', the Monday after the weekend' : ''}.`
}

/** The person line of the note view: "Jo Sample, Head of Operations · Sample Logistics Pty Ltd". */
export function whoLine(
  companyName: string,
  person: { name: string; title: string | null } | null,
): string {
  if (!person) return companyName
  return `${person.name}${person.title ? `, ${person.title}` : ''} · ${companyName}`
}
