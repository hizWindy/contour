/**
 * The words of the Rules page (PLAN-V13 T2-6): the sections, what each rule key is called in
 * plain words, what changed on 9 Nov, and which score checks belong to which part.
 * Pure data and small helpers, so the view stays about layout and the tests can read them.
 */
import type { useRules } from '@/api/hooks'
import type { SignStrength } from '@/api/types'
import type { DampenerRule } from '@/api/v16'

export type Rules = NonNullable<ReturnType<typeof useRules>['data']>
export type Criteria = Rules['criteria']
export type TbcNote = Criteria['tbc'][number]

/** The sections, in page order. The segmented control at the top jumps to them. */
export const SECTIONS = [
  { value: 'cities', label: 'Cities' },
  { value: 'filters', label: 'Filters' },
  { value: 'size', label: 'Size' },
  { value: 'signs', label: 'Signs' },
  { value: 'dampeners', label: 'Dampeners' },
  { value: 'timing', label: 'Timing' },
  { value: 'score', label: 'Score' },
  { value: 'industries', label: 'Industries' },
  { value: 'never', label: 'Never suggest' },
  { value: 'sources', label: 'Sources' },
] as const

export type SectionId = (typeof SECTIONS)[number]['value']

/** The rules Levi changed on 9 Nov (PLAN-V11), by their key in the rules files. */
export const CHANGED: Record<string, string> = {
  'size.staff_min': 'Changed 9 Nov',
  'size.staff_hint_min': 'Changed 9 Nov',
  'size.staff_floor': 'Changed 9 Nov',
  'office_age.just_moved_months': 'Changed 9 Nov',
  'office_age.tenure_years': 'Changed 9 Nov',
  'triggers.main.long_tenure': 'New 9 Nov',
  'score.years_at_address': 'Changed 9 Nov',
  'score.no_recent_move': 'Changed 9 Nov',
}

/** A rule key, in plain words, for the "Waiting on Levi" list. Unknown keys show as they are. */
export const KEY_WORDS: Record<string, string> = {
  // PLAN-V16
  'score.tiers': 'The tiers',
  'score.dampeners': 'What a dampener takes off',
  'industries.priority_sectors': 'The priority sectors',
  'cities.groups': 'The city groups',
  'cities.national': 'All of Australia, one search for each sign',
  exclusions: 'Who is left out',
  dampeners: 'The dampeners',
  'industries.director_review': 'Industries a Director decides',
  'triggers.other': 'How strong each sign is',
  'office_age.tenure_fitout_years': 'An old office: no fitout there for',
  'size.staff_counted_in': 'Staff counted in the city or the company',
  'size.m2_per_staff': 'Office size from staff',
  'size.staff_min': 'Staff that fits',
  'size.staff_hint_min': 'Staff that fits, when the office size is unknown',
  'size.staff_floor': 'Too small, dropped',
  'size.growth_signs': 'Growth signs',
  'size.staff_sources': 'Where the staff count comes from',
  'size.headcount_tool_multiplier': "Signal Hire's count, multiplied",
  'size.headcount_tool_name_check': "Signal Hire's name check",
  'size.grow_into_range_months': 'Small but growing',
  'size.director_band_m2': 'A Director decides from',
  'size.linkedin_staff_multiplier': "LinkedIn's count, multiplied",
  data_sources: 'Which source is main for which data',
  'conflicts.staff_gap_ratio': 'Staff numbers that disagree',
  'industries.check_office_size': 'Industries that get an office check',
  'industries.tier_1': 'Tier 1 industries',
  'industries.tier_2': 'Tier 2 industries',
  'fit.local_team_runs_project': 'The local team runs the project',
  'fit.healthy': 'The company is healthy',
  'triggers.best_window_years': 'The best window for a lease end',
  'triggers.consultant_window_months': 'A consultant is probably already hired',
  'triggers.recent_months': 'How old an event can be',
  'triggers.main': 'The main signs',
  triggers: 'The signs',
  boosters: 'The boosters',
  'never_suggest.dissolved_deal_wait_months': 'A dissolved deal waits',
  'office_age.due_years': 'Due for a change after',
  'office_age.recent_move_years': 'A recent move or fitout',
  'office_age.just_moved_months': 'Just moved',
  'office_age.tenure_years': 'An old office',
  'office_age.lease_guess_years': 'The lease guess on Why now',
  rivals: 'Rivals of a booming company',
  'cities.no_city_director_signs': 'Overseas, no city named yet',
  source_domains: 'The source sites',
  score: 'The score',
  'score.band_basis': 'How the bands are worked out',
  count_cities: 'Watchlist: staff counted in the three cities',
  'staff.missing': 'Watchlist: a missing staff number',
  'staff.staff_max_applies_to_director': 'Watchlist: a big Director company',
  director_industries: 'Watchlist: the Director industries',
  not_office_based: 'Watchlist: industries skipped as not office based',
}

export function keyWords(key: string): string {
  return KEY_WORDS[key] ?? key
}

/** How strong a sign is (Levi's section 4), strongest first. */
export const SIGN_STRENGTHS: readonly { id: SignStrength; label: string; hint: string }[] = [
  { id: 'very_high', label: 'Very high', hint: 'the strongest signs' },
  { id: 'high', label: 'High', hint: '' },
  { id: 'medium', label: 'Medium', hint: '' },
  { id: 'low', label: 'Low', hint: 'they support other signs' },
]

