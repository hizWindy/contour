/**
 * Words for the lead card's PLAN-V16 parts (T3-4): the two property tools and their records, the
 * office, what changed, the five filters and the dampeners. Plain values and functions, tested on
 * their own (v16-words.test.ts).
 *
 * A tool with nothing to show still gets its line, and it never says "none" (Levi's section 8:
 * absence of evidence is "not found"): "Arealytics: switched off", "Property Daily: not found".
 */
import {
  ArrowDown,
  ArrowUp,
  CircleCheck,
  CircleDashed,
  CircleX,
  Equal,
  Plus,
  type LucideIcon,
} from 'lucide-react'
import type {
  ChangeKind,
  DampenerStrength,
  FilterState,
  LeadDetail,
  Office,
  PropertyRecord,
  PropertySource,
  RecordKind,
  SourceStatus,
} from '@/api/types'
import { pluralise } from '@/lib/format'

export const PROPERTY_SOURCES: readonly PropertySource[] = ['property_daily', 'arealytics']

export const PROPERTY_SOURCE_NAMES: Record<PropertySource, string> = {
  property_daily: 'Property Daily',
  arealytics: 'Arealytics',
}

const STATUS_WORDS: Record<Exclude<SourceStatus, 'found'>, string> = {
  not_found: 'not found',
  off: 'switched off',
  error: "couldn't be read this time",
  not_checked: 'not checked yet',
}

/** One line for each tool: "Property Daily: 2 records", or what happened instead. */
export function toolLine(source: PropertySource, status: SourceStatus, records: number): string {
  const name = PROPERTY_SOURCE_NAMES[source]
  if (status === 'found') {
    return `${name}: ${pluralise(records, 'record')}`
  }
  return `${name}: ${STATUS_WORDS[status]}`
}

/** Each tool's line for a lead. A lead looked up before the tools existed is "not checked yet". */
export function toolLines(lead: LeadDetail): { source: PropertySource; line: string }[] {
  const property = lead.property
  return PROPERTY_SOURCES.map((source) => {
    const status = property?.checked[source] ?? 'not_checked'
    const records = property?.records.filter((record) => record.source === source).length ?? 0
    return { source, line: toolLine(source, status, records) }
  })
}

export const RECORD_KIND_WORDS: Record<RecordKind, string> = {
  lease: 'Lease',
  move: 'Move',
  requirement: 'Looking for space',
  fitout: 'Fitout',
  building: 'Building',
  occupier: 'Tenant',
  news: 'News',
}

/** The day a record stands for: when it happened, else when it was published, else its lease start. */
export function recordDate(record: PropertyRecord): string | null {
  return record.happened_on ?? record.published_on ?? record.lease_start
}

/** Where the office facts came from (T1-8's source order). */
const OFFICE_SOURCE_WORDS: Record<string, string> = {
  property_daily: 'Property Daily',
  arealytics: 'Arealytics',
  hubspot: 'HubSpot',
  web_research: 'the research',
}

export function officeSource(office: Office): string | null {
  if (!office.source) {
    return null
  }
  return OFFICE_SOURCE_WORDS[office.source] ?? office.source
}

/** "Level 12, Acme Tower, 120 Collins Street, Melbourne": the parts the office has, in order. */
export function officeAddress(office: Office): string | null {
  const parts = [office.floor, office.building, office.address]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part !== '')
  return parts.length > 0 ? parts.join(', ') : null
}

/** True when the office has anything to show. */
export function hasOffice(office: Office | null): office is Office {
  return (
    office !== null &&
    [
      office.address,
      office.building,
      office.floor,
      office.area_m2,
      office.since_words,
      office.lease_end,
      office.fitout_by,
    ].some((value) => value !== null && value !== '')
  )
}

/** What changed since the last research of the same company: an icon and a short word. */
export const CHANGE_MARKS: Record<ChangeKind, { icon: LucideIcon; word: string }> = {
  new: { icon: Plus, word: 'New' },
  upgraded: { icon: ArrowUp, word: 'Up' },
  downgraded: { icon: ArrowDown, word: 'Down' },
  unchanged: { icon: Equal, word: 'Unchanged' },
}

/** The five filters' states. An estimated fact is never a fail (the plan's choice 3). */
export const FILTER_STATES: Record<FilterState, { icon: LucideIcon; word: string; tone: string }> =
  {
    pass: { icon: CircleCheck, word: 'Met', tone: 'text-pass' },
    fail: { icon: CircleX, word: 'Not met', tone: 'text-destructive' },
    estimated: { icon: CircleDashed, word: 'Estimated', tone: 'text-review' },
  }

/** How much a found dampener takes off the score (T1-6: strong 20, moderate 10). */
export const STRENGTH_WORDS: Record<DampenerStrength, string> = {
  strong: 'Strong: takes off 20 points',
  moderate: 'Moderate: takes off 10 points',
}

/** A Tier A lead with low confidence is checked by hand before outreach (T1-6). */
export function needsVerifying(lead: Pick<LeadDetail, 'tier' | 'confidence'>): boolean {
  return lead.tier === 'A' && lead.confidence === 'low'
}

/** An exclusion that still leaves the company out: one a person overrode no longer does. */
export function activeExclusion(lead: Pick<LeadDetail, 'excluded'>): LeadDetail['excluded'] {
  return lead.excluded && lead.excluded.overridden_by === null ? lead.excluded : null
}
