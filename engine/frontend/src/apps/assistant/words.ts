/**
 * The Assistant's words that more than one file shows (PLAN-V22): the menu, Home, Ctrl+K and the
 * page itself, so Today has one name and one sentence everywhere (DESIGN.md "Same thing, same
 * look"). In the first visit, so it holds short strings only.
 */

/** The tab's name, in the menu, on Home, in Ctrl+K and in the breadcrumbs. */
export const ASSISTANT_NAME = 'Assistant'

/**
 * Words every page and action of the Assistant also answers to in Ctrl+K: the tab's name, and the
 * menu group Meetings and Call logs sat in until PLAN-V22, so old habits still find them.
 */
export const ASSISTANT_KEYWORDS: readonly string[] = ['assistant', 'relationships']

/** Its first page. */
export const TODAY = 'Today'

/** What Today is for (choice 6), under its name on Home and on the page. */
export const TODAY_PURPOSE =
  'Your HubSpot tasks, meetings, calls to confirm and deals that need a nudge, the most urgent first.'

/** Open the review card empty, on Today and in Ctrl+K (PLAN-V23 T4-3, the plan's words). */
export const ADD_TASK = 'Add task'
export const EMAIL_THE_TEAM = 'Email the team'
