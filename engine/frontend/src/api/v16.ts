/**
 * PLAN-V16's contract, written by hand until the tracks meet at M1.
 *
 * Track 1 (the rules) and Track 2 (the tools) build these fields in the backend while Track 3
 * builds the website against them with `mockApi`. At M1, `npm run types` makes them from the real
 * backend: each type here then becomes its plain `Schemas[...]` in types.ts, this file goes, and
 * the `as` casts marked "until M1" in the hooks go with it. A name that differs from the backend's
 * shows up then as a type error, which M1 fixes.
 *
 * Part 1 copies `core/sources/types.py` from S0. Where the contract left a name open, the choice
 * here was sent to the track that builds it (see PLAN-V16, Track 3 Log).
 */
import type { components, operations } from './schema'

type Schemas = components['schemas']

// Part 1: property records (Track 2 makes them, Track 1 puts them on the lead card)

/** The two tools. */
export type PropertySource = 'property_daily' | 'arealytics'

/**
 * lease: a lease and its dates. move: the company moved, or will. requirement: it is looking for
 * space. fitout: a fitout, done or awarded. building: facts about the building. occupier: the
 * company is a tenant there. news: a market news item about the company.
 */
export type RecordKind =
  'lease' | 'move' | 'requirement' | 'fitout' | 'building' | 'occupier' | 'news'

/**
 * found: the tool has records. not_found: it was asked and has none. off: its switch is off.
 * error: asking failed. not_checked: not asked yet.
 */
export type SourceStatus = 'found' | 'not_found' | 'off' | 'error' | 'not_checked'

/** One fact a tool gave us about a company's office, with its link and date. */
export interface PropertyRecord {
  source: PropertySource
  kind: RecordKind
  /** As the tool wrote it. */
  company: string
  city: string | null
  address: string | null
  building: string | null
  /** As written, like "Level 12" or "12-14". */
  floor: string | null
  area_m2: number | null
  lease_start: string | null
  lease_end: string | null
  /** When the move, lease or fitout happened. */
  happened_on: string | null
  /** When the tool published the item. */
  published_on: string | null
  /** One plain sentence, written by our code. */
  summary: string
  url: string
  read_at: string
}

export interface SourceChecks {
  property_daily: SourceStatus
  arealytics: SourceStatus
}

/** Everything both tools know about one company's office, from our copy. */
export interface CompanyProperty {
  /** Newest first. */
  records: PropertyRecord[]
  checked: SourceChecks
  /** The last live lookup of either tool. Empty: never looked up. */
  looked_up_at: string | null
}

// Part 2: run options and params (Track 1 builds, Track 3 reads)

/** The four city groups, and `national` for "All of Australia". */
export type CityGroup = 'priority' | 'secondary' | 'capital' | 'regional' | 'national'

export type CityOption = Schemas['CityOption'] & { group: CityGroup }

/** Where a run may look for companies. */
export type RunSourceId = 'web' | 'property_daily' | 'arealytics'

export interface RunSourceOption {
  on: boolean
  ready: boolean
  /** One plain sentence when it isn't ready, like "Property Daily is switched off." */
  message: string | null
}

export interface GoalLeadsOption {
  default: number
  min: number
  max: number
}

export type RunOptions = Omit<Schemas['RunOptions'], 'cities'> & {
  cities: CityOption[]
  goal_leads: GoalLeadsOption
  sources: Record<RunSourceId, RunSourceOption>
}

export type LeadsBySource = Record<RunSourceId, number>

export type Run = Schemas['RunOut'] & {
  /** The good leads a manual discovery run aims for. Empty: no goal. */
  goal_leads: number | null
  /** Tier A or B leads so far. */
  good_leads: number
  leads_by_source: LeadsBySource
}

export type RunPage = Omit<Schemas['RunPage'], 'items'> & { items: Run[] }

export type RunEstimate = Schemas['RunEstimate'] & {
  /** The companies the goal needs at the recent pass rate. Empty: no goal. */
  companies_needed: number | null
  /** One sentence when the goal doesn't fit the limits, naming the limit that binds. */
  goal_note: string | null
}

// Part 3: the lead card (Track 1 builds, Track 3 reads)

export type Tier = 'A' | 'B' | 'C' | 'discard'
export type Confidence = 'high' | 'medium' | 'low'
export type Basis = 'confirmed' | 'estimated'

export type FilterId = 'location' | 'office_size' | 'headcount' | 'office_relevance' | 'sector'
export type FilterState = 'pass' | 'fail' | 'estimated'

/** One of the five filters, checked before the score. */
export interface LeadFilter {
  id: FilterId
  label: string
  state: FilterState
  /** Why, in one line: "About 1,200 m², estimated from 120 staff." */
  basis: string
}

/** Why the rules left the company out (Levi's section 3), and whether a person overrode it. */
export interface Exclusion {
  reason_id: string
  label: string
  evidence: string
  url: string | null
  /** The name of the person who overrode it. */
  overridden_by: string | null
  overridden_at: string | null
}

export type DampenerState = 'found' | 'not_found' | 'not_checked'
export type DampenerStrength = 'strong' | 'moderate'

/** A fact that lowers the score (Levi's section 5). It never removes the lead. */
export interface Dampener {
  /** recent_fitout, outsourcing, competitor_tie, procurement or financial_stress (Track 1's T1-5). */
  id: string
  label: string
  state: DampenerState
  /** How much it takes off: strong 20, moderate 10. Empty unless found (Track 1's T1-5). */
  strength: DampenerStrength | null
  evidence: string | null
  date: string | null
  url: string | null
  /** What could reverse it, like a contract renewal date. */
  can_reverse: string | null
}

