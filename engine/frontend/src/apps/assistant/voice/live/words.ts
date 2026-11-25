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

/** Our backend didn't come back within 30 seconds (the plan's line). */
export const LIVE_DROPPED = 'Live voice stopped: the connection dropped. Using the free mic.'
