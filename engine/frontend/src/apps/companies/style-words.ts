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

/** Adds a note to Your style, on a new line, unless it is already there. */
export function withNote(mine: string, note: string | null | undefined): string {
  const add = note?.trim()
  if (!add || mine.includes(add)) return mine
  return mine.trim() ? `${mine.trimEnd()}\n${add}` : add
}
