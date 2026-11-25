/**
 * Live voice's words (PLAN-V28 "Words on screen"): plain, sentence case, no em dash, and no setting
 * or file name (the screen-words test reads them). "Listening", "Working it out" and
 * "Reconnecting" are the bar's own words, so the pill says the same thing either way. The wording
 * is Al-khair's to change (TBC at his look).
 */

/** While the start, the mic and the socket get ready. */
export const CONNECTING = 'Connecting'
/** While the Assistant's voice plays: until its buffer is empty. */
export const SPEAKING = 'Speaking'
/** Mute is on: no sound goes, and the talk goes on. */
export const MUTED = 'Muted'

/** The button: no sound goes while it is on (`aria-pressed`). */
export const MUTE = 'Mute'

/**
 * Who said what, in the captions: the rep's words as Google hears them, then the Assistant's.
 * Each line carries its word, so who said it never rests on colour alone (TBC at the look).
 */
export const YOU = 'You'
export const ASSISTANT = 'Assistant'

// --- Why the free mic took over (T4-1: the plan's lines, as the relay sends them) ---------------

/** The connection dropped: two reconnects failed, or our backend didn't come back in 30 s. */
export const LIVE_DROPPED = 'Live voice stopped: the connection dropped. Using the free mic.'
/** This month's limit is reached: live voice stays off until the month changes. */
export const LIVE_LIMIT =
  "Live voice is off for now: this month's limit is reached. Using the free mic."
/** Google, or the relay, couldn't be reached; or the browser is offline. */
export const LIVE_UNREACHABLE = "Live voice can't reach Google. Using the free mic."
/** Anything else that ended it (the relay's own line for an error). */
export const LIVE_WRONG = 'Live voice stopped: something went wrong. Using the free mic.'

// --- What the Assistant says back to a tool call (T3-1, T3-2; new words TBC at T5-2) ----------

/** A card opened, or a change made to it (the plan's words). */
export const READY = 'Ready. Say send it.'
/** The card's Send has worked, after its 5-second hold (choice 7). */
export const SENT_LINE = 'Sent.'
/**
 * The card's Send is still going 3 s before the relay would answer for it ("That took too long"):
 * the card's own line says how it ends (the coordinator's words, 25 Nov; TBC at T5-2).
 */
export const STILL_SENDING = "Still sending. The card will say when it's done."
/** Undo was pressed in the hold, or the hold stopped: nothing went. */
export const NOT_SENT_LINE = 'Not sent.'
/** "Send" came only from Gemini's words, never the rep's (choice 7): nothing went. */
export const SAY_SEND_IT_FIRST = "Nothing was sent. To send it, say 'send it'."
/** "Cancel" came only from Gemini's words (choice 7): nothing changed. */
export const SAY_CANCEL_FIRST = "Nothing was cancelled. To cancel it, say 'cancel'."
/** "Send it" while the card still needs something, or is still getting ready: it shows what. */
export const FILL_IN_FIRST = "The card isn't ready to send yet. Check it, then say 'send it'."
/** The research card's "cancel": no research started. */
export const RESEARCH_CANCELLED = 'Cancelled. Nothing was spent.'
/** The card a turn was said to closed while it was read. */
export const CARD_GONE = 'That card is closed now. Say it again if you still want it.'
/** With the AI that reads commands off, the words went into a new call note (choice 17). */
export const IN_A_NOTE = 'Your words are in a new call note. Check it, then send it.'
/** Something done that has no line of its own. */
export const DONE = 'Done.'
/** What a card did couldn't be told: nothing is claimed. */
export const NOT_DONE = "That didn't work. Check the card, then try again."
