/**
 * The words of the script's style (PLAN-V14 T3-5), apart from the sheet so the tests and the line
 * editor (T3-6) can use them.
 */
import { toneInUse, type ToneKey } from '@/api/hooks/script'
import type { ScriptStyleOut } from '@/api/types'
import { formatRelative } from '@/lib/format'
import { TONE_LABELS } from './playbook'

/** "Tone: Direct · Team (3 notes) and yours", or "Tone: Friendly" with no notes (PLAN-V15). */
export function styleRowWords(style: Pick<ScriptStyleOut, 'mine' | 'team' | 'tone'>): string {
  const tone = `Tone: ${TONE_LABELS[toneInUse(style)]}`
  const notes = styleSummary(style)
  return notes === 'None yet' ? tone : `${tone} · ${notes}`
}

/**
 * "Written in a Friendly tone. Research again to use Direct.", when call prep's script was written
 * in another tone than mine (PLAN-V15). A tone change spends nothing by itself.
 */
export function toneHint(
  used: ToneKey | null | undefined,
  now: ToneKey | null | undefined,
): string | null {
  if (!used || !now || used === now) return null
  return `Written in a ${TONE_LABELS[used]} tone. Research again to use ${TONE_LABELS[now]}.`
}

/** A HubSpot copy older than this says how old it is on the script (PLAN-V15, TBC). */
export const COPY_OLD_DAYS = 2

/** "HubSpot copy from 3 days ago.", once the last sync is over `COPY_OLD_DAYS` old. */
export function copyWords(
  copyAt: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!copyAt) return null
  const age = now.getTime() - new Date(copyAt).getTime()
  if (!(age > COPY_OLD_DAYS * 86_400_000)) return null
  // "3 days ago", or after a week a date: "HubSpot copy from 3 Oct 2026."
  return `HubSpot copy from ${formatRelative(copyAt, now)}.`
}

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
