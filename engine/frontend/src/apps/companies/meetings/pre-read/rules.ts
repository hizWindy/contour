/**
 * The pre-read's rules in plain code, with no screen (PLAN-V17 "The screens", parts 6 and 7), so
 * each can be tested on its own: the three summaries, a rep's edit to one, when "Check and send"
 * may be pressed, and who the send dialog sends it to (T3-11).
 */
import type { FormPerson, FormSummaries, MeetingFormOut, MeetingFormStatus } from '@/api/v17'

export type SummaryName = keyof FormSummaries

/** The three summaries, in the order the page and the email show them. */
export const SUMMARY_NAMES: readonly SummaryName[] = [
  'what_they_do',
  'what_we_know',
  'talks_so_far',
]

/** The most a summary may hold (the server's limit). */
export const SUMMARY_MAX_CHARS = 2000

/** The most each blank may hold (the server's limit). */
export const BLANK_MAX_CHARS = 1000

/**
 * The form with one summary in the rep's words: marked theirs at once (`by: person`), with its
 * sources kept, as the server keeps them.
 */
export function withSummary(form: MeetingFormOut, name: SummaryName, text: string): MeetingFormOut {
  return {
    ...form,
    summaries: { ...form.summaries, [name]: { ...form.summaries[name], text, by: 'person' } },
  }
}

/** Some summary has words: from this draft, an earlier one, or the rep. */
export function hasSummaries(form: Pick<MeetingFormOut, 'summaries'>): boolean {
  return SUMMARY_NAMES.some((name) => form.summaries[name].text.trim() !== '')
}

/**
 * Why "Check and send" is greyed, or null when it may be pressed. The two blanks come first, since
 * the rep can fill them in while the summaries are written. Then a blank that didn't save, and
 * then the draft itself: the server sends only a pre-read whose summaries are written.
 */
export type SendBlock = 'both' | 'next_step' | 'going' | 'not_saved' | 'drafting' | 'failed'

export interface SendState {
  status: MeetingFormStatus
  /** What the two blanks hold now, as the rep sees them. */
  nextStep: string
  going: string
  /** A blank's last save failed, so the server doesn't have it. */
  unsaved: boolean
}

export function sendBlock({ status, nextStep, going, unsaved }: SendState): SendBlock | null {
  const noNextStep = nextStep.trim() === ''
  const noGoing = going.trim() === ''
  if (noNextStep && noGoing) return 'both'
  if (noNextStep) return 'next_step'
  if (noGoing) return 'going'
  if (unsaved) return 'not_saved'
  if (status === 'drafting') return 'drafting'
  if (status === 'failed') return 'failed'
  return null
}

// --- Who gets it (T3-11) ------------------------------------------------------------------------

/** The most people one send may go to, and the longest address (the contract's limits). */
export const MOST_PEOPLE = 20
export const ADDRESS_MAX_CHARS = 254

/** An address as the server keeps it, to tell two apart: "Jo@X.com" is "jo@x.com". */
export function addressKey(address: string): string {
  return address.trim().toLowerCase()
}

/** Something@somewhere.something, with no space, bracket or quote in it. */
const ADDRESS = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:".]+$/

export interface ReadAddresses {
  /** Each address found, in lower case, once. */
  found: string[]
  /** What was typed that can't be an address. */
  unreadable: string[]
}

/**
 * The addresses in what the rep typed or pasted (DESIGN.md "Fields forgive"): one address, a list
 * split by commas, semicolons or spaces, or Outlook's "Jo Sample <jo@x.com>; Mia <mia@x.com>",
 * with or without "mailto:". Each is kept in lower case, as the server keeps it.
 */
export function readAddresses(text: string): ReadAddresses {
  const bracketed = [...text.matchAll(/<([^<>]*)>/g)].map((match) => match[1] ?? '')
  const parts = bracketed.length > 0 ? bracketed : text.split(/[\s,;]+/)
  const found: string[] = []
  const unreadable: string[] = []
  for (const part of parts) {
    const address = part
      .trim()
      .replace(/^mailto:/i, '')
      .replace(/^["'(]+|["').]+$/g, '')
      .toLowerCase()
    if (address === '') continue
    if (address.length <= ADDRESS_MAX_CHARS && ADDRESS.test(address)) {
      if (!found.includes(address)) found.push(address)
    } else {
      unreadable.push(part.trim())
    }
  }
  return { found, unreadable }
}

/**
 * Whether a person gets it: the server's tick, unless the rep changed it (`picks`, by address).
 * An address the server refuses (`allowed` false) is never ticked, whatever was picked.
 */
export function isTicked(person: FormPerson, picks: Readonly<Record<string, boolean>>): boolean {
  return person.allowed && (picks[addressKey(person.email)] ?? person.ticked)
}

/** The addresses to send it to: the ticked people, in the order the server listed them. */
export function sendTo(
  people: readonly FormPerson[],
  picks: Readonly<Record<string, boolean>>,
): string[] {
  return people.filter((person) => isTicked(person, picks)).map((person) => person.email)
}
