/**
 * Home's words, as pure functions so they are easy to test: the greeting, the date over it, and
 * the days and money of the Runs and cost card. The greeting and the date follow the clock of the
 * person reading (it is their morning); the runs follow Melbourne days, as the backend counts them.
 */
import type { RunSummary } from '@/api/types'
import { melbourneDate } from '@/lib/format'
import { parseMoney } from '@/lib/money'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** How many days the Runs and cost card looks back, today included. */
export const COST_DAYS = 30
/** How many days with a run the card draws as bars. */
export const COST_BARS = 8

/** "Good morning" from 5 am, "Good afternoon" from noon, "Good evening" from 6 pm. */
export function greetingWord(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/** "Al-khair" from "Al-khair M. Pama". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}

/** "Wednesday 11 November", in the reader's own time. */
export function longDate(now: Date): string {
  return new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
    .format(now)
    .replace(',', '')
}

/** A YYYY-MM-DD day `days` before `date` (also YYYY-MM-DD). */
export function daysBefore(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`)
  return new Date(day.getTime() - days * 86_400_000).toISOString().slice(0, 10)
}

/** The day the Runs and cost card starts from: 30 days back, today included, a Melbourne day. */
export function costSince(today: string = melbourneDate()): string {
  return daysBefore(today, COST_DAYS - 1)
}

function utc(date: string): Date {
  return new Date(`${date}T00:00:00Z`)
}

/** "27 Oct". */
export function shortDay(date: string): string {
  const day = utc(date)
  return `${String(day.getUTCDate())} ${MONTHS[day.getUTCMonth()] ?? ''}`
}

/**
 * The labels under the bars, as short as they can be: the month shows on the first bar and where
 * it changes ("27 Oct", "28", "31", "3 Nov", "10"), and today's bar says "Today".
 */
export function barLabels(dates: readonly string[], today: string): string[] {
  return dates.map((date, index) => {
    if (date === today) return 'Today'
    const before = dates[index - 1]
    return before && before.slice(0, 7) === date.slice(0, 7)
      ? String(utc(date).getUTCDate())
      : shortDay(date)
  })
}

/** "Tue 27 Oct". */
export function weekdayDay(date: string): string {
  return `${WEEKDAYS[utc(date).getUTCDay()] ?? ''} ${shortDay(date)}`
}

/** A money string as dollars, for drawing a bar (never for showing a sum). */
export function dollars(money: string): number {
  const micros = parseMoney(money)
  return micros === null ? 0 : Number(micros) / 1_000_000
}

export interface CostBar {
  date: string
  runs: number
  cost: string
  /** 0 to 1: this day's cost against the biggest day drawn. */
  share: number
}

/** The newest days with a run, oldest first, at most `COST_BARS`, each with its share of the biggest. */
export function costBars(summary: RunSummary, shown = COST_BARS): CostBar[] {
  const days = [...summary.days]
    .filter((day) => day.runs > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-shown)
  const most = Math.max(0, ...days.map((day) => dollars(day.cost_usd)))
  return days.map((day) => ({
    date: day.date,
    runs: day.runs,
    cost: day.cost_usd,
    share: most > 0 ? dollars(day.cost_usd) / most : 0,
  }))
}
