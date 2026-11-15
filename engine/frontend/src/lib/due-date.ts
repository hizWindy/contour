/**
 * A due date, read the way people type one (DESIGN.md "Fields forgive", principles 02 #18):
 * "tomorrow", "next tue", "in 2 weeks", "24 nov", "24/11" and "2026-11-24" all work. It is its own
 * module because three screens read such days: Log call's follow-up (PLAN-V17 T3-5), the cards on
 * Activity (T3-6), and New pre-read's meeting day (T3-9, with `weekends: 'keep'`).
 *
 * The rules, in Melbourne calendar days (YYYY-MM-DD, the form the API takes):
 * - A day on a weekend moves to the Monday after, and `moved` says so. A meeting's day keeps its
 *   weekend (`weekends: 'keep'`): a meeting can be on a Saturday, a follow-up isn't due on one.
 * - A due date is never in the past. A day and a month with no year is the next one: "24/10" on
 *   15 Nov 2026 is 24 Oct 2027. A full date that has gone is `past`, so the field can say so.
 * - The day comes before the month, as in Australia: "3/4" is 3 April.
 * - A weekday on its own ("tue", "on tuesday") is the next one after today, so "tue" on a Tuesday
 *   is a week away. "This tue" is this week's, or today. "Next tue" is the Tuesday of next week
 *   (weeks run Monday to Sunday). The field shows the date it read, so the rep sees which one.
 * - "Next week" is next Monday. "In a month" and "next month" are the same day next month (the
 *   31st becomes the month's last day). A month on its own ("march") is its 1st.
 * Only text it truly can't read is `unreadable`.
 */
import { melbourneDate } from './format'

export type DueDate =
  /** Nothing typed. */
  | { kind: 'empty' }
  /** A day it read. `moved`: it fell on a weekend and moved to the Monday after. */
  | { kind: 'date'; date: string; moved: boolean }
  /** A full date that has already gone. */
  | { kind: 'past'; date: string }
  | { kind: 'unreadable' }

interface Day {
  year: number
  /** 1 to 12. */
  month: number
  day: number
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}

/** Monday is 1 and Sunday 7, as weeks run here. */
const WEEKDAYS: Readonly<Record<string, number>> = {
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
  sun: 7,
  sunday: 7,
}

const COUNTS: Readonly<Record<string, number>> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  'a couple of': 2,
  'a couple': 2,
  'couple of': 2,
  couple: 2,
  'a few': 3,
  few: 3,
}

type Unit = 'day' | 'week' | 'month' | 'year'

const UNITS: Readonly<Record<string, Unit>> = {
  d: 'day',
  day: 'day',
  days: 'day',
  w: 'week',
  wk: 'week',
  wks: 'week',
  week: 'week',
  weeks: 'week',
  fortnight: 'week',
  fortnights: 'week',
  mth: 'month',
  mths: 'month',
  month: 'month',
  months: 'month',
  yr: 'year',
  yrs: 'year',
  year: 'year',
  years: 'year',
}

const TOMORROW = new Set(['tomorrow', 'tmrw', 'tmr', 'tomoz', 'tomorow', 'tommorow', 'tommorrow'])

