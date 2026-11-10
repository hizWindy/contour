/**
 * Runs and cost's pure parts (PLAN-V13 T1-8): the three stats (this round, this month, cost per
 * good lead), the days each one charts, and the words for a day. Days are Melbourne days, as the
 * backend counts them.
 */
import type { LeadFinderRound, Run, RunSummary } from '@/api/types'
import { melbourneDate } from '@/lib/format'
import { parseMoney } from '@/lib/money'
import { costPerGoodLead, goodLeads } from '../good-leads-data'

export type StatId = 'round' | 'month' | 'per-good'

export interface Day {
  date: string // YYYY-MM-DD, a Melbourne day
  cost: number // US dollars
  runs: number
  good: number // good leads from the runs made that day
}

export interface Stat {
  id: StatId
  label: string
  value: string | null // a money string, or null when it can't be worked out yet
  detail: string // one line under the number
  from: string // the first day the chart shows
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** With the round off, "this round" shows the last two weeks. */
const ROUND_OFF_DAYS = 14

function utc(date: string): Date {
  return new Date(`${date}T00:00:00Z`)
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDays(date: string, days: number): string {
  return iso(new Date(utc(date).getTime() + days * 86_400_000))
}

export function monthStart(date: string): string {
  return `${date.slice(0, 8)}01`
}

/** Every day from `from` to `to`, both included. */
export function daysFrom(from: string, to: string): string[] {
  const days: string[] = []
  for (let day = from; day <= to && days.length < 400; day = addDays(day, 1)) days.push(day)
  return days
}

/** "Wed 11 Nov". */
export function dayWords(date: string): string {
  const day = utc(date)
  return `${WEEKDAYS[day.getUTCDay()] ?? ''} ${String(day.getUTCDate())} ${MONTHS[day.getUTCMonth()] ?? ''}`
}

function dollars(money: string): number {
  const micros = parseMoney(money)
  return micros === null ? 0 : Number(micros) / 1_000_000
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-AU')} ${count === 1 ? one : many}`
}

/** Each day from `from` to `to`: its cost and runs from the summary, its good leads from the runs. */
export function daysOf(summary: RunSummary, runs: readonly Run[], from: string, to: string): Day[] {
  const cost = new Map(summary.days.map((day) => [day.date, day]))
  const good = new Map<string, number>()
  for (const run of runs) {
    const day = melbourneDate(run.created_at)
    good.set(day, (good.get(day) ?? 0) + goodLeads(run.counts))
  }
  return daysFrom(from, to).map((date) => ({
    date,
    cost: dollars(cost.get(date)?.cost_usd ?? '0'),
    runs: cost.get(date)?.runs ?? 0,
    good: good.get(date) ?? 0,
  }))
}

function sum(days: readonly Day[], key: 'cost' | 'runs' | 'good'): number {
  return days.reduce((total, day) => total + day[key], 0)
}

/** The three stats, from the round, the days and today. */
export function statsOf(
  round: LeadFinderRound | undefined,
  days: readonly Day[],
  today: string,
): Stat[] {
  const month = days.filter((day) => day.date >= monthStart(today))
  const monthCost = sum(month, 'cost')
  const monthGood = sum(month, 'good')
  const started = round?.round.started_at ? melbourneDate(round.round.started_at) : null
  const roundFrom = round?.enabled && started ? started : addDays(today, 1 - ROUND_OFF_DAYS)
  const roundState = round?.round
  return [
    {
      id: 'round',
      label: 'This round',
      value: roundState ? roundState.spent_usd : null,
      detail: roundState
        ? `${plural(roundState.good_leads, 'good lead')} of ${String(roundState.goal)}, ${plural(roundState.runs, 'city run')}`
        : 'The round is loading',
      from: roundFrom,
    },
    {
      id: 'month',
      label: 'This month',
      value: monthCost.toFixed(2),
      detail: `${plural(sum(month, 'runs'), 'run')}, ${plural(monthGood, 'good lead')}`,
      from: monthStart(today),
    },
    {
      id: 'per-good',
      label: 'Cost per good lead',
      value: costPerGoodLead(monthCost.toFixed(2), monthGood),
      detail:
        monthGood === 0
          ? 'No good lead yet this month'
          : `This month, ${plural(monthGood, 'good lead')}`,
      from: monthStart(today),
    },
  ]
}

/** What a day's bar shows for a stat: its cost, or its cost per good lead (null with none). */
export function barValue(day: Day, stat: StatId): number | null {
  if (stat !== 'per-good') return day.cost
  return day.good > 0 ? day.cost / day.good : null
}

/** A day in words, for the line under the chart and the tooltip. */
export function dayLine(day: Day, stat: StatId): string {
  const money = `US$${day.cost.toFixed(2)}`
  if (stat === 'per-good') {
    if (day.good === 0) return `${dayWords(day.date)}: ${money}, no good lead.`
    return `${dayWords(day.date)}: US$${(day.cost / day.good).toFixed(2)} a good lead (${plural(day.good, 'good lead')}, ${money}).`
  }
  return `${dayWords(day.date)}: ${plural(day.runs, 'run')}, ${money}.`
}
