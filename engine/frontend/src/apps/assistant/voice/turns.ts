/**
 * A conversation's turns (PLAN-V24 choices 10 and 11, T2-1): the words the code reads itself, with
 * no AI, before a turn goes to the command step.
 *
 * - **The end words:** "stop listening" or "that's all" ends the conversation, and sends nothing.
 * - **Short turns:** fewer than 2 real words (TBC) are dropped quietly, so a cough or an "um" never
 *   asks the AI. A sound like "um" or "hmm" isn't a real word.
 *
 * The card's own words ("send it", "later", "cancel") are the card's (`card/draft.ts`): they only
 * mean something while a card is open, and it reads them first.
 */

/** Sounds, not words. */
export const FILLERS: ReadonlySet<string> = new Set([
  'um',
  'umm',
  'uhm',
  'uh',
  'uhh',
  'er',
  'erm',
  'ah',
  'ahh',
  'eh',
  'oh',
  'hmm',
  'hm',
  'mm',
  'mmm',
  'mhm',
])

/** A turn needs this many real words to go to the command step (choice 11, TBC). */
export const FEWEST_WORDS = 2

/** The words of a turn, in small letters, without marks: "That's all." is "thats", "all". */
export function wordsIn(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')
}

/** The words that aren't fillers. */
export function realWordsIn(text: string): string[] {
  return wordsIn(text).filter((word) => !FILLERS.has(word))
}

/** Fewer than 2 real words: the turn is dropped quietly (choice 11). */
export function isShortTurn(text: string): boolean {
  return realWordsIn(text).length < FEWEST_WORDS
}

/** Said before or after the words that matter, and never part of them. */
const POLITE = new Set(['ok', 'okay', 'right', 'alright', 'so', 'well', 'please', 'thanks'])

/** The turn's words without fillers or a polite word at either end: "okay, that's all thanks". */
function bare(text: string): string {
  const words = realWordsIn(text)
  while (words.length > 0 && POLITE.has(words[0] ?? '')) words.shift()
  while (words.length > 0 && POLITE.has(words.at(-1) ?? '')) words.pop()
  if (words.at(-2) === 'thank' && words.at(-1) === 'you') words.splice(-2, 2)
  return words.join(' ')
}

/**
 * The whole turn must be one of these (choice 10): words that merely contain them, like "don't stop
 * listening yet", never end anything. TBC at Al-khair's look.
 */
const END_WORDS: ReadonlySet<string> = new Set([
  'stop listening',
  'stop',
  'thats all',
  'that is all',
  'thats it',
  'that is it',
  'all done',
  'im done',
  'i am done',
])

/** "Stop listening" or "that's all": the conversation ends, and nothing is sent. */
export function endsConversation(text: string): boolean {
  return END_WORDS.has(bare(text))
}
