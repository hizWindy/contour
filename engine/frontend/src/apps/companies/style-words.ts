/**
 * The words of the script's style (PLAN-V14 T3-5), apart from the sheet so the tests and the line
 * editor (T3-6) can use them.
 */
import type { ScriptStyleOut } from '@/api/types'

/** "Team (3 notes) and yours", "Yours", "None yet". */
export function styleSummary(style: Pick<ScriptStyleOut, 'mine' | 'team'>): string {
  const team = style.team.length
  const teamWords = team === 0 ? null : `Team (${String(team)} ${team === 1 ? 'note' : 'notes'})`
  const mine = style.mine.trim() !== ''
  if (teamWords && mine) return `${teamWords} and yours`
  if (teamWords) return teamWords
  return mine ? 'Yours' : 'None yet'
}

const NOTE_LEADS: Record<string, string> = {
  opener: 'Open like',
  why_now: 'Give the reason like',
  question: 'Ask like',
  if_they_say: 'Answer pushback like',
  goal: 'Aim the call at',
}
const NOTE_QUOTE_CHARS = 160

/**
 * A style note from a line the person wrote, for "Make it my style": `Open like: "Hi Jason, it's
 * Tom..."`. The quote is cut so the note stays short; the person can change it before saving.
 */
export function styleNoteFor(slot: string, text: string): string {
  const lead = NOTE_LEADS[slot.split('.')[0] ?? ''] ?? 'Say it like'
  const flat = text.trim().replace(/\s+/g, ' ')
  const quote =
    flat.length <= NOTE_QUOTE_CHARS ? flat : `${flat.slice(0, NOTE_QUOTE_CHARS - 3).trimEnd()}...`
  return `${lead}: "${quote}"`
}

/** Adds a note to Your style, on a new line, unless it is already there. */
export function withNote(mine: string, note: string | null | undefined): string {
  const add = note?.trim()
  if (!add || mine.includes(add)) return mine
  return mine.trim() ? `${mine.trimEnd()}\n${add}` : add
}
