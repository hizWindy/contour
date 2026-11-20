/**
 * Smart pauses (PLAN-V24 choice 8, T2-2): how long a conversation waits after the last word before
 * a turn ends. Words that sound finished end after the short pause. Words that end on a joining
 * word ("log a call with") or are a half command ("log a call") wait for the long one, so the rep
 * can finish: "Log a call with" waits; "Log a call with Northwind" doesn't. The two waits are
 * `pause` and `longPause` in `TIMES` (`bar-session.ts`), TBC at S1.
 *
 * The words are TBC too: a word missing here costs a half command sent too soon; a word too many
 * costs 1.8 seconds more of waiting.
 */
import { realWordsIn } from './turns'

/** Words that join a sentence to what comes next: a turn that ends on one isn't finished. */
export const JOINING_WORDS: ReadonlySet<string> = new Set([
  // Joining and pointing words.
  'and',
  'or',
  'but',
  'with',
  'to',
  'for',
  'from',
  'at',
  'about',
  'of',
  'on',
  'in',
  'into',
  'by',
  'via',
  'than',
  'because',
  'if',
  'that',
  // A name or a thing still to come.
  'the',
  'a',
  'an',
  'my',
  'our',
  'your',
  'their',
  'his',
  // A sentence still going.
  'is',
  'are',
  'was',
  'were',
  'will',
  'be',
  'like',
])

/**
 * Half commands: the whole turn so far is the start of one, with what it is about still to come
 * ("Log a call", "Add a task for").
 */
export const HALF_COMMANDS: ReadonlySet<string> = new Set([
  'log a call',
  'log call',
  'log the call',
  'add a task',
  'add task',
  'new task',
  'make a task',
  'email',
  'send an email',
  'email the team',
  'make the pre read',
  'make a pre read',
  'pre read',
  'open',
  'remind me',
  'follow up',
])

/**
 * True when the words sound unfinished: they end on a joining word, or are a half command. Sounds
 * like "um" don't count (`turns.ts`): "log a call with, um" ends on "with".
 */
export function soundsUnfinished(text: string): boolean {
  const words = realWordsIn(text)
  // Only sounds so far: more is coming.
  if (words.length === 0) return text.trim() !== ''
  if (JOINING_WORDS.has(words.at(-1) ?? '')) return true
  return HALF_COMMANDS.has(words.join(' '))
}

/** The pause that ends a turn of these words: the long one when they sound unfinished. */
export function pauseFor(text: string, times: { pause: number; longPause: number }): number {
  return soundsUnfinished(text) ? times.longPause : times.pause
}