function parseDay(iso: string): Day {
  const [year = 0, month = 0, day = 0] = iso.slice(0, 10).split('-').map(Number)
  return { year, month, day }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function isoOf(day: Day): string {
  return `${String(day.year)}-${pad(day.month)}-${pad(day.day)}`
}

function utc(day: Day): Date {
  return new Date(Date.UTC(day.year, day.month - 1, day.day, 12))
}

function fromUtc(date: Date): string {
  return isoOf({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  })
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** A calendar day (YYYY-MM-DD) `days` later, or earlier when negative. */
export function addDays(iso: string, days: number): string {
  const date = utc(parseDay(iso))
  date.setUTCDate(date.getUTCDate() + days)
  return fromUtc(date)
}

/** The same day `months` later. The 31st becomes the month's last day. */
function addMonths(iso: string, months: number): string {
  const { year, month, day } = parseDay(iso)
  const index = year * 12 + (month - 1) + months
  const nextYear = Math.floor(index / 12)
  const nextMonth = (index % 12) + 1
  return isoOf({
    year: nextYear,
    month: nextMonth,
    day: Math.min(day, daysInMonth(nextYear, nextMonth)),
  })
}

/** Monday 1 to Sunday 7. */
export function weekdayOf(iso: string): number {
  const sunday0 = utc(parseDay(iso)).getUTCDay()
  return sunday0 === 0 ? 7 : sunday0
}

/** A real calendar day, or null for one like 31 Nov. */
function validDay(year: number, month: number, day: number): Day | null {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null
  }
  return { year, month, day }
}

/** "26" is 2026. */
function fullYear(text: string): number {
  const value = Number(text)
  return text.length <= 2 ? 2000 + value : value
}

function tidy(text: string): string {
  return text
    .toLowerCase()
    .replace(/[,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(/^(?:on|by|due|before|around|about|for)\s+/, '')
    .replace(/^the\s+/, '')
    .trim()
}

/** A day and a month, and maybe a year. Without one: the next such day from today. */
function dayAndMonth(
  day: number,
  month: number,
  yearText: string | undefined,
  today: string,
): DueDate {
  const thisYear = parseDay(today).year
  if (yearText !== undefined) {
    const found = validDay(fullYear(yearText), month, day)
    if (!found) return { kind: 'unreadable' }
    const date = isoOf(found)
    return date < today ? { kind: 'past', date } : onDay(date)
  }
  let found = validDay(thisYear, month, day)
  if (found && isoOf(found) < today) {
    found = validDay(thisYear + 1, month, day)
  }
  // 29 Feb with no leap year this year or next is not a day.
  return found ? onDay(isoOf(found)) : { kind: 'unreadable' }
}

/** A month on its own: its 1st, this year or next. */
function monthStart(month: number, yearText: string | undefined, today: string): DueDate {
  const { year: thisYear, month: thisMonth } = parseDay(today)
  if (yearText !== undefined) {
    const date = isoOf({ year: fullYear(yearText), month, day: 1 })
    const ended = isoOf({
      year: fullYear(yearText),
      month,
      day: daysInMonth(fullYear(yearText), month),
    })
    if (ended < today) return { kind: 'past', date }
    // The month we are in: today, not a day already gone.
    return onDay(date < today ? today : date)
  }
  if (month === thisMonth) return onDay(today)
  const year = month < thisMonth ? thisYear + 1 : thisYear
  return onDay(isoOf({ year, month, day: 1 }))
}

/** A weekday. See the rules at the top for "this" and "next". */
function weekday(target: number, word: string | undefined, today: string): DueDate {
  const now = weekdayOf(today)
  if (word === 'this') {
    const thisWeek = addDays(today, target - now)
    return onDay(thisWeek < today ? addDays(thisWeek, 7) : thisWeek)
  }
  if (word === 'next') {
    const nextMonday = addDays(today, 8 - now)
    return onDay(addDays(nextMonday, target - 1))
  }
  const ahead = (target - now + 7) % 7 || 7
  return onDay(addDays(today, ahead))
}

function later(count: number, unit: Unit, today: string): string {
  switch (unit) {
    case 'day':
      return addDays(today, count)
    case 'week':
      return addDays(today, count * 7)
    case 'month':
      return addMonths(today, count)
    case 'year':
      return addMonths(today, count * 12)
  }
}

/** A day read, before the last rules (`settle`). */
function onDay(date: string): DueDate {
  return { kind: 'date', date, moved: false }
}

/**
 * The last rules for every day read: never before today, and (unless `keepWeekends`) a weekend
 * moves to the Monday after.
 */
function settle(read: DueDate, today: string, keepWeekends: boolean): DueDate {
  if (read.kind !== 'date') return read
  const day = weekdayOf(read.date)
  const moved = !keepWeekends && day >= 6
  const date = moved ? addDays(read.date, 8 - day) : read.date
  return { kind: 'date', date: date < today ? today : date, moved }
}

const COUNT_WORDS = Object.keys(COUNTS)
  .sort((a, b) => b.length - a.length)
  .join('|')
const UNIT_WORDS = Object.keys(UNITS)
  .sort((a, b) => b.length - a.length)
  .join('|')
const RELATIVE = new RegExp(
  `^(?:in\\s+)?(\\d{1,3}|${COUNT_WORDS})\\s*(${UNIT_WORDS})(?:\\s+(?:time|from now|later))?$`,
)
const WEEKDAY = /^(?:(this coming|this|next|coming)\s+)?([a-z]+)$/
const DAY_MONTH = /^(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s+)?([a-z]+)(?:\s+(\d{4}|\d{2}))?$/
const MONTH_DAY = /^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}|\d{2}))?$/
const MONTH_ONLY = /^(?:in\s+|early\s+|start of\s+)?([a-z]+)(?:\s+(\d{4}))?$/
const NUMERIC = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?$/
const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/