/** The red flags of procurement, in words. */
export const PROCUREMENT_WORDS: Record<string, string> = {
  tender_portal: 'a formal tender portal',
  offshore_buying: 'offshore or central global buying',
  lowest_price: 'lowest-price tenders',
  separate_design_and_build: 'design and build bought apart',
}

/**
 * How much a dampener takes off, in words: "Strong", or for a fitout "strong within 3 years,
 * moderate up to 5", or for procurement which red flag is which.
 */
export function dampenerWords(rule: DampenerRule): string {
  if (rule.strong_years !== null && rule.moderate_years !== null) {
    const outgrow =
      rule.outgrow_months !== null
        ? `. Nothing off when hiring would outgrow the space within ${String(rule.outgrow_months)} months`
        : ''
    return `Strong within ${String(rule.strong_years)} years, moderate up to ${String(rule.moderate_years)}${outgrow}`
  }
  const kinds = Object.entries(rule.kinds)
  if (kinds.length > 0) {
    const of = (strength: string) =>
      kinds
        .filter(([, value]) => value === strength)
        .map(([kind]) => PROCUREMENT_WORDS[kind] ?? kind.replace(/_/g, ' '))
    const parts = [
      of('strong').length > 0 ? `strong for ${list(of('strong'))}` : '',
      of('moderate').length > 0 ? `moderate for ${list(of('moderate'))}` : '',
    ].filter(Boolean)
    return `${parts.join('; ')}`.replace(/^./, (first) => first.toUpperCase())
  }
  return rule.strength === 'strong' ? 'Strong' : rule.strength === 'moderate' ? 'Moderate' : ''
}

export const SOURCE_WORDS: Record<string, string> = {
  hubspot: 'HubSpot',
  headcount_tool: 'Signal Hire',
  linkedin: 'LinkedIn (doubled)',
  web_research: 'the web research',
}

/** A list of sources in the order the rules look at them: 'HubSpot, then Signal Hire, then ...'. */
export function sources(order: readonly string[]): string {
  return order.map((source) => SOURCE_WORDS[source] ?? source).join(', then ')
}

export const RANK_WORDS: Record<string, string> = {
  property_daily: 'Property Daily',
  asx_or_official_news: 'ASX or official news',
  other_news: 'Other news',
  job_ads: 'Job ads',
}

export const NAME_CHECK_WORDS: Record<string, string> = {
  required: 'only a count whose company name Signal Hire has matched',
  optional: 'the count for the name as typed, and the card says it was not checked',
  auto: 'strict while its Company API answers, the name as typed while it is off',
}

/**
 * The score's parts, and the checks inside each (the keys of `score.check_labels`): Levi's Fit,
 * Change and timing, and Access (PLAN-V16 T1-6).
 */
export const PART_CHECKS: Record<string, readonly string[]> = {
  fit: ['local_staff', 'priority_sector', 'city', 'office_relevance'],
  change: ['strongest_sign', 'other_signs', 'office_constrained'],
  access: ['no_lock_in', 'procurement', 'warm_path'],
}

export interface CheckRow {
  id: string
  label: string
  /** The points, as "15 main, 10 other, 4 weak" or "7". */
  points: string
  /** True when nothing can judge it yet (`score.unseen`). */
  unseen: boolean
}

/** The checks of one part with their points, from the score rules. */
export function partChecks(score: Criteria['score'], part: string): CheckRow[] {
  const labels = score.check_labels
  const unseen = new Set(score.unseen)
  const n = (value: number) => String(value)
  const spell = (map: Record<string, number>, words: Record<string, string> = {}) =>
    Object.entries(map)
      .map(([key, value]) => `${n(value)} ${words[key] ?? key.replace(/_/g, ' ')}`)
      .join(', ')
  const points: Record<string, string> = {
    local_staff: score.local_staff
      .map((step) => `${n(step.points)} for ${n(step.from_staff)}+ staff`)
      .join(', '),
    priority_sector: n(score.priority_sector),
    city: spell(score.city),
    office_relevance: n(score.office_relevance),
    strongest_sign: spell(score.strongest_sign),
    other_signs: `${n(score.other_signs.points_each)} each, at most ${n(score.other_signs.at_most)}, within ${n(score.other_signs.within_months)} months`,
    office_constrained: n(score.office_constrained),
    no_lock_in: n(score.no_lock_in),
    procurement: n(score.procurement),
    warm_path: n(score.warm_path),
  }
  return (PART_CHECKS[part] ?? []).map((id) => ({
    id,
    label: labels[id] ?? id.replace(/_/g, ' '),
    points: points[id] ?? '',
    unseen: unseen.has(id),
  }))
}

/** The TBC notes, criteria and watchlist together, by key. */
export function tbcByKey(rules: Rules): Map<string, TbcNote> {
  const map = new Map<string, TbcNote>()
  for (const note of [...rules.criteria.tbc, ...rules.watchlist.tbc]) {
    map.set(note.key, note)
  }
  return map
}

/** "Melbourne, Adelaide and Perth". */
export function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
