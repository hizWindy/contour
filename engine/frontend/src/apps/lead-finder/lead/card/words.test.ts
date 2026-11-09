import { describe, expect, it } from 'vitest'
import { fact, makeLead } from '../test-lead'
import { officeLine } from './words'

const TODAY = '2026-11-10'

function line(since: string | null, fitout: string | null = null): string {
  const lead = makeLead()
  return officeLine(
    { ...lead, facts: { ...lead.facts, office_since: fact(since), last_fitout: fact(fitout) } },
    TODAY,
  )
}

describe('the office line (PLAN-V11 B5)', () => {
  it('says how long the company has been at its address', () => {
    expect(line('2017')).toBe('At this address since 2017 (9 years).')
    expect(line('2017-03')).toBe('At this address since March 2017 (9 years).')
    expect(line('2017-12-04')).toBe('At this address since December 2017 (8 years).')
    expect(line('2025-11')).toBe('At this address since November 2025 (1 year).')
  })

  it('counts a year alone from 1 July, like the rules', () => {
    // 1 July 2018 to 10 Nov 2026 is 8.4 years; the rules count it the same way.
    expect(line('2018')).toBe('At this address since 2018 (8 years).')
    expect(line('2026')).toBe('At this address since 2026 (under a year).')
  })

  it('adds the last fitout when it came after the move-in', () => {
    expect(line('2015', '2024-05')).toBe(
      'At this address since 2015 (11 years). Last fitout May 2024.',
    )
    // A fitout before the move-in is part of the move.
    expect(line('2015-06', '2015-03')).toBe('At this address since June 2015 (11 years).')
    expect(line(null, '2019-06')).toBe('Last fitout June 2019.')
  })

  it('says a move still to come as one', () => {
    expect(line('2027-03')).toBe('Moving to this address in March 2027.')
  })

  it('says "Not known yet" when nothing is known or the date is unreadable', () => {
    expect(line(null)).toBe('Not known yet.')
    expect(line('some time ago')).toBe('Not known yet.')
    expect(line('2017-13')).toBe('Not known yet.')
  })
})
