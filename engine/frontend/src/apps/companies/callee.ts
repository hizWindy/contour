/**
 * Who call prep calls first (PLAN-V18 T3-7, choice 11): the panel opens straight on the quick look
 * with a person already picked, instead of "Who are you calling?". The rule:
 *
 * 1. the last person we talked to: the last call's person, else the person with the newest
 *    HubSpot activity;
 * 2. else the first person on record;
 * 3. else a cold call to the switchboard (null).
 *
 * `undefined` means neither the facts nor the record has come yet. Plain code, so the tests prove
 * each case.
 */
import type { CompanyDetail, CompanyPerson, PrepFacts } from '@/api/types'

export function defaultCallee(
  people: readonly CompanyPerson[],
  lastCallPerson: string | null,
): CompanyPerson | null {
  if (lastCallPerson) {
    const named = people.find((person) => person.name === lastCallPerson)
    if (named) return named
  }
  const talked = people
    .filter((person) => person.last_activity)
    .sort((a, b) => (b.last_activity ?? '').localeCompare(a.last_activity ?? ''))[0]
  return talked ?? people[0] ?? null
}

/** The default callee from whatever has come: the free facts first, else the company's record. */
export function calleeFrom(
  facts: PrepFacts | undefined,
  company: CompanyDetail | undefined,
  bothFailed: boolean,
): CompanyPerson | null | undefined {
  if (facts) return defaultCallee(facts.people, facts.last_call?.person ?? null)
  if (company) return defaultCallee(company.people, company.calls[0]?.person ?? null)
  // Nothing to choose from: the switchboard script still works.
  return bothFailed ? null : undefined
}
