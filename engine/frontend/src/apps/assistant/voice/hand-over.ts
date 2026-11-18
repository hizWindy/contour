/**
 * Where the voice bar hands what it heard (PLAN-V22 T3-1 and T3-2). This is the one seam the
 * review card fills (T3-3), with dictation into Log call (T3-5). The bar knows nothing of either:
 * it calls `handOver` with the command step's answer, and does what comes back.
 *
 * Until then (a placeholder, marked for T3-3):
 * - `open` goes to its page, and the bar closes (no card: choice 24);
 * - `unknown` shows its read-back (what the Assistant can do), with Try again;
 * - every other action shows its read-back in the bar, and nothing is sent;
 * - with the AI that reads commands off (409 `assistant_off`), the bar says so. T3-5 opens Log
 *   call with the words instead (choice 17).
 */
import type { AssistantCommand, AssistantOpen, CommandSource } from '@/api/types'
import { CALL_LOGS_PATH, MEETINGS_PATH, TODAY_PATH } from '../paths'
import { CANT_READ_YET } from './words'

/**
 * The Lead Finder's first page in the menu ("Start a run"). Written here, not read from its module:
 * this file loads late, and reaching into the first visit's own files from here splits them into
 * files of their own, which makes the first visit bigger. A test checks it against the module.
 */
export const LEAD_FINDER_START = '/start'

/** What the bar heard, once the command step has answered. */
export type Heard =
  /** The command step read it into an action. */
  | { kind: 'command'; command: AssistantCommand; words: string; source: CommandSource }
  /** The AI that reads commands is off: the words are only words (dictation). */
  | { kind: 'dictation'; words: string; source: CommandSource }

/** What the bar does next. */
export type AfterAnswer =
  /** The answer went where it belongs (a page, or from T3-3 the review card): the bar closes. */
  | { kind: 'close' }
  /** The bar shows this line. `again`: it offers Try again (say it another way). */
  | { kind: 'show'; line: string; unsure: string | null; again: boolean }

export interface HandOverTools {
  /** Opens a page of the app. */
  go: (to: string) => void
}

/** The address of a page the command step names. */
export function pageFor(open: AssistantOpen): string {
  switch (open.page) {
    case 'home':
      return '/'
    case 'today':
      return TODAY_PATH
    case 'meetings':
      return MEETINGS_PATH
    case 'call_logs':
      return CALL_LOGS_PATH
    case 'companies':
      return '/companies'
    case 'company':
      return open.company_key ? `/companies/${encodeURIComponent(open.company_key)}` : '/companies'
    case 'lead_finder':
      return LEAD_FINDER_START
  }
}

export function handOver(heard: Heard, { go }: HandOverTools): AfterAnswer {
  if (heard.kind === 'dictation') {
    // T3-5: Log call opens, with these words in a new call note.
    return { kind: 'show', line: CANT_READ_YET, unsure: null, again: false }
  }
  const { command } = heard
  if (command.action === 'open' && command.open) {
    go(pageFor(command.open))
    return { kind: 'close' }
  }
  // T3-3: the review card opens here, with a layout for each action (choice 24).
  return {
    kind: 'show',
    line: command.read_back,
    unsure: command.unsure,
    again: command.action === 'unknown',
  }
}
