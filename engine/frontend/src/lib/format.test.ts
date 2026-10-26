import { describe, expect, it } from 'vitest'
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatM2,
  formatNumber,
  formatPercent,
  formatRelative,
  formatStaff,
  formatTime,
  humanise,
  melbourneDate,
  pluralise,
  shortId,
  TIME_ZONE,
  UNKNOWN,
} from './format'

describe('dates in Australia/Melbourne', () => {
  it('uses the Melbourne zone', () => {
    expect(TIME_ZONE).toBe('Australia/Melbourne')
  })

  it('moves a UTC moment into Melbourne time (daylight saving, UTC+11, from 4 Oct 2026)', () => {
    // 2026-10-26 04:04 UTC is 3:04 pm in Melbourne.
    expect(formatDateTime('2026-10-26T04:04:00Z')).toBe('26 Oct 2026, 3:04 pm')
    expect(formatTime('2026-10-26T04:04:00Z')).toBe('3:04 pm')
  })

  it('crosses midnight: a late UTC evening is the next day in Melbourne', () => {
    expect(formatDate('2026-10-25T20:30:00Z')).toBe('26 Oct 2026')
    expect(melbourneDate('2026-10-25T20:30:00Z')).toBe('2026-10-26')
  })

  it('winter time is UTC+10', () => {
    expect(formatDateTime('2026-08-01T00:00:00Z')).toBe('1 Aug 2026, 10:00 am')
  })

  it('never moves a calendar date without a time', () => {
    expect(formatDate('2026-10-07')).toBe('7 Oct 2026')
    expect(formatDateTime('2026-10-07')).toBe('7 Oct 2026')
    expect(formatTime('2026-10-07')).toBe(UNKNOWN)
  })

  it('accepts a Date and a number of milliseconds', () => {
    const when = new Date('2026-10-26T04:04:00Z')
    expect(formatDate(when)).toBe('26 Oct 2026')
    expect(formatDate(when.getTime())).toBe('26 Oct 2026')
  })

  it('says Unknown for a missing or unreadable date', () => {
    expect(formatDate(null)).toBe(UNKNOWN)
    expect(formatDate(undefined)).toBe(UNKNOWN)
    expect(formatDate('')).toBe(UNKNOWN)
    expect(formatDate('not a date')).toBe(UNKNOWN)
    expect(formatDateTime('2026-13-45')).toBe(UNKNOWN)
    expect(melbourneDate('nope')).toBe('')
  })
})

describe('formatRelative', () => {
  const now = new Date('2026-10-26T04:00:00Z')

  it('reads like a person', () => {
    expect(formatRelative('2026-10-26T03:59:50Z', now)).toBe('just now')
    expect(formatRelative('2026-10-26T03:57:00Z', now)).toBe('3 minutes ago')
    expect(formatRelative('2026-10-26T01:00:00Z', now)).toBe('3 hours ago')
    expect(formatRelative('2026-10-25T04:00:00Z', now)).toBe('yesterday')
    expect(formatRelative('2026-10-23T04:00:00Z', now)).toBe('3 days ago')
  })

  it('falls back to the date after a week', () => {
    expect(formatRelative('2026-10-01T04:00:00Z', now)).toBe('1 Oct 2026')
  })

  it('handles a moment in the future', () => {
    expect(formatRelative('2026-10-26T04:10:00Z', now)).toBe('in 10 minutes')
  })

  it('says Unknown when there is no date', () => {
    expect(formatRelative(null, now)).toBe(UNKNOWN)
  })
})

describe('formatDuration', () => {
  it('uses short units', () => {
    expect(formatDuration(0)).toBe('0 s')
    expect(formatDuration(45)).toBe('45 s')
    expect(formatDuration(60)).toBe('1 min')
    expect(formatDuration(125)).toBe('2 min 5 s')
    expect(formatDuration(3600)).toBe('1 h')
    expect(formatDuration(3780)).toBe('1 h 3 min')
    expect(formatDuration(-5)).toBe('0 s')
  })
})

describe('numbers and units', () => {
  it('groups thousands', () => {
    expect(formatNumber(1234567)).toBe('1,234,567')
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(null)).toBe(UNKNOWN)
    expect(formatNumber(Number.NaN)).toBe(UNKNOWN)
  })

  it('writes an estimate as an estimate, with the unit m²', () => {
    expect(formatM2(3000)).toBe('3,000 m²')
    expect(formatM2(3000, true)).toBe('about 3,000 m²')
    expect(formatM2(null)).toBe(UNKNOWN)
  })

  it('gives staff their unit', () => {
    expect(formatStaff(1200)).toBe('1,200 staff')
    expect(formatStaff(undefined)).toBe(UNKNOWN)
  })

  it('formats a percentage', () => {
    expect(formatPercent(83.33)).toBe('83.3%')
    expect(formatPercent(100)).toBe('100%')
    expect(formatPercent(null)).toBe(UNKNOWN)
  })

  it('counts things', () => {
    expect(pluralise(1, 'search')).toBe('1 search')
    expect(pluralise(3, 'search')).toBe('3 searchs')
    expect(pluralise(3, 'search', 'searches')).toBe('3 searches')
    expect(pluralise(3, 'company', 'companies')).toBe('3 companies')
    expect(pluralise(0, 'company', 'companies')).toBe('0 companies')
    expect(pluralise(1200, 'lead')).toBe('1,200 leads')
  })

  it('makes a label from a code', () => {
    expect(humanise('director_review')).toBe('Director review')
    expect(humanise('in-hubspot')).toBe('In hubspot')
    expect(humanise('')).toBe('')
  })

  it('shortens an id', () => {
    expect(shortId('3f2a9c1e-1111-2222-3333-444455556666')).toBe('3f2a9c1e')
  })
})
