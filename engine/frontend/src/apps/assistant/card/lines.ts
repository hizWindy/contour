/**
 * What the review card says once (DESIGN.md "Say it once"; PLAN-V23 T1-6). The command step sends
 * its unsure lines as one paragraph, which the card shows above its parts. Some of those lines a
 * part says itself, in the same words, beside its buttons: the company's ("North Wind isn't in
 * HubSpot. Add it, or pick another company."), and each "Which Sample?". The paragraph leaves
 * those out. Plain code, so the tests prove each case.
 */
import {
  isPending,
  isPersonFirst,
  isPersonNowhere,
  isSuggested,
  type CardDraft,
  type CompanyFind,
  type PersonFind,
} from './draft'
import {
  ADDED_TO_HUBSPOT,
  isntInHubspotWords,
  likelyWords,
  newInHubspotWords,
  noCompanyWords,
  personAtWords,
  personNowhereWords,
  WHICH_COMPANY,
  WHICH_PERSON,
  WHICH_TEAMMATE,
  whichWords,
} from './words'

/** What the card says under a company it found: new in HubSpot, or added from the card. */
export function foundNote(company: CompanyFind, name: string): string | null {
  if (company.added) return ADDED_TO_HUBSPOT
  return company.fromHubspot ? newInHubspotWords(name) : null
}

/** The lines the company part says itself. */
export function companyLinesOf(company: CompanyFind): string[] {
  if (company.found) {
    const note = foundNote(company, company.found.name)
    return note ? [note] : []
  }
  // A suggestion (PLAN-V25 T1-2): "Sample Logistics Pty Ltd? You meet them at 2 pm."
  const [first] = company.choices
  if (isSuggested(company) && first) return [likelyWords(first.name, company.reason)]
  if (isPending(company)) return [whichWords(company.heard, WHICH_COMPANY)]
  return [company.canAdd ? isntInHubspotWords(company.heard) : noCompanyWords(company.heard)]
}

/**
 * The lines the person part says itself: the suggestion ("Jo Sample at Northwind Sample Pty Ltd?
 * You called them on Monday.", PLAN-V25 T2-2), or "Which Jo Sample?".
 */
export function personLinesOf(person: PersonFind): string[] {
  const [first] = person.choices
  if (isSuggested(person) && first) {
    return [likelyWords(personAtWords(first.name, first.company_name), person.reason)]
  }
  return isPending(person) ? [whichWords(person.heard, WHICH_PERSON)] : []
}

/** The lines the card's own parts say. */
export function cardLinesOf(draft: CardDraft): string[] {
  if (draft.action === 'email') {
    return draft.to.flatMap((one) =>
      one.found === null && one.choices.length > 0 ? [whichWords(one.heard, WHICH_TEAMMATE)] : [],
    )
  }
  // A person named with no company: their part says it (PLAN-V25 T2-2, choice 11).
  if (draft.action === 'log_call' && isPersonNowhere(draft)) {
    return [personNowhereWords(draft.person.heard)]
  }
  const lines =
    draft.action === 'log_call' && isPersonFirst(draft) ? [] : companyLinesOf(draft.company)
  if (draft.action === 'log_call') lines.push(...personLinesOf(draft.person))
  const forWhom = draft.action === 'task' ? draft.forWhom : null
  if (forWhom?.found === null && forWhom.choices.length > 0) {
    lines.push(whichWords(forWhom.heard, WHICH_TEAMMATE))
  }
  return lines
}

/** The server's paragraph without the lines the parts say. Null when nothing is left. */
export function unsureLeft(unsure: string | null, shown: readonly string[]): string | null {
  if (!unsure) return null
  let left = unsure
  for (const line of shown) {
    if (line) left = left.split(line).join(' ')
  }
  const tidy = left.replace(/\s+/g, ' ').trim()
  return tidy === '' ? null : tidy
}