export interface DueDateOptions {
  /**
   * `move` (the default, for a due date): a Saturday or a Sunday moves to the Monday after.
   * `keep` (for a meeting's day, PLAN-V17 T3-9): the day stays as typed.
   */
  weekends?: 'move' | 'keep'
}

/**
 * Reads a due date. `today` is Melbourne's (`melbourneDate()`), passed in so a test can fix it.
 *
 *     readDueDate('next tue', '2026-11-15')  // { kind: 'date', date: '2026-11-17', moved: false }
 *     readDueDate('sat', '2026-11-18', { weekends: 'keep' })  // 2026-11-21, a Saturday
 */
export function readDueDate(
  text: string,
  today: string = melbourneDate(),
  { weekends = 'move' }: DueDateOptions = {},
): DueDate {
  return settle(readDay(text, today), today, weekends === 'keep')
}

/** The day the words name, before the last rules. */
function readDay(text: string, today: string): DueDate {
  const words = tidy(text)
  if (words === '') return { kind: 'empty' }
  if (words === 'today' || words === 'tod') return onDay(today)
  if (TOMORROW.has(words)) return onDay(addDays(today, 1))
  if (words === 'day after tomorrow') return onDay(addDays(today, 2))
  if (words === 'next week') return onDay(addDays(today, 8 - weekdayOf(today)))
  if (words === 'next month') return onDay(addMonths(today, 1))
  if (words === 'next year') return onDay(addMonths(today, 12))

  const relative = RELATIVE.exec(words)
  if (relative) {
    const [, amount = '', unitWord = ''] = relative
    const unit = UNITS[unitWord]
    const count = /^\d+$/.test(amount) ? Number(amount) : (COUNTS[amount] ?? 0)
    if (unit && count > 0) {
      const fortnights = unitWord.startsWith('fortnight') ? 2 : 1
      return onDay(later(count * fortnights, unit, today))
    }
  }

  const iso = ISO.exec(words)
  if (iso) {
    const [, year = '', month = '', day = ''] = iso
    return dayAndMonth(Number(day), Number(month), year, today)
  }

  const numeric = NUMERIC.exec(words)
  if (numeric) {
    const [, day = '', month = '', year] = numeric
    return dayAndMonth(Number(day), Number(month), year, today)
  }

  const weekdayMatch = WEEKDAY.exec(words)
  const target = weekdayMatch ? WEEKDAYS[weekdayMatch[2] ?? ''] : undefined
  if (weekdayMatch && target !== undefined) {
    const word = weekdayMatch[1]
    return weekday(target, word === 'this' || word === 'next' ? word : undefined, today)
  }

  const dayMonth = DAY_MONTH.exec(words)
  const dayMonthMonth = dayMonth ? MONTHS[dayMonth[2] ?? ''] : undefined
  if (dayMonth && dayMonthMonth !== undefined) {
    return dayAndMonth(Number(dayMonth[1]), dayMonthMonth, dayMonth[3], today)
  }

  const monthDay = MONTH_DAY.exec(words)
  const monthDayMonth = monthDay ? MONTHS[monthDay[1] ?? ''] : undefined
  if (monthDay && monthDayMonth !== undefined) {
    return dayAndMonth(Number(monthDay[2]), monthDayMonth, monthDay[3], today)
  }

  const monthOnly = MONTH_ONLY.exec(words)
  const onlyMonth = monthOnly ? MONTHS[monthOnly[1] ?? ''] : undefined
  if (monthOnly && onlyMonth !== undefined) {
    return monthStart(onlyMonth, monthOnly[2], today)
  }

  return { kind: 'unreadable' }
}

const dayFormat = new Intl.DateTimeFormat('en-AU', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

/** "Tue 24 Nov 2026", for a calendar day (YYYY-MM-DD). */
export function dueDateText(date: string): string {
  const parts = dayFormat.formatToParts(utc(parseDay(date)))
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? ''
  return `${part('weekday')} ${part('day')} ${part('month')} ${part('year')}`
}
