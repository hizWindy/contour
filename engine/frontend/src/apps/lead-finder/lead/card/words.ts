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
