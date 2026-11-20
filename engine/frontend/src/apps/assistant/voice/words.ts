/**
 * The voice bar's words (PLAN-V22 T3-1 and T3-2, "Words for when things go wrong"): plain,
 * sentence case, no em dash, and no setting or file name (the screen-words test reads them). Each
 * problem says what happened, what still works, and the one thing to do. The mic's own problems
 * keep PLAN-V18's words (`call-notes/mic/words.ts`). The wording is Al-khair's to change.
 */
import type { DeviceKind } from '@/apps/companies/call-notes/mic/voice-engine'

/**
 * The top bar's mic button (choice 13). Its full name for a screen reader is "Speak (V)", and
 * "Speak" while V is off (PLAN-V23 T4-1).
 */
export const SPEAK = 'Speak'
export const SPEAK_KEY = '(V)'

/** The account menu's switch for the V key (PLAN-V23 T4-1, the plan's words). */
export const USE_V = 'Use V to speak'

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
 * asked what to say, 19 Nov). They name the rep's own next company, the first company of the hint
 * list (PLAN-V23 T4-3). "Acme" stands in until the list is in, or when it has no company.
 */
export const TRY_SAYING = 'Try saying'
export const EXAMPLE_COMPANY = 'Acme'

export function sayExamples(company: string = EXAMPLE_COMPANY): readonly string[] {
  return [
    `Log a call with James from ${company}, follow up Friday`,
    `Make the pre-read for my next meeting with ${company}`,
    `Add a task for Sam to send ${company} the quote on Monday`,
    `Email Sam that the ${company} floor plan is ready`,
  ]
}

export const SAY_EXAMPLES: readonly string[] = sayExamples()

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
 * The words were too unclear to make a command (PLAN-V23 T1-6, the plan's words). The server
 * sends the same line; this one stands in when it doesn't.
 */
export function unclearWords(words: string): string {
  return `We didn't catch that clearly. You said: '${words}'. Say it again, or fix the words.`
}
/** Listen again, after unclear words. */
export const SAY_IT_AGAIN = 'Say it again'

/**
 * The voice tool setting couldn't be read (PLAN-V24 T4-3): the bar is the text line only, so no
 * voice goes anywhere and nothing downloads on a guess. It opens no mic, so it says little.
 */
export const VOICE_NOT_SET_UP = "Speaking isn't available here yet."

/**
 * Until the review card (T3-3) and dictation into Log call (T3-5) are built: the AI that reads
 * commands is off, so nothing more happens with the words.
 */
export const CANT_READ_YET = "The Assistant can't read commands yet."

// --- A long conversation (PLAN-V24 Part 2; TBC at Al-khair's look) ---------------------------------

/** The account menu's switch: one V listens across commands (choice 6, the plan's words). */
export const KEEP_LISTENING = 'Keep listening'

/** V or the button while a conversation listens: it ends, after the turn in progress. */
export const STOP = 'Stop'

/** After the first command, while the bar waits for the next (TBC). */
export const NEXT_COMMAND = "Say the next command, or “that's all” to stop."

/** The quiet stop (choice 10, the plan's words), with Start again (V). */
export const QUIET_STOP = 'Stopped listening after 2 minutes of quiet.'
export const START_AGAIN = 'Start again'

/** A phone locked, or the app left the front (choice 15, the plan's words), with Carry on. */
export const LEFT_PAGE = 'The mic stopped when you left the page. What you said so far is kept.'

/** A turn over the server's 2,000 characters (choice 9, the plan's words). */
export const TOO_LONG =
  "That's too long for one command. Your words are in the text line: shorten them, then press Enter."

// --- Get voice ready (PLAN-V24 T4-3, choice 25; TBC at Al-khair's look) ---------------------------

/** The account menu's row that downloads the model on the device ahead of the first Speak. */
export const GET_VOICE_READY = 'Get voice ready'

/** Under it: the size, and when to do it. "About 83 MB, best on Wi-Fi". */
export function getReadyHint(bytes: number | null): string {
  return bytes === null || bytes <= 0
    ? 'Best on Wi-Fi'
    : `About ${String(Math.max(1, Math.round(bytes / 1_000_000)))} MB, best on Wi-Fi`
}

/** Once this browser keeps the model, said plainly. */
export function voiceReadyOn(device: DeviceKind): string {
  return `Voice is ready on this ${device}`
}

/** Under the row, after a download from it failed. */
export const GET_READY_FAILED = "That didn't finish. Check your connection, then try again."
