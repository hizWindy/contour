/**
 * The pure part of the run details: what a run was asked to do (from its saved parameters), how
 * long it took, and where its money went (from its search log). The run page's cards show these.
 *
 * A run's parameters are stored as the person chose them, so a field may be missing (a default) or
 * from an older version of the form. Everything here reads them defensively and skips what it
 * can't read, rather than breaking the page.
 */
import type { Run, SearchOut } from '@/api/types'
import { formatDateTime, formatDuration, pluralise } from '@/lib/format'
import { RUN_MODE_LABELS } from '@/lib/labels'
import { addMoney, formatMoney, moneyToString, parseMoney } from '@/lib/money'

export interface DetailLine {
  label: string
  value: string
}

/** Names for the ids a run's parameters hold: sign (trigger) labels and area labels. */
export interface DetailNames {
  triggers: ReadonlyMap<string, string>
}

const AREA_WORDS: Record<string, string> = { cbd: 'CBD', inner: 'inner suburbs', all: 'whole city' }

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function money(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' ? formatMoney(String(value)) : null
}

/** What the run was asked to do, as plain lines: kind, where, which signs, limits. */
export function setupLines(run: Run, names: DetailNames): DetailLine[] {
  const params = record(run.params)
  const lines: DetailLine[] = [{ label: 'Kind', value: RUN_MODE_LABELS[run.mode] ?? run.mode }]

  const cities = strings(params.cities)
  if (cities.length > 0) {
    const area = record(params.area)
    lines.push({
      label: 'Cities',
      value: cities
        .map((city) => {
          const chosen = typeof area[city] === 'string' ? AREA_WORDS[area[city]] : undefined
          return chosen && chosen !== 'whole city' ? `${city} (${chosen})` : city
        })
        .join(', '),
    })
  }

  const triggers = strings(params.triggers)
  if (triggers.length > 0) {
    lines.push({
      label: 'Signs',
      value: triggers.map((id) => names.triggers.get(id) ?? id).join('; '),
    })
  }

  if (typeof params.since_days === 'number') {
    lines.push({ label: 'How far back', value: `Last ${String(params.since_days)} days` })
  }

  const companies = Array.isArray(params.companies)
    ? params.companies.map((item) => record(item).name).filter((name) => typeof name === 'string')
    : []
  if (companies.length > 0) {
    lines.push({ label: 'Companies asked for', value: companies.join(', ') })
  }
  if (params.recheck === true) {
    lines.push({ label: 'Re-check', value: 'Yes: searched again even if memory was fresh' })
  }

  if (run.mode === 'watchlist') {
    const watchlist = record(params.watchlist)
    const parts = [
      watchlist.include_unlikely === true
        ? 'includes companies unlikely to work in an office'
        : 'likely office companies only',
    ]
    if (watchlist.include_director === true) {
      parts.push('includes Director review')
    }
    if (typeof watchlist.limit === 'number') {
      parts.push(`at most ${pluralise(watchlist.limit, 'company', 'companies')}`)
    }
    lines.push({ label: 'Watchlist', value: parts.join(', ') })
  }

  lines.push({
    label: 'Limits',
    value: [
      `run ${money(run.caps.run_cap_usd) ?? 'not set'}`,
      `each company ${money(run.caps.company_cap_usd) ?? 'not set'}`,
      run.mode === 'discovery'
        ? `finding companies ${money(run.caps.discovery_cap_usd) ?? 'not set'}`
        : null,
      `up to ${pluralise(run.caps.max_companies, 'company', 'companies')}`,
    ]
      .filter(Boolean)
      .join(', '),
  })
  return lines
}

/** When the run started and ended, and how long it took (or has taken so far). */
export function timingLines(run: Run, now: Date = new Date()): DetailLine[] {
  const lines: DetailLine[] = []
  const started = run.started_at ?? run.created_at
  lines.push({ label: 'Started', value: formatDateTime(started) })
  if (run.finished_at) {
    lines.push({ label: 'Finished', value: formatDateTime(run.finished_at) })
  }
  const end = run.finished_at ? new Date(run.finished_at) : now
  const seconds = (end.getTime() - new Date(started).getTime()) / 1000
  if (Number.isFinite(seconds) && seconds >= 0) {
    lines.push({ label: run.finished_at ? 'Took' : 'Running for', value: formatDuration(seconds) })
  }
  const resumes = run.counts.resumes
  if (resumes > 0) {
    lines.push({ label: 'Resumed', value: pluralise(resumes, 'time') })
  }
  return lines
}

export interface CostSplit {
  /** Looking for companies in the news (discovery). */
  finding: string
  findingRequests: number
  /** Researching each company (the searches and the answer form). */
  researching: string
  researchingRequests: number
  /** Researching cost divided by the companies researched, or null with none. */
  perCompany: string | null
}

/** Where the run's money went, from its search log. A request's step starts with its stage. */
export function costSplit(searches: readonly SearchOut[], researched: number): CostSplit {
  const finding = searches.filter((item) => item.step.startsWith('discover'))
  const researching = searches.filter((item) => !item.step.startsWith('discover'))
  const researchingCost = addMoney(...researching.map((item) => item.cost_usd))
  const perCompany =
    researched > 0 ? moneyToString((parseMoney(researchingCost) ?? 0n) / BigInt(researched)) : null
  return {
    finding: addMoney(...finding.map((item) => item.cost_usd)),
    findingRequests: finding.length,
    researching: researchingCost,
    researchingRequests: researching.length,
    perCompany,
  }
}

/** True when the run's cost is above what the log adds up to (the log page was cut short). */
export function logIsPartial(searches: readonly SearchOut[], total: number): boolean {
  return searches.length < total
}
