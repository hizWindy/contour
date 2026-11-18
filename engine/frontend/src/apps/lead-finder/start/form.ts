/**
 * The Start page's form: its values, the body of `POST /runs` they make, and the errors by field.
 * Plain functions, so they are tested on their own (form.test.ts).
 */
import type { RunCreate, RunEstimate, RunOptions, RunSourceId } from '@/api/types'
import { RUN_SOURCE_ORDER } from '@/lib/labels'

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
  /** How many companies a discovery run tries to research, as typed (PLAN-V21 T3-3). */
  targetCompanies: string
  /** Fill a short discovery run from the HubSpot watchlist (PLAN-V21 T3-3). */
  topUp: boolean
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
    targetCompanies: String(options.target_companies.default),
    topUp: options.top_up.default,
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
 * A whole number as people type it: "50", " 50 ", "1,000" and "50 companies" all read as numbers
 * (DESIGN.md "Fields forgive"). Null for anything else, like "fifty" or "5.5".
 */
export function wholeNumberOf(text: string): number | null {
  const cleaned = text
    .trim()
    .replace(/,/g, '')
    .replace(/\s*compan(?:y|ies)$/i, '')
  return /^\d{1,6}$/.test(cleaned) ? Number(cleaned) : null
}

/**
 * The most companies this run may research: the run's company limit, or the lower number typed
 * in "Most companies to research" (the Limits fold). It is the target's ceiling.
 */
export function companyCeiling(form: StartForm, options: RunOptions): number {
  const lowered = wholeNumberOf(form.maxCompanies)
  const limit = options.target_companies.max
  return lowered !== null && lowered > 0 ? Math.min(limit, lowered) : limit
}

/** What the form does with the typed target (PLAN-V21 T3-3). */
export interface TargetChoice {
  /** What the body sends. Null leaves it out, and the run aims for the default. */
  value: number | null
  /** Why the typed number can't be used, in plain words. */
  error: string | null
  /**
   * The lower number the run aims for when "Most companies to research" is under the target. The
   * typed target stays as it is, so raising the limit again brings it back.
   */
  pulledTo: number | null
}

/** The target to send, read from the field and kept under the run's ceiling. */
export function targetChoice(form: StartForm, options: RunOptions): TargetChoice {
  const { min, max } = options.target_companies
  if (form.targetCompanies.trim() === '') {
    return { value: null, error: null, pulledTo: null }
  }
  const asked = wholeNumberOf(form.targetCompanies)
  if (asked === null) {
    return { value: null, error: 'Type a whole number, like 50.', pulledTo: null }
  }
  if (asked < min) {
    return { value: null, error: `Pick ${String(min)} or more.`, pulledTo: null }
  }
  if (asked > max) {
    return {
      value: null,
      error: `Pick at most ${String(max)}: the run's company limit.`,
      pulledTo: null,
    }
  }
  const ceiling = companyCeiling(form, options)
  if (asked <= ceiling) {
    return { value: asked, error: null, pulledTo: null }
  }
  // Under the smallest target the server takes, the target is left out and the server pulls its
  // default down to the limit too.
  return { value: ceiling >= min ? ceiling : null, error: null, pulledTo: ceiling }
}

/**
 * The body of `POST /runs` for the form: only the parts of the chosen mode (others are refused).
 * Discovery sends the sources only when they differ from the `ready` ones (the server's own
 * default when they are missing). It sends no goal: a run researches every company it chooses
 * (PLAN-V20). It sends how many companies to research and the top up (PLAN-V21), which only
 * discovery takes: the top up is off when the backend doesn't allow it.
 */
export function bodyOf(form: StartForm, options: RunOptions): RunCreate {
  const ready = readySources(options)
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
    if (!sameSources(form.sources, ready)) {
      params.sources = RUN_SOURCE_ORDER.filter((id) => form.sources.includes(id))
    }
    const target = targetChoice(form, options).value
    if (target !== null) {
      params.target_companies = target
    }
    // Only with the web search: without it the run researches just the tools' new items (M1)
    params.top_up = form.topUp && options.top_up.allowed && form.sources.includes('web')
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