/** The current office, from the first source with a value (T1-8's order). */
export interface Office {
  address: string | null
  building: string | null
  floor: string | null
  area_m2: number | null
  area_basis: Basis | null
  /** A date or a year: "2017". */
  since: string | null
  /** "At this address since at least 2017." */
  since_words: string | null
  lease_end: string | null
  lease_end_basis: Basis | null
  /** Who did the last fitout. */
  fitout_by: string | null
  /** Where the address came from: property_daily, arealytics, hubspot or web_research. */
  source: string | null
}

/** Local staff, now and projected. */
export interface Headcount {
  now: number | null
  projected: number | null
  now_basis: Basis | null
  projected_basis: Basis | null
  source_url: string | null
}

/** The space at 10 m² a person. */
export interface Space {
  now_m2: number | null
  projected_m2: number | null
}

export type ChangeKind = 'new' | 'upgraded' | 'downgraded' | 'unchanged'

export interface WhatChanged {
  kind: ChangeKind
  /** "Up from B to A: a lease end in 2028 was found." */
  text: string
}

/** What `LeadCard` (and so `LeadDetail`) gains. `score` stays, now after the dampeners. */
export interface LeadCardV16 {
  tier: Tier
  score_before_dampeners: number
  confidence: Confidence
  confidence_why: string
  filters: LeadFilter[]
  excluded: Exclusion | null
  dampeners: Dampener[]
  property: CompanyProperty | null
  office: Office | null
  headcount: Headcount | null
  space: Space | null
  contour_angle: string | null
  contact_roles: string[]
  what_changed: WhatChanged | null
}

export type LeadDetail = Schemas['LeadDetail'] & LeadCardV16

/** What a row of `GET /lead-finder/leads` gains, for the Tier column and the run page's lists. */
export type LeadRow = Schemas['LeadRow'] & {
  tier: Tier
  confidence: Confidence
  excluded: Exclusion | null
  has_property: boolean
}

export type LeadPage = Omit<Schemas['LeadPage'], 'items'> & { items: LeadRow[] }

/** The list's new filters. */
export interface LeadsQueryV16 {
  tier?: Tier[] | null
  confidence?: Confidence[] | null
  city_group?: CityGroup[] | null
  has_property?: boolean | null
  excluded?: boolean | null
}

export type LeadsQuery = NonNullable<operations['list_leads']['parameters']['query']> &
  LeadsQueryV16

// Part 4: sources for Admin (Track 2 builds, Track 3 reads). Track 2 confirmed this shape (15 Nov)
// and named the models ToolOut and ToolList, because the contract's SourceOut is the search log's.
// Check and resume answer 409 `not_connected` (Arealytics) or `source_not_ready` (off, no login or
// paused), with the sentence as the detail.

export interface ToolOut {
  id: PropertySource
  name: string
  /**
   * False for a tool we have no connector for: Arealytics, dropped from V16 on 15 Nov (it refused
   * automated access). It has no switch, no check and no resume (they answer 409).
   */
  connected: boolean
  on: boolean
  /** Empty: not checked since the backend started (it signs in again after a restart). */
  signed_in: boolean | null
  last_read_at: string | null
  pages_today: number
  pages_limit: number
  records: number
  paused_until: string | null
  /** A fixed plain sentence, never a raw error. */
  last_problem: string | null
}

export interface ToolList {
  items: ToolOut[]
}

// The automatic round (T1-11): Brisbane and the rest of Australia join the four cities. The rest
// of Australia is sent as `Australia`, like a run's national search (TBC with Track 1).

export type RoundCityName = Schemas['RoundIn']['cities'][number] | 'Brisbane' | 'Australia'

export type RoundIn = Omit<Schemas['RoundIn'], 'cities'> & { cities: RoundCityName[] }

export type RoundCityPlan = Omit<Schemas['RoundCityOut'], 'city'> & { city: RoundCityName }

export type RoundOut = Omit<Schemas['RoundOut'], 'cities' | 'city_plan'> & {
  cities: RoundCityName[]
  city_plan: RoundCityPlan[]
}

// The routes PLAN-V16 adds, in openapi-typescript's shape, for `apiV16` (v16-client.ts).

interface Json<T> {
  headers: Record<string, unknown>
  content: { 'application/json': T }
}

type Problem = Json<Schemas['ProblemDetails']>

interface NoParameters {
  query?: never
  header?: never
  path?: never
  cookie?: never
}

interface Operation<Path, Out> {
  parameters: { query?: never; header?: never; path: Path; cookie?: never }
  requestBody?: never
  responses: {
    200: Json<Out>
    403: Problem
    404: Problem
    409: Problem
    422: Problem
  }
}

interface ListOperation<Out> {
  parameters: NoParameters
  requestBody?: never
  responses: { 200: Json<Out>; 403: Problem }
}

export interface V16Paths {
  /** Judges the lead again without its exclusion, free, and records who did it (contract part 3). */
  '/lead-finder/leads/{lead_id}/override-exclusion': {
    parameters: NoParameters
    post: Operation<{ lead_id: string }, LeadDetail>
  }
  /** Each tool's state, for Admin (contract part 4). */
  '/sources': { parameters: NoParameters; get: ListOperation<ToolList> }
  /** A free sign-in check: it reads one page. */
  '/sources/{source_id}/check': {
    parameters: NoParameters
    post: Operation<{ source_id: PropertySource }, ToolOut>
  }
  /** Lifts a 24-hour pause. */
  '/sources/{source_id}/resume': {
    parameters: NoParameters
    post: Operation<{ source_id: PropertySource }, ToolOut>
  }
}
