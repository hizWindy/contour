/**
 * The Schedules control's pure parts (PLAN-V13 T1-7): the form's state, what it sends, its checks,
 * and the preview line that changes as you edit. The backend (`apps/lead_finder/round.py`) holds
 * the same rules; these say them early, in the same words, so a save rarely meets a 422.
 *
 * Days are Melbourne days. Picked cities run one day apart in the fixed order Melbourne,
 * Adelaide, Perth, Sydney, from the first day, and the first round is the next first day still to
 * come (today counts while its time hasn't passed).
 */
import type { LeadFinderRound, LeadFinderRoundIn } from '@/api/types'

export type City = LeadFinderRound['cities'][number]
export type Unit = LeadFinderRound['unit']
export type Often = 'two-weeks' | 'thirty-days' | 'custom'

export const CITIES: readonly City[] = ['Melbourne', 'Adelaide', 'Perth', 'Sydney']
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
export const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const EVERY_MAX: Record<Unit, number> = { days: 365, weeks: 52 }
const MONTH_DAYS = 30.4375 // a year of 365.25 days in 12
const ZONE = 'Australia/Melbourne'

/** What the card's fields hold. Numbers stay text while you type. */
export interface RoundForm {
  enabled: boolean
  cities: City[]
  often: Often
  every: string
  unit: Unit
  weekday: number // 0 Monday to 6 Sunday
  at: string // 24-hour, like 07:00
  budget: string // US dollars
}

export function oftenOf(every: number, unit: Unit): Often {
  if (unit === 'weeks' && every === 2) return 'two-weeks'
  if (unit === 'days' && every === 30) return 'thirty-days'
  return 'custom'
}

/** The form as the backend's plan says it is. */
export function formOf(round: LeadFinderRound): RoundForm {
  return {
    enabled: round.enabled,
    cities: [...round.cities],
    often: oftenOf(round.every, round.unit),
    every: String(round.every),
    unit: round.unit,
    weekday: round.weekday,
    at: round.at,
    budget: String(Number(round.budget_usd)),
  }
}

/** "How often" picked: the two usual ones set the number and the unit; Custom keeps them. */
export function withOften(form: RoundForm, often: Often): RoundForm {
  if (often === 'two-weeks') return { ...form, often, every: '2', unit: 'weeks' }
  if (often === 'thirty-days') return { ...form, often, every: '30', unit: 'days' }
  return { ...form, often }
}

export function inOrder(cities: readonly City[]): City[] {
  return CITIES.filter((city) => cities.includes(city))
}

function stepDays(every: number, unit: Unit): number {
  return unit === 'weeks' ? every * 7 : every
}

function sameNumber(text: string, value: number): boolean {
  return text.trim() !== '' && Number(text) === value
}

/** True when nothing differs from what is saved. */
export function isSaved(form: RoundForm, round: LeadFinderRound): boolean {
  return (
    form.enabled === round.enabled &&
    inOrder(form.cities).join() === round.cities.join() &&
    sameNumber(form.every, round.every) &&
    form.unit === round.unit &&
    form.weekday === round.weekday &&
    form.at === round.at &&
    sameNumber(form.budget, Number(round.budget_usd))
  )
}

/** True when only the budget (or nothing) differs: the backend then keeps each next time. */
export function sameTimes(form: RoundForm, round: LeadFinderRound): boolean {
  return (
    form.enabled === round.enabled &&
    inOrder(form.cities).join() === round.cities.join() &&
    sameNumber(form.every, round.every) &&
    form.unit === round.unit &&
    form.weekday === round.weekday &&
    form.at === round.at
  )
}

export type RoundErrors = Partial<Record<'cities' | 'every' | 'at' | 'budget', string>>

/** What can't be saved, in the backend's words, by field. Empty when it can. */
export function checkForm(form: RoundForm, budgetMax: number): RoundErrors {
  const errors: RoundErrors = {}
  const count = form.cities.length
  if (count === 0) errors.cities = 'Pick at least one city.'
  const every = Number(form.every)
  if (!Number.isInteger(every) || every < 1) {
    errors.every = 'Use a whole number, 1 or more.'
  } else if (every > EVERY_MAX[form.unit]) {
    errors.every = `Use ${String(EVERY_MAX[form.unit])} ${form.unit} or fewer.`
  } else if (count > 0 && stepDays(every, form.unit) < count) {
    errors.every = `${String(count)} cities run on ${String(count)} days in a row, so a round can repeat every ${String(count)} days at most often.`
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(form.at)) errors.at = 'Use a time like 07:00.'
  const budget = Number(form.budget)
  if (form.budget.trim() === '' || !Number.isFinite(budget) || budget < 1) {
    errors.budget = 'Use US$1 or more.'
  } else if (budget > budgetMax) {
    errors.budget = `Must be at most ${usd(budgetMax)}. The ceiling on the server is lower.`
  } else if (Math.round(budget * 100) !== budget * 100) {
    errors.budget = 'Use whole cents.'
  }
  return errors
}

