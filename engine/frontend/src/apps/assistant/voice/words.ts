/**
 * The voice bar's words (PLAN-V22 T3-1 and T3-2, "Words for when things go wrong"): plain,
 * sentence case, no em dash, and no setting or file name (the screen-words test reads them). Each
 * problem says what happened, what still works, and the one thing to do. The mic's own problems
 * keep PLAN-V18's words (`call-notes/mic/words.ts`). The wording is Al-khair's to change.
 */

/** The top bar's mic button (choice 13). Its full name for a screen reader is "Speak (V)". */
export const SPEAK = 'Speak'
export const SPEAK_KEY = '(V)'

/** The bar's name for a screen reader. */
export const VOICE_BAR_NAME = 'Speak to the Assistant'

// --- Where the bar stands --------------------------------------------------------------------------

export const LISTENING = 'Listening'
/** While the command step reads the words: the words stay, and nothing spins. */
export const WORKING = 'Working it out'
/** The text line: its name, and the bar's title while typing. */
export const TYPE_WHAT = 'Type what to do'
/** The text line's hint: an example, so it doesn't repeat the title (TBC). */
export const TYPE_EXAMPLE = 'Like: add a task to send the quote on Friday'

/**
 * Before the first word, the bar shows what a rep can say: one example for each card action (Al-khair
 * asked what to say, 19 Nov). "Acme" stands for any client, so no real one is named (TBC).
 */
export const TRY_SAYING = 'Try saying'
export const SAY_EXAMPLES: readonly string[] = [
  'Log a call with James from Acme, follow up Friday',
  'Make the pre-read for my next meeting with Acme',
  'Add a task for Sam to send Acme the quote on Monday',
  'Email Sam that the Acme floor plan is ready',
]

// --- The keys and buttons --------------------------------------------------------------------------

/** V while listening: the talk ends, and the words go to the command step. */
export const DONE = 'Done'
/** Esc: the bar closes, and the words are thrown away. */
export const CANCEL = 'Cancel'
/** Enter in the text line. */
export const SEND = 'Send'
export const CLOSE = 'Close'
export const TRY_AGAIN = 'Try again'
export const TYPE_INSTEAD = 'Type instead'
export const CARRY_ON = 'Carry on'

// --- What can go wrong (the plan's table) ----------------------------------------------------------

export const NOTHING_HEARD = "We didn't hear anything. Press V and speak, or type what to do."
/** On a touch screen there is no V (TBC). */
export const NOTHING_HEARD_TOUCH = "We didn't hear anything. Tap Speak, or type what to do."
export const TOO_MANY = "That's a lot of commands in one minute. Wait a moment, then try again."
export const TOO_SLOW = 'That took too long. Your words are kept. Try again.'

/**
 * With the voice tool not built here (Whisper waits for S1), the bar is the text line only. The mic
 * card says "Your mic works" here, after its check; the bar opens no mic, so it says less.
 */
export const VOICE_NOT_SET_UP = "Speaking isn't available here yet."

/**
 * Until the review card (T3-3) and dictation into Log call (T3-5) are built: the AI that reads
 * commands is off, so nothing more happens with the words.
 */
export const CANT_READ_YET = "The Assistant can't read commands yet."
