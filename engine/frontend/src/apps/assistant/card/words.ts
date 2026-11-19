/**
 * The review card's words (PLAN-V22 T3-3 and T3-4, choices 19 to 24, "Words for when things go
 * wrong"): plain, sentence case, no em dash, and no setting or file name (the screen-words test
 * reads them). The plan's own sentences are kept word for word. Every other line here is new, so
 * it is TBC until Al-khair's look.
 */

// --- The card -------------------------------------------------------------------------------------

export const SEND = 'Send'
export const CANCEL = 'Cancel'
/**
 * A call card's Cancel (PLAN-V23 T4-2): the call stays in Call logs' To confirm, to be sent with
 * the others in one go (Levi, 9 Nov: confirm after about 10 calls).
 */
export const LATER = 'Later'
export const SPEAK = 'Speak'
export const LEAVE_BOX = 'Leave the box'
export const REMOVE = 'Remove'
export const ADD = 'Add'

/** The hint bar's keys (choice 20). */
export const KEYS_NAME = 'Keys'

// --- The parts ------------------------------------------------------------------------------------

export const COMPANY = 'Company'
export const WHO = 'Who'
export const NO_ONE = 'No one in particular'
export const HOW_IT_WENT = 'How it went'
export const THE_NOTE = 'The note'
export const WHAT = 'What to do'
export const WHEN = 'When'
export const FOR_WHOM = 'For whom'
export const FOR_YOU = 'You'
export const KIND = 'Kind'
export const MORE = 'More words'
export const TO = 'To'
export const SUBJECT = 'Subject'
export const BODY = 'The email'
export const ADD_SOMEONE = 'Add someone'
export const ADD_PLACEHOLDER = 'A name, or a Contour address'
export const NOTHING_ADDED = "No one matches that. Type a teammate's name or a Contour address."
export const WHEN_UNREADABLE = "That day can't be read. Try tomorrow, next tue or 24 nov."
export const WHEN_PAST = 'That day has gone. Pick today or a later day.'

/** The day a "When" box reads as, under it. */
export function dueLine(day: string): string {
  return `Due ${day}`
}

/** "Which James?" (the plan's table), or "Which company?" with no name heard. */
export function whichWords(heard: string, fallback: string): string {
  const name = heard.trim()
  return name ? `Which ${name}?` : fallback
}

export const WHICH_COMPANY = 'Which company?'
export const WHICH_PERSON = 'Which person?'
export const WHICH_TEAMMATE = 'Which teammate?'
export const WHICH_MEETING = 'Which meeting?'

// --- What can go wrong (the plan's table, word for word) ----------------------------------------

/** No company found: the search list follows. */
export function noCompanyWords(heard: string): string {
  const name = heard.trim()
  return name ? `We couldn't find '${name}' in HubSpot. Pick the company.` : 'Pick the company.'
}

// --- When a name goes wrong (PLAN-V23 T1-6, the plan's table, word for word) ---------------------

/** HubSpot's own search found the company, and it is in our copy now. */
export function newInHubspotWords(name: string): string {
  return `${name} is new in HubSpot. We'll use it.`
}

/** Neither our copy nor HubSpot has it: the card offers to add it, and the search list. */
export function isntInHubspotWords(name: string): string {
  return `${name} isn't in HubSpot. Add it, or pick another company.`
}

/** HubSpot has a company with a close name. */
export function likeItWords(other: string, name: string): string {
  return `HubSpot already has ${other}. Use it, or add ${name} anyway.`
}

export const ADDING_OFF = "Adding companies to HubSpot is off for now. Pick a company that's there."

export const ADD_TO_HUBSPOT = 'Add to HubSpot'
export const ADD_ANYWAY = 'Add anyway'
/** While the add is on its way. */
export const ADDING = 'Adding.'
/** The check with HubSpot didn't answer: ask it again. */
export const TRY_AGAIN = 'Try again'

/** "Use Northwind Pty Ltd": take the company HubSpot already has. */
export function pickWords(name: string): string {
  return `Use ${name}`
}

/** The add's own boxes (TBC at Al-khair's look). */
export const COMPANY_NAME = 'Name'
export const CITY = 'City'
export const CITY_HINT = 'Optional, like Perth'
export const CHECKING_HUBSPOT = 'Checking HubSpot.'
/** Back from the add to the search list. */
export const BACK = 'Back'
/** Under the company once the rep added it (TBC). */
export const ADDED_TO_HUBSPOT = 'Added to HubSpot.'

/** No meeting ahead, for a pre-read. */
export function noMeetingWords(company: string): string {
  return `${company} has no meeting in HubSpot in the next 60 days. Start a pre-read and type the date.`
}
export const NEW_PRE_READ = 'New pre-read'

export const HUBSPOT_OFF =
  'Sending to HubSpot is off for now, so the call waits in Call logs. Nothing is lost.'
export const OPEN_CALL_LOGS = 'Open Call logs'

/** The AI is off (the plan's table): Log call opens with the words. */
export const AI_OFF =
  "The Assistant can't read commands yet, so your words are in a new call note. Pick the company, then save."

// --- V on the card --------------------------------------------------------------------------------

export const LISTENING = 'Listening'
export const WORKING = 'Working it out'
export const TYPE_CHANGE = 'Type a change'
/** A change by voice that isn't one the card can make (TBC). */
export const CARD_CAN =
  'On this card you can change a box, send or cancel. Try saying it as one of those.'

// --- Sending (T3-4) ---------------------------------------------------------------------------------

/** Under the card's bar while it listens for "send it" (the plan's words). */
export const SAY_SEND_IT = "Say 'send it' or press Enter"

/** The hold's toast: what goes in 5 seconds, by action. */
export const HOLD_TITLES = {
  log_call: 'Sending the call to HubSpot',
  task: 'Adding the task in HubSpot',
  email: 'Sending the email',
} as const

/** The hold's line under its title, with the seconds left. */
export function holdWords(seconds: number): string {
  return seconds === 1 ? 'In 1 second.' : `In ${seconds} seconds.`
}

export const UNDO = 'Undo'

/** After the send. */
export const CALL_SENT = 'The call is on its way to HubSpot.'
export const TASK_ADDED = 'Task added in HubSpot.'
export function emailSent(people: number): string {
  return people === 1 ? 'Email sent to 1 person.' : `Email sent to ${people} people.`
}
export const NOT_SENT = 'Not sent'
export const KEPT = 'Your draft is kept. Try again.'
export const OPEN = 'Open'

/** Later on a call (PLAN-V23 T4-2, the plan's words), with Open Call logs. */
export const CALL_KEPT = 'Kept in Call logs, to send with the others.'
/** Cancel: the draft stays (choice 19). */
export const DRAFT_KEPT = 'Not sent. Your draft is kept in this browser.'

/** A draft the last page closed on before it went (choice 22). */
export function draftsLeftWords(count: number): string {
  return count === 1
    ? "A draft from the Assistant wasn't sent."
    : `${count} drafts from the Assistant weren't sent.`
}
