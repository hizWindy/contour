/**
 * Where a research command goes (PLAN-V27 T4-2, choice 18), in plain functions the voice bar's
 * hand-over and the research card share:
 *
 * - `open_lead`: the lead card from the last 30 days opens at once. No new research, no cost.
 * - `open_prep`: a HubSpot company that isn't quiet opens its call prep, on the company's page, as
 *   Companies' "Prep a call" does (`?prep=1`). Someone without call prep gets its page, and is told.
 * - `ask` and `choose`: the research card. `needs_name`: the bar asks for a name.
 *
 * "yes" is read here too, with no AI: "yes", "use it", "send it" or "start" starts the run, and
 * "no" or "cancel" closes the card.
 */
import type { AssistantResearch } from '@/api/types'
import { yesOrNo } from './choose'
import { sendOrCancel } from './draft'
import { openingLeadWords, openingPageWords, openingPrepWords } from './research-words'

/** A company's page with its call prep open (`company-page.tsx` reads `prep`). */
export function prepPath(companyKey: string): string {
  return `/companies/${encodeURIComponent(companyKey)}?prep=1`
}

export function companyPath(companyKey: string): string {
  return `/companies/${encodeURIComponent(companyKey)}`
}

export function leadPath(leadId: string): string {
  return `/leads/${encodeURIComponent(leadId)}`
}

/** Where a settled research opens, and the line that says so; null when it doesn't open a page. */
export function placeOf(
  research: AssistantResearch,
  name: string,
  canPrep: boolean,
): { to: string; line: string } | null {
  if (research.next === 'open_lead' && research.lead) {
    return { to: research.lead.link, line: openingLeadWords(name) }
  }
  if (research.next === 'open_prep' && research.company_key) {
    return canPrep
      ? { to: prepPath(research.company_key), line: openingPrepWords(name) }
      : { to: companyPath(research.company_key), line: openingPageWords(name) }
  }
  return null
}

const START_WORDS: ReadonlySet<string> = new Set(['start', 'start it', 'go', 'go ahead', 'do it'])

/** A whole turn that answers the research card's one question, or null. */
export function startOrNot(said: string): 'start' | 'cancel' | null {
  const plain = said
    .toLowerCase()
    .replace(/[^a-z' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (START_WORDS.has(plain)) return 'start'
  const answer = yesOrNo(said)
  if (answer === 'yes') return 'start'
  if (answer === 'no') return 'cancel'
  const sent = sendOrCancel(said)
  if (sent === 'send') return 'start'
  if (sent === 'cancel') return 'cancel'
  return null
}