/** What `PUT /schedules/lead-finder` takes. Only call it when `checkForm` found nothing. */
export function bodyOf(form: RoundForm): LeadFinderRoundIn {
  return {
    enabled: form.enabled,
    cities: inOrder(form.cities),
    every: Number(form.every),
    unit: form.unit,
    weekday: form.weekday,
    at: form.at,
    budget_usd: Number(form.budget).toFixed(2),
  }
}

/** US$150, or US$37.50: whole dollars without cents, as the backend writes them. */
export function usd(amount: number): string {
  const cents = Math.floor(amount * 100 + 1e-6) / 100
  const whole = Number.isInteger(cents)
  return `US$${cents.toLocaleString('en-AU', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`
}

/** "US$150 a round, so about US$37 a city if all 4 run." The split is a guide (TBC). */
export function splitWords(budgetText: string, cities: number): string {
  const budget = Number(budgetText)
  if (!Number.isFinite(budget) || budget <= 0 || cities === 0) return ''
  if (cities === 1) return `${usd(budget)} a round, for one city.`
  return `${usd(budget)} a round, so about ${usd(Math.floor(budget / cities))} a city if all ${String(cities)} run.`
}

/** The most a month of rounds could spend at this plan: the budget for each round in 30 days. */
export function monthWords(form: RoundForm): string {
  const budget = Number(form.budget)
  const step = stepDays(Number(form.every), form.unit)
  if (!Number.isFinite(budget) || !(step > 0)) return ''
  return usd(Math.ceil((budget * MONTH_DAYS) / step))
}

/** The Melbourne date and clock of a moment. */
function melbourne(now: Date): { y: number; m: number; d: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now)
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? 0)
  return {
    y: part('year'),
    m: part('month'),
    d: part('day'),
    minutes: part('hour') * 60 + part('minute'),
  }
}

function clockWords(at: string): string {
  const [hour = 0, minute = 0] = at.split(':').map(Number)
  const half = hour < 12 ? 'am' : 'pm'
  return `${String(hour % 12 || 12)}:${String(minute).padStart(2, '0')} ${half}`
}

/**
 * "Next round: Mon 16 Nov, 7:00 am. Melbourne Mon, Adelaide Tue, Perth Wed, Sydney Thu. Up to
 * US$150." as a save would plan it from `now`. Empty while the form can't be saved.
 */
export function previewWords(form: RoundForm, now: Date): string {
  const cities = inOrder(form.cities)
  if (cities.length === 0 || checkForm(form, Number.POSITIVE_INFINITY).at) return ''
  const today = melbourne(now)
  const base = Date.UTC(today.y, today.m - 1, today.d)
  const todayIndex = (new Date(base).getUTCDay() + 6) % 7 // 0 Monday
  const [hour = 0, minute = 0] = form.at.split(':').map(Number)
  let ahead = (form.weekday - todayIndex + 7) % 7
  if (ahead === 0 && hour * 60 + minute <= today.minutes) ahead = 7
  const day = (offset: number) => new Date(base + (ahead + offset) * 86_400_000)
  const first = day(0)
  const name = (date: Date) => WEEKDAYS[(date.getUTCDay() + 6) % 7]
  const label = form.enabled ? 'Next round' : 'When it is on, the next round would be'
  const days = cities.map((city, index) => `${city} ${name(day(index))}`).join(', ')
  const budget = Number(form.budget)
  const upTo = Number.isFinite(budget) && budget > 0 ? ` Up to ${usd(budget)}.` : ''
  return `${label}: ${name(first)} ${String(first.getUTCDate())} ${MONTHS[first.getUTCMonth()] ?? ''}, ${clockWords(form.at)}. ${days}.${upTo}`
}

/**
 * The preview line to show: the backend's own while the times are as saved (mid-round it knows
 * which cities already ran), with a new budget put in; else the line a save would plan.
 */
export function previewFor(form: RoundForm, round: LeadFinderRound, now: Date): string {
  if (sameTimes(form, round)) {
    const budget = Number(form.budget)
    if (!Number.isFinite(budget) || budget <= 0) return round.summary
    return round.summary.replace(/Up to US\$[\d,.]+\.$/, `Up to ${usd(budget)}.`)
  }
  return previewWords(form, now)
}
