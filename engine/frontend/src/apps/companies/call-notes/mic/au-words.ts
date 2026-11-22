/**
 * The Australian word list (PLAN-V25 T4-1 and T4-2, choices 16 and 17): words the mic listens for
 * on top of general English. It loads with the mic, never in the first visit.
 *
 * - **Office words** the team says, for Chrome's hints when they are on, and as names the fix may
 *   put right (TBC with Levi, the plan's S1).
 * - **Places** come from our copy of HubSpot, with the hint list (`AssistantNames.places`), not
 *   from here.
 * - **Said like:** a short list of names as people say them, when the sound alone doesn't find them
 *   ("Pran" for Prahran). It grows from the team's corrections (TBC).
 */

/** The office words (choice 16, TBC with Levi). */
export const OFFICE_WORDS: readonly string[] = [
  'fitout',
  'NLA',
  'CBD',
  'tenancy',
  'sqm',
  'make good',
]

/**
 * Names as they are said, by the words heard, in lower case (choice 17). Each is fixed wherever
 * it is heard, as a whole word, and shows once on the card.
 */
export const SAID_LIKE: Readonly<Record<string, string>> = {
  pran: 'Prahran',
}
