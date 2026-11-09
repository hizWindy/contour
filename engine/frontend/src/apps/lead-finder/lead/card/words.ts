/**
 * The words and small helpers the lead card's parts share: rule outcomes, labels, the name of each
 * source, and which source gave a fact. Plain values and functions, apart from the parts that draw.
 */
import { CircleCheck, CircleHelp, CircleX, Flag, UserCheck, type LucideIcon } from 'lucide-react'
import type { LeadDetail, Schemas } from '@/api/types'

export type RuleCheck = Schemas['RuleCheck']
export type Fact = Schemas['Fact_str_'] | Schemas['Fact_int_'] | Schemas['Fact_bool_']
export type FactSource = Schemas['FactSource']
export type SourceName = FactSource['used']
export type DecisionMaker = Schemas['DecisionMaker']
export type TriggerScore = LeadDetail['triggers'][number]

export const BAND_WORDS: Record<string, string> = {
  research_first: 'Research first',
  investigate: 'Investigate',
  nurture: 'Nurture',
}

export const OUTCOME: Record<
  RuleCheck['outcome'],
  { icon: LucideIcon; word: string; tone: string }
> = {
  ok: { icon: CircleCheck, word: 'Met', tone: 'text-pass' },
  fail: { icon: CircleX, word: 'Not met', tone: 'text-destructive' },
  director: { icon: UserCheck, word: 'Director review', tone: 'text-review' },
  unknown: { icon: CircleHelp, word: 'Not known', tone: 'text-muted-foreground' },
  flag: { icon: Flag, word: 'Check', tone: 'text-review' },
}

export const LABEL_WORDS: Record<string, string> = {
  confirmed: 'Confirmed',
  estimated: 'Estimated',
  guessed: 'Guessed',
}

/** Who gave a value. A fact with no entry in `fact_sources` came from Claude's web research. */
export const SOURCE_WORDS: Record<SourceName, string> = {
  claude: 'Claude',
  hubspot: 'HubSpot',
  signalhire: 'Signal Hire',
}

export const REASON_WORDS: Record<string, string> = {
  close_name: 'close name',
  name_in_deal: 'name in a deal',
  similar_profile: 'similar profile',
}

export function yesNo(value: unknown): string {
  return value === true ? 'Yes' : value === false ? 'No' : 'Not known'
}

export function websiteHref(domain: unknown): string | null {
  return typeof domain === 'string' && domain !== '' ? `https://${domain}` : null
}

/** What the backend says about where one fact came from, if it says anything. */
export function sourceOf(lead: LeadDetail, fact: FactSource['fact']): FactSource | undefined {
  return lead.fact_sources.find((entry) => entry.fact === fact)
}

/** The name of the source that gave a fact: Claude's research unless the backend says another. */
export function sourceWord(lead: LeadDetail, fact: FactSource['fact']): string {
  return SOURCE_WORDS[sourceOf(lead, fact)?.used ?? 'claude']
}

/** The sign that counts most (the first one on a tie), or nothing. */
export function bestTrigger(lead: LeadDetail): TriggerScore | null {
  let best: TriggerScore | null = null
  for (const item of lead.triggers) {
    if (best === null || item.points > best.points) {
      best = item
    }
  }
  return best
}

/** The people to talk to, from the source the rules list first for decision makers. */
export function peopleFirst(lead: LeadDetail): 'claude' | 'signalhire' {
  return sourceOf(lead, 'decision_makers')?.used === 'claude' ? 'claude' : 'signalhire'
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const DAYS_PER_YEAR = 365.25

interface OfficeDate {
  year: number
  month: number | null
  words: string
  day: number // the time it stands for, in ms
}

/** "2017-03" or "2017-03-14" as "March 2017", "2017" as "2017", and the day it stands for. A year
 * alone is read as 1 July, like the backend's `parse_date`. Null for anything else. */
function officeDate(text: string | null | undefined): OfficeDate | null {
  const match = /^(\d{4})(?:-(\d{1,2}))?/.exec(text?.trim() ?? '')
  if (!match) return null
  const year = Number(match[1])
  const month = match[2] === undefined ? null : Number(match[2])
  if (month !== null && (month < 1 || month > 12)) return null
  return {
    year,
    month,
    words: month === null ? String(year) : `${MONTHS[month - 1]} ${String(year)}`,
    day: Date.UTC(year, (month ?? 7) - 1, 1),
  }
}

/**
 * The office line the Overview's Summary starts with (PLAN-V11 B5), like "At this address since
 * 2017 (9 years). Last fitout May 2024.", because the years at the address now weigh more in the
 * score. The years count like the backend's, so the card and the rules agree. `today` is a
 * YYYY-MM-DD day in Melbourne. "Not known yet" when the move-in isn't known.
 */
export function officeLine(lead: LeadDetail, today: string): string {
  const since = officeDate(lead.facts.office_since.value)
  const fitout = officeDate(lead.facts.last_fitout.value)
  const [year, month] = today.split('-').map(Number)
  const sentences: string[] = []
  if (since) {
    const ahead =
      since.year > year || (since.year === year && since.month !== null && since.month > month)
    if (ahead) {
      sentences.push(`Moving to this address in ${since.words}`)
    } else {
      const years = Math.floor((Date.parse(today) - since.day) / 86_400_000 / DAYS_PER_YEAR)
      const howLong =
        years < 1 ? 'under a year' : `${String(years)} ${years === 1 ? 'year' : 'years'}`
      sentences.push(`At this address since ${since.words} (${howLong})`)
    }
  }
  // A fitout before the move-in is part of the move, so it adds nothing.
  if (fitout && (!since || fitout.day > since.day)) {
    sentences.push(`Last fitout ${fitout.words}`)
  }
  return sentences.length > 0 ? `${sentences.join('. ')}.` : 'Not known yet.'
}

/** The one person to talk to first, as "Name, role", or nothing when no page names one. */
export function firstPerson(lead: LeadDetail): string | null {
  const fromPages = lead.facts.decision_makers[0]
  const fromSignalHire = lead.signalhire_people[0]
  const page = fromPages ? `${fromPages.name}, ${fromPages.role}` : null
  const signalhire = fromSignalHire
    ? fromSignalHire.title
      ? `${fromSignalHire.name}, ${fromSignalHire.title}`
      : fromSignalHire.name
    : null
  return peopleFirst(lead) === 'claude' ? (page ?? signalhire) : (signalhire ?? page)
}
