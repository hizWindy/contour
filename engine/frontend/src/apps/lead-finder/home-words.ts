/**
 * The Lead Finder's words on Home, as pure functions so they are easy to test: the sentence under
 * the greeting (what the last run did), the line under the count of good leads, and the signs seen
 * most. A good lead is a Pass or a Director review (PLAN-V9 D2).
 */
import type { LeadResult, Run, Schemas } from '@/api/types'
import { formatDate, formatNumber, melbourneDate } from '@/lib/format'
import { goodLeads } from './good-leads-data'

type TriggerFacet = Schemas['TriggerFacet']

/** Where a run looked, for the kinds of run that have no cities. */
const KIND_WORDS: Record<string, string> = {
  testset: 'the test set',
  watchlist: 'the HubSpot watchlist',
}

/** How many signs the card lists. */
export const SIGNS_SHOWN = 4

function count(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`
}

/** "Perth", "Perth and Sydney", "Perth, Sydney and Brisbane". */
export function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`
}

/** Where a run looked: its cities, or its kind ("the test set"). */
export function whereWords(run: Pick<Run, 'mode' | 'params'>): string {
  const cities = (run.params as { cities?: unknown }).cities
  if (Array.isArray(cities) && cities.length > 0) {
    return listWords(cities.filter((city): city is string => typeof city === 'string'))
  }
  return KIND_WORDS[run.mode] ?? ''
}

/** "Today's run", "Yesterday's run" or "The run on 3 Nov", by Melbourne days. */
function whenWords(created: string, now: Date): string {
  const day = melbourneDate(created)
  const today = melbourneDate(now)
  if (day === today) return "Today's run"
  if (day === melbourneDate(new Date(now.getTime() - 86_400_000))) return "Yesterday's run"
  return `The run on ${formatDate(created)}`
}

/**
 * The sentence under the greeting: what the newest run did, in plain words. It never makes a
 * number up: a count the run doesn't have is left out.
 */
export function runLine(
  run: Pick<Run, 'status' | 'mode' | 'params' | 'counts' | 'created_at'>,
  now: Date = new Date(),
): string {
  const where = whereWords(run)
  const inWhere = where ? ` in ${where}` : ''
  const researched = run.counts.researched
  if (run.status === 'queued' || run.status === 'running') {
    return researched > 0
      ? `A run is going now${inWhere}: ${count(researched, 'company', 'companies')} researched so far.`
      : `A run is going now${inWhere}.`
  }
  const when = whenWords(run.created_at, now)
  if (run.status === 'failed') return `${when}${inWhere} failed. Open it to see why.`
  if (run.status === 'cancelled' || run.status === 'interrupted') {
    return `${when}${inWhere} stopped after ${count(researched, 'company', 'companies')}.`
  }
  const good = goodLeads(run.counts)
  const watch = run.counts.by_result.watch ?? 0
  const found =
    good > 0 && watch > 0
      ? `found ${count(good, 'good lead')} and ${formatNumber(watch)} to watch`
      : good > 0
        ? `found ${count(good, 'good lead')}`
        : watch > 0
          ? `added ${formatNumber(watch)} to watch`
          : 'found no new leads'
  return `${when} checked ${count(researched, 'company', 'companies')}${inWhere} and ${found}.`
}

/** "2 pass and 7 for the director, out of 59 found." Results with none are left out. */
export function goodLine(counts: ReadonlyMap<string, number>, total: number): string {
  const pass = counts.get('pass') ?? 0
  const review = counts.get('director_review') ?? 0
  const parts = [
    pass > 0 ? `${formatNumber(pass)} pass` : null,
    review > 0 ? `${formatNumber(review)} for the director` : null,
  ].filter(Boolean)
  const out = `out of ${formatNumber(total)} found`
  return parts.length > 0 ? `${listWords(parts as string[])}, ${out}.` : `None yet, ${out}.`
}

/** The good results, in the order the card counts them. */
export const GOOD_RESULTS: readonly LeadResult[] = ['pass', 'director_review']

/** The signs seen most, biggest first, with none left out; ties keep the backend's order. */
export function topSigns(triggers: readonly TriggerFacet[], shown = SIGNS_SHOWN): TriggerFacet[] {
  return triggers
    .filter((trigger) => trigger.count > 0)
    .map((trigger, index) => ({ trigger, index }))
    .sort((a, b) => b.trigger.count - a.trigger.count || a.index - b.index)
    .slice(0, shown)
    .map(({ trigger }) => trigger)
}
