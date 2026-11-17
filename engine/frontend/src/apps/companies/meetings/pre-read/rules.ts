/**
 * The pre-read's rules in plain code, with no screen (PLAN-V17 "The screens", parts 6 and 7), so
 * each can be tested on its own: the three summaries, a rep's edit to one, when "Check and send"
 * may be pressed, and who the send dialog sends it to (T3-11).
 */
import type {
  FormPerson,
  FormRecipient,
  FormSummaries,
  MeetingFormOut,
  MeetingFormStatus,
} from '@/api/types'

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

/** Text with nothing in it but spaces and stray stops, quotes or brackets. */
const NOTHING_LEFT = /^[\s.,;:'"()[\]]*$/

/**
 * The second half of a name split by a comma, as in Outlook's "Sample, Jo <jo@x.com>": words, then
 * angle brackets.
 */
function endsName(part: string | undefined): boolean {
  if (part === undefined) return false
  const open = part.search(/<[^<>]*>/)
  if (open < 0) return false
  const name = part.slice(0, open)
  return !NOTHING_LEFT.test(name) && !name.includes('@')
}

/**
 * The addresses in what the rep typed or pasted (DESIGN.md "Fields forgive"): one address, a list
 * split by commas, semicolons or spaces, or Outlook's "Jo Sample <jo@x.com>; mia@x.com", with or
 * without "mailto:". Each is kept in lower case, as the server keeps it.
 *
 * It splits on commas and semicolons first. A part with angle brackets gives the address in them,
 * and the words before them are the name. Anything after them is unreadable, so no address is ever
 * dropped without a word: "Jo <jo@x.com> mia@x.com" asks for a comma. A part with no "@" just
 * before a name with brackets is that name's first half ("Sample, Jo <jo@x.com>").
 */
export function readAddresses(text: string): ReadAddresses {
  const found: string[] = []
  const unreadable: string[] = []
  const read = (raw: string): void => {
    const address = raw
      .trim()
      .replace(/^mailto:/i, '')
      .replace(/^["'(]+|["').]+$/g, '')
      .toLowerCase()
    if (address === '') return
    if (address.length <= ADDRESS_MAX_CHARS && ADDRESS.test(address)) {
      if (!found.includes(address)) found.push(address)
    } else {
      unreadable.push(raw.trim())
    }
  }
  const parts = text.split(/[,;]/)
  parts.forEach((part, index) => {
    const bracket = /<([^<>]*)>/.exec(part)
    if (bracket) {
      read(bracket[1] ?? '')
      // A name that is an address itself ('"jo@x.com" <jo@x.com>') is read too: none is lost.
      for (const word of part.slice(0, bracket.index).split(/\s+/)) {
        if (word.includes('@')) read(word)
      }
      const after = part.slice(bracket.index + bracket[0].length)
      if (!NOTHING_LEFT.test(after)) unreadable.push(after.trim())
      return
    }
    if (!part.includes('@') && endsName(parts[index + 1])) return
    for (const word of part.split(/\s+/)) read(word)
  })
  return { found, unreadable }
}

/** Stable key for one recipient row in the send dialog. */
export function personKey(person: Pick<FormPerson, 'owner_id' | 'address'>): string {
  if (person.owner_id) return `owner:${person.owner_id}`
  return `email:${addressKey(person.address ?? '')}`
}

/** Stable key for one saved recipient in `sent_to`. */
export function recipientKey(recipient: Pick<FormRecipient, 'owner_id' | 'address'>): string {
  if (recipient.owner_id) return `owner:${recipient.owner_id}`
  return `email:${addressKey(recipient.address ?? '')}`
}

/**
 * Whether a person gets it: allowed, not already sent, and ticked by the server or changed in
 * `picks`. An address the server refuses (`allowed` false) or someone already sent (`already` set)
 * is never ticked.
 */
export function isTicked(person: FormPerson, picks: Readonly<Record<string, boolean>>): boolean {
  if (!person.allowed || person.already !== null) return false
  const key = personKey(person)
  if (key in picks) return picks[key] ?? false
  if (person.address) {
    const addr = addressKey(person.address)
    if (addr in picks) return picks[addr] ?? false
  }
  return person.ticked
}

/** Extra Contour email addresses (added or typed-author fallback, no HubSpot owner) to send to. */
export function sendEmailAddresses(
  people: readonly FormPerson[],
  picks: Readonly<Record<string, boolean>>,
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const person of people) {
    if (person.owner_id !== null || !person.address || !isTicked(person, picks)) continue
    const key = addressKey(person.address)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

/**
 * How many new people will get this send: selected HubSpot owners plus active extra email
 * addresses (not double counting an address attached to an already-selected owner).
 */
export function countSendRecipients(
  selectedOwnerIds: readonly string[],
  people: readonly FormPerson[],
  picks: Readonly<Record<string, boolean>>,
): number {
  const ownerAddrs = new Set<string>()
  for (const person of people) {
    if (person.owner_id && selectedOwnerIds.includes(person.owner_id) && person.address) {
      ownerAddrs.add(addressKey(person.address))
    }
  }
  const extra = sendEmailAddresses(people, picks).filter((addr) => !ownerAddrs.has(addr))
  return selectedOwnerIds.length + extra.length
}

/** The draft's steps: reading HubSpot, writing the summaries, ready for the rep (PLAN-V18 T2-4). */
export const DRAFT_STEP_COUNT = 3

/**
 * How many of the draft's steps have arrived, from what the server says, never from a timer.
 * Drafting with no facts yet: HubSpot is being read. The facts are there: the summaries are being
 * written. A draft, or sent: ready for the rep. A failure stops at the step it reached.
 */
export function draftReached(form: Pick<MeetingFormOut, 'status' | 'facts'>): number {
  if (form.status === 'drafting' || form.status === 'failed') {
    return form.facts.length > 0 ? 2 : 1
  }
  return DRAFT_STEP_COUNT
}
