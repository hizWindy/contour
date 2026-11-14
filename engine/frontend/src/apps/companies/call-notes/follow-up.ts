/**
 * The one follow-up a rep can add by hand while the AI is off (PLAN-V17 choice 2): what to do,
 * and when. The "when" forgives ("next tue", "24 nov", "24/11", "in 2 weeks", "tomorrow"), through
 * `readDueDate`. With the AI on there is no follow-up line, because the sorter finds tasks.
 */
import type { CallNoteTaskIn, TaskKind } from '@/api/v17'
import { readDueDate } from '@/lib/due-date'
import { melbourneDate } from '@/lib/format'
import type { FollowUpDraft } from './draft'
import { WHAT_MISSING, WHEN_MISSING, WHEN_PAST, WHEN_UNREADABLE } from './words'

/**
 * The kind of task, from its words: "Email the floor plan" is an email, "Call Jo back" a call, the
 * rest a to-do. The rep sees it and can change it when they confirm the note (T3-6).
 */
export function taskKindOf(subject: string): TaskKind {
  const words = subject.toLowerCase()
  if (/\be-?mail\b/.test(words)) return 'email'
  if (/\b(call|ring|phone)\b/.test(words)) return 'call'
  return 'todo'
}

export type FollowUpCheck =
  /** Ready: the task to send, or null when there is no follow-up. */
  | { ok: true; task: CallNoteTaskIn | null }
  /** Not ready: which field, and what to say under it. */
  | { ok: false; field: 'what' | 'when'; words: string }

/** Checks the follow-up before a save, and makes the task to send. */
export function checkFollowUp(
  followUp: FollowUpDraft | null,
  today: string = melbourneDate(),
): FollowUpCheck {
  const subject = followUp?.subject.trim() ?? ''
  const when = followUp?.when.trim() ?? ''
  if (subject === '' && when === '') return { ok: true, task: null }
  if (subject === '') return { ok: false, field: 'what', words: WHAT_MISSING }
  const due = readDueDate(when, today)
  switch (due.kind) {
    case 'empty':
      return { ok: false, field: 'when', words: WHEN_MISSING }
    case 'unreadable':
      return { ok: false, field: 'when', words: WHEN_UNREADABLE }
    case 'past':
      return { ok: false, field: 'when', words: WHEN_PAST }
    case 'date':
      return {
        ok: true,
        task: { subject, due: due.date, due_words: when, kind: taskKindOf(subject) },
      }
  }
}
