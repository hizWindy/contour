/**
 * The Start page's form: its values, the body of `POST /runs` they make, and the errors by field.
 * Plain functions, so they are tested on their own (form.test.ts).
 */
import type { RunCreate, RunEstimate, RunOptions } from '@/api/types'

/**
 * What a person picks. `tenure` is "Old offices (lease and tenure)" (PLAN-V11 C3): a watchlist
 * run that asks the office questions first, in one city, the most staff first.
 */
export type Mode = 'discovery' | 'tenure' | 'watchlist' | 'company'
export type Area = 'cbd' | 'inner' | 'all'

/** How many companies an old offices run researches unless the person says otherwise. */
export const TENURE_LIMIT = '10'

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

export function initialForm(options: RunOptions): StartForm {
  const defaults = options.defaults
  return {
    mode: 'discovery',
    cities: [...defaults.cities],
    area: {},
    triggers: [...defaults.triggers],
    sinceDays: defaults.since_days,
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

/** The run's mode on the server: an old offices run is a watchlist run (PLAN-V11 C2). */
export function serverMode(mode: Mode): Exclude<Mode, 'tenure'> {
  return mode === 'tenure' ? 'watchlist' : mode
}

function clean(text: string): string | null {
  const trimmed = text.trim()
  return trimmed === '' ? null : trimmed
}

/** The body of `POST /runs` for the form: only the parts of the chosen mode (others are refused). */
export function bodyOf(form: StartForm): RunCreate {
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
