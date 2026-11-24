/**
 * The research card's and the research progress's words (PLAN-V27 T4-2, choices 18 and 19, "Words
 * on screen"). The plan's own sentences are kept word for word: "Northwind is in HubSpot. Opening
 * its call prep.", "Found: ..." (`findingLine` in `hooks/run-events.ts`), "Done: Northwind is a B
 * lead.", "Open the lead card", "Add to HubSpot" and "It's new". Every other line here is new, so it
 * is TBC until Al-khair's look. Plain, sentence case, no em dash, no setting name.
 */
import { resultLabel } from '@/lib/labels'

// --- The card ----------------------------------------------------------------------------------

/** The card's main button: it starts the run (Enter, "yes" or a tap do the same). */
export const START_RESEARCH = 'Start research'
/** Closes a card that can't start anything. */
export const CLOSE = 'Close'
/** A maybe: none of the choices is right, so the company is new (PLAN-V27 "Words on screen"). */
export const ITS_NEW = "It's new"
/** While the free block for the company picked is read. */
export const CHECKING = 'Checking what we know.'
/** What we know, as a list's name for a screen reader. */
export const WHAT_WE_KNOW = 'What we know'
/** Under the card's bar while it listens, after a spoken command. */
export const SAY_YES = "Say 'yes' or press Enter"
/** A turn said to the card in a conversation that isn't yes or no. */
export function sayYesWords(name: string): string {
  return `Say 'yes' to research ${name}, or 'cancel'.`
}
/** A new company named with no name: the server's own line, else this. */
export const NO_NAME = 'Research which company? Say or type its name.'

/** A HubSpot company that isn't quiet (the plan's words). */
export function openingPrepWords(name: string): string {
  return `${name} is in HubSpot. Opening its call prep.`
}
/** The same, for someone without call prep: its page opens instead (TBC). */
export function openingPageWords(name: string): string {
  return `${name} is in HubSpot. Call prep isn't open to you, so its page opens.`
}
/** A lead card from the last 30 days, picked from a maybe (TBC). */
export function openingLeadWords(name: string): string {
  return `${name} has a recent lead card. Opening it.`
}

// --- The progress ------------------------------------------------------------------------------

/** The progress's name, for a screen reader. */
export const RESEARCH_NAME = 'Research in the background'
export function researchingWords(name: string): string {
  return `Researching ${name}`
}
/** Said once to a screen reader as a research starts. */
export function startedWords(name: string): string {
  return `Researching ${name}. Each finding shows as it arrives.`
}
/** Before the first finding (TBC). */
export const NOTHING_YET = 'Searching the web. Each finding shows here as it arrives.'
/** What it has cost so far. */
export function soFarWords(money: string): string {
  return `${money} so far`
}

/** "Done: Northwind is a B lead." (the plan's words), "an A lead", or the result with no tier. */
export function doneWords(name: string, tier: string | null, result: string | null): string {
  const grade = (tier ?? '').trim().toUpperCase()
  if (grade === 'A') return `Done: ${name} is an A lead.`
  if (grade === 'B' || grade === 'C') return `Done: ${name} is a ${grade} lead.`
  if (grade === 'DISCARD') return `Done: ${name} isn't a lead for now.`
  if (result) return `Done: ${name}. Result: ${resultLabel(result)}.`
  return `Done: ${name}.`
}

/** A run that ended without a lead, by how it ended. The reason follows when there is one. */
export function endedWords(name: string, status: string | null, reason: string | null): string {
  const head =
    status === 'cancelled'
      ? `The research of ${name} was stopped.`
      : status === 'interrupted'
        ? `The research of ${name} was interrupted.`
        : `The research of ${name} failed.`
  const why = reason?.trim()
  return why ? `${head} ${why.replace(/[.\s]+$/, '')}.` : head
}

/** A company the run couldn't research. */
export function couldNotWords(name: string, reason: string): string {
  const why = reason.trim().replace(/[.\s]+$/, '')
  return why ? `${name} couldn't be researched: ${why}.` : `${name} couldn't be researched.`
}

/** The run can't be followed (a 4xx on its read): it goes on, on the Runs page. */
export const CANT_FOLLOW = "This research can't be followed here. It's on the Runs page."

export const OPEN_LEAD_CARD = 'Open the lead card'
export const ADD_TO_HUBSPOT = 'Add to HubSpot'
export const OPEN_THE_RUN = 'Open the run'
/** Hides one research. The run goes on, on the Runs page. */
export function hideWords(name: string): string {
  return `Hide the research of ${name}`
}

/** After "Add to HubSpot", as the lead card's own send says it. */
export const ADDED_WORDS = {
  done: 'Added to HubSpot.',
  partial: 'Part added. Open the lead card to try the rest again.',
  uncertain: "HubSpot didn't answer. Check HubSpot before trying again.",
  failed: 'Nothing was added. Try again.',
} as const
