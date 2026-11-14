/**
 * The Start page's form: its values, the body of `POST /runs` they make, and the errors by field.
 * Plain functions, so they are tested on their own (form.test.ts).
 */
import type { RunCreate, RunEstimate, RunOptions, RunSourceId } from '@/api/types'
import { pluralise } from '@/lib/format'
import { RUN_SOURCE_ORDER } from '@/lib/labels'
import { formatMoney } from '@/lib/money'

/**
 * What a person picks. `tenure` is "Old offices (lease and tenure)" (PLAN-V11 C3): a watchlist
 * run that asks the office questions first, in one city, the most staff first.
 */
export type Mode = 'discovery' | 'tenure' | 'watchlist' | 'company'
export type Area = 'cbd' | 'inner' | 'all'

/** How many companies an old offices run researches unless the person says otherwise. */
export const TENURE_LIMIT = '10'

/**
 * The national choice (PLAN-V16 T3-2): one search for each sign across Australia, in place of the
 * cities. It stands alone in the body: `cities: ["Australia"]`.
 */
export const AUSTRALIA = 'Australia'

export interface CompanyRow {
  name: string
  city: string
  website: string
}

export interface StartForm {
  mode: Mode
  cities: string[]
  area: Record<string, Area>
  triggers: string[]
  sinceDays: number
  /** "How many leads", as typed: a whole number, or empty for no goal (PLAN-V16 T3-2). */
  goalLeads: string
  /** Where to look: the web, Property Daily, Arealytics. */
  sources: RunSourceId[]
  companies: CompanyRow[]
  includeUnlikely: boolean
  includeDirector: boolean
  watchLimit: string
  tenureCity: string
  tenureIndustries: string[]
  tenureLimit: string
  runCap: string
  maxCompanies: string
}

export const EMPTY_ROW: CompanyRow = { name: '', city: '', website: '' }

/** The sources a run can use now: the ready ones, in the page's order. */
export function readySources(options: RunOptions): RunSourceId[] {
  return RUN_SOURCE_ORDER.filter((id) => options.sources[id].ready)
}

export function initialForm(options: RunOptions): StartForm {
  const defaults = options.defaults
  return {
    mode: 'discovery',
    cities: [...defaults.cities],
    area: {},
    triggers: [...defaults.triggers],
    sinceDays: defaults.since_days,
    goalLeads: String(options.goal_leads.default),
    sources: readySources(options),
    companies: [{ ...EMPTY_ROW }],
    includeUnlikely: defaults.watchlist.include_unlikely,
    includeDirector: defaults.watchlist.include_director,
    watchLimit: '',
    tenureCity: options.watchlist_cities?.[0] ?? '',
    tenureIndustries: [],
    tenureLimit: TENURE_LIMIT,
    runCap: '',
    maxCompanies: '',
  }
}

/**
 * The picked places after one group's chips changed. "All of Australia" stands alone: picking it
 * clears the cities, and picking a city clears it. The order is the options' order, so the same
 * picks always make the same body.
 */
export function pickPlaces(
  options: RunOptions,
  current: readonly string[],
  group: readonly string[],
  picked: readonly string[],
): string[] {
  if (picked.includes(AUSTRALIA)) {
    return [AUSTRALIA]
  }
  const kept = current.filter((name) => !group.includes(name) && name !== AUSTRALIA)
  const chosen = new Set([...kept, ...picked])
  return options.cities.map((city) => city.name).filter((name) => chosen.has(name))
}

/**
 * "How many leads" as a number: "20" and "20 leads" are the same. Null when it is empty or can't
 * be read.
 */
export function readGoal(text: string): number | null {
  const match = /^\s*(\d{1,3})\s*(?:leads?)?\s*$/i.exec(text)
  return match ? Number(match[1]) : null
}

/** The error beside "How many leads", or nothing. Empty is fine: the run has no goal then. */
export function goalError(form: StartForm, options: RunOptions): string | undefined {
  if (form.mode !== 'discovery' || form.goalLeads.trim() === '') {
    return undefined
  }
  const { min, max } = options.goal_leads
  const goal = readGoal(form.goalLeads)
  return goal === null || goal < min || goal > max
    ? `Type a whole number from ${String(min)} to ${String(max)}.`
    : undefined
}

/** The run's mode on the server: an old offices run is a watchlist run (PLAN-V11 C2). */
export function serverMode(mode: Mode): Exclude<Mode, 'tenure'> {
  return mode === 'tenure' ? 'watchlist' : mode
}

