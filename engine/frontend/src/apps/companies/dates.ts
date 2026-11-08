/**
 * Dates on the Companies page: how far off a lease end is, how long ago the last talk was, and
 * whether either needs attention (PLAN-V10). Dates are calendar dates (YYYY-MM-DD), compared with
 * today in Melbourne.
 */
import { melbourneDate } from '@/lib/format'

export const LEASE_SOON_MONTHS = 24
export const TALK_STALE_MONTHS = 6

function parts(date: string): [number, number, number] {
  const [year = 0, month = 0, day = 0] = date.slice(0, 10).split('-').map(Number)
  return [year, month, day]
}

/** Whole months from `from` to `to` (both YYYY-MM-DD). Negative when `to` comes first. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = parts(from)
  const [ty, tm, td] = parts(to)
  let months = (ty - fy) * 12 + (tm - fm)
  if (months > 0 && td < fd) months -= 1
  if (months < 0 && td > fd) months += 1
  return months
}

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = parts(from)
  const [ty, tm, td] = parts(to)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

function count(value: number, one: string): string {
  return `${String(value)} ${value === 1 ? one : `${one}s`}`
}

/** "in 16 months", "in 3 years", "this month". */
export function untilWords(date: string, today: string = melbourneDate()): string {
  const months = monthsBetween(today, date)
  if (months <= 0) return 'this month'
  if (months < 24) return `in ${count(months, 'month')}`
  return `in ${count(Math.floor(months / 12), 'year')}`
}

/** "today", "5 days ago", "3 weeks ago", "4 months ago", "2 years ago". */
export function agoWords(date: string, today: string = melbourneDate()): string {
  const days = daysBetween(date, today)
  if (days <= 0) return 'today'
  if (days < 14) return `${count(days, 'day')} ago`
  if (days < 60) return `${count(Math.floor(days / 7), 'week')} ago`
  const months = monthsBetween(date, today)
  if (months < 24) return `${count(Math.max(2, months), 'month')} ago`
  return `${count(Math.floor(months / 12), 'year')} ago`
}

export function leaseSoon(date: string | null | undefined, today = melbourneDate()): boolean {
  return Boolean(date) && monthsBetween(today, date ?? '') < LEASE_SOON_MONTHS
}

export function talkStale(date: string | null | undefined, today = melbourneDate()): boolean {
  return !date || monthsBetween(date, today) >= TALK_STALE_MONTHS
}
