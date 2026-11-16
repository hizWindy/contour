/** Words and small helpers the Companies page shares (PLAN-V10). */
import { formatNumber, pluralise } from '@/lib/format'

export const WAITING_FOR_PEOPLE = 'Waiting for HubSpot access to contacts and calls.'

// Call prep's quick look (PLAN-V18 T3-7, and "Words for when things go wrong", call prep).

export const QUICK_LOOK = 'Quick look'
export const QUICK_LOOK_LOADING = 'Loading the quick facts.'
export const COMPANY_INFO = 'Company info'
export const NO_OWNER = 'No owner'
export const NO_STAFF = 'Not on record'
export const NO_LEASE = 'None on record'
export const NEXT_MEETING_NONE = 'None booked'
export const CALLING = 'Calling'
export const WHO_TO_CALL = 'Who are you calling?'
export const COLD_CALL = 'Cold call (switchboard)'
export const FACTS_FAILED =
  "The facts couldn't be read from our HubSpot copy. Try again in a moment."
/** The button under `FACTS_FAILED`: it asks for the facts again. */
export const TRY_AGAIN = 'Try again'
export const NO_PEOPLE =
  'No people on record in HubSpot for this company. The script asks the switchboard for whoever looks after the office.'
export const PREP_OFF =
  'Call scripts are switched off. The facts from HubSpot still show. An admin can switch them on.'

// Call notes around the app (PLAN-V17 T3-7): the menu's count, Home's quick buttons, Ctrl+K.

export const LOG_A_CALL = 'Log a call'
export const CALLS_TO_CONFIRM = 'Calls to confirm'
/** Ctrl+K's entry for the pre-meeting form (PLAN-V17 T3-11): it opens Meetings, upcoming. */
export const PRE_READ_FOR_A_MEETING = 'Pre-read for a meeting'

/** "7 calls to confirm", "1 call to confirm". */
export function toConfirmWords(count: number): string {
  return `${pluralise(count, 'call')} to confirm`
}

/** The words after the count: "calls to confirm", or "call to confirm" for 1. */
export function toConfirmTail(count: number): string {
  return count === 1 ? 'call to confirm' : 'calls to confirm'
}

/** The words after the count: "need a look", or "needs a look" for 1. */
export function needsLookTail(count: number): string {
  return count === 1 ? 'needs a look' : 'need a look'
}

/** "2 need a look", "1 needs a look". */
export function needsLookWords(count: number): string {
  return `${formatNumber(count)} ${needsLookTail(count)}`
}

// The company picker (`company-search.tsx`): Log call on Call logs, New pre-read on Meetings.

export const FIND_COMPANY = 'Find a company'
export const TYPE_TWO = 'Type 2 letters or more.'
export const NO_MATCH = 'No company matches.'
export const LOOKING = 'Looking.'

/** "Logistics · Perth · 300 staff", from what is known. */
export function companyPlace(company: {
  industry: string | null
  city: string | null
  staff: number | null
}): string {
  return [
    company.industry,
    company.city,
    company.staff === null ? null : `${formatNumber(company.staff)} staff`,
  ]
    .filter(Boolean)
    .join(' · ')
}