function clean(text: string): string | null {
  const trimmed = text.trim()
  return trimmed === '' ? null : trimmed
}

function sameSources(a: readonly RunSourceId[], b: readonly RunSourceId[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id))
}

/**
 * The body of `POST /runs` for the form: only the parts of the chosen mode (others are refused).
 * Discovery sends the goal when it can be read, and the sources only when they differ from the
 * `ready` ones (the server's own default when they are missing).
 */
export function bodyOf(form: StartForm, ready: readonly RunSourceId[]): RunCreate {
  const caps: Record<string, string | number> = {}
  const runCap = clean(form.runCap)
  const maxCompanies = clean(form.maxCompanies)
  if (runCap !== null) caps.run_cap_usd = runCap
  if (maxCompanies !== null) caps.max_companies = Number(maxCompanies)
  const params: Record<string, unknown> = Object.keys(caps).length > 0 ? { caps } : {}
  if (form.mode === 'discovery') {
    params.cities = form.cities
    params.triggers = form.triggers
    params.since_days = form.sinceDays
    params.area = Object.fromEntries(
      Object.entries(form.area).filter(
        ([city, area]) => form.cities.includes(city) && area !== 'all',
      ),
    )
    const goal = readGoal(form.goalLeads)
    if (goal !== null) params.goal_leads = goal
    if (!sameSources(form.sources, ready)) {
      params.sources = RUN_SOURCE_ORDER.filter((id) => form.sources.includes(id))
    }
  } else if (form.mode === 'watchlist') {
    const limit = clean(form.watchLimit)
    params.watchlist = {
      include_unlikely: form.includeUnlikely,
      include_director: form.includeDirector,
      ...(limit !== null ? { limit: Number(limit) } : {}),
    }
  } else if (form.mode === 'tenure') {
    const limit = clean(form.tenureLimit)
    params.watchlist = {
      focus: 'tenure',
      ...(clean(form.tenureCity) !== null ? { city: form.tenureCity } : {}),
      ...(form.tenureIndustries.length > 0 ? { industries: form.tenureIndustries } : {}),
      ...(limit !== null ? { limit: Number(limit) } : {}),
    }
  } else {
    params.companies = form.companies
      .filter((row) => clean(row.name) !== null)
      .map((row) => ({
        name: row.name.trim(),
        ...(clean(row.city) !== null ? { city: row.city.trim() } : {}),
        ...(clean(row.website) !== null ? { website: row.website.trim() } : {}),
      }))
  }
  return { app: 'lead_finder', mode: serverMode(form.mode), params }
}

/**
 * The line under "How many leads": the limit that binds when the goal doesn't fit (the backend's
 * own sentence), or else how many companies the goal needs and what that costs. Nothing while
 * there is no goal or no estimate.
 */
export function goalLine(estimate: RunEstimate | undefined, goal: number | null): string | null {
  if (goal === null || !estimate?.valid) {
    return null
  }
  if (estimate.goal_note) {
    return estimate.goal_note
  }
  if (estimate.companies_needed === null) {
    return null
  }
  const companies = pluralise(estimate.companies_needed, 'company', 'companies')
  return `About ${companies}, about ${formatMoney(estimate.cost_usd_low, { decimals: 0 })}.`
}

/** The old offices confirm's words: what the run will research, and who sees the names. */
export function tenureSummary(form: StartForm, companies: number): string {
  const many = `${String(companies)} ${companies === 1 ? 'company' : 'companies'}`
  const industries =
    form.tenureIndustries.length > 0 ? ` in ${form.tenureIndustries.join(', ')}` : ''
  return `It researches ${many} in ${form.tenureCity}${industries}, the most staff first, and sends their names to Claude.`
}

/** The errors of an estimate by field (`cities`, `companies.0.name`), like `fieldErrorMap`. */
export function estimateErrors(estimate: RunEstimate | undefined): Record<string, string> {
  const map: Record<string, string> = {}
  for (const error of estimate?.errors ?? []) {
    const field = error.field.replace(/^body\.params\.?/, '') || 'params'
    map[field] ??= error.message
  }
  return map
}

export function errorFor(errors: Record<string, string>, field: string): string | undefined {
  return errors[field] ?? Object.entries(errors).find(([key]) => key.startsWith(`${field}.`))?.[1]
}
