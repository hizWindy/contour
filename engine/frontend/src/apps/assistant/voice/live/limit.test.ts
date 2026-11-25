// @vitest-environment node
/**
 * After this month's live voice limit (PLAN-V28 T4-1): live voice stays off until the month
 * changes in Melbourne, in summer time (UTC+11) and winter time (UTC+10). Plain code.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { holdLiveOff, letLiveBack, liveHeldOff, melbourneMonthEnd } from './limit'

afterEach(() => {
  letLiveBack()
})

describe("the next Melbourne month's first moment", () => {
  it.each([
    ['in summer time (AEDT, UTC+11)', '2026-11-25T03:00:00Z', '2026-11-30T13:00:00Z'],
    ['in winter time (AEST, UTC+10)', '2026-06-15T03:00:00Z', '2026-06-30T14:00:00Z'],
    ['into April, still summer time on the 1st', '2027-03-20T00:00:00Z', '2027-03-31T13:00:00Z'],
    ['into October, still winter time on the 1st', '2026-09-20T00:00:00Z', '2026-09-30T14:00:00Z'],
    ['at the year end', '2026-12-31T12:59:00Z', '2026-12-31T13:00:00Z'],
  ])('%s', (_, now, end) => {
    expect(new Date(melbourneMonthEnd(Date.parse(now))).toISOString()).toBe(
      new Date(end).toISOString(),
    )
  })

  it("counts Melbourne's own month: 1 Dec there is still 30 Nov in UTC", () => {
    // 30 Nov 14:00 UTC is 1 Dec 01:00 in Melbourne: the month to wait out is December.
    const end = melbourneMonthEnd(Date.parse('2026-11-30T14:00:00Z'))

    expect(new Date(end).toISOString()).toBe('2026-12-31T13:00:00.000Z')
  })
})

describe('holding live voice off', () => {
  it('holds it off until then, and no longer', () => {
    const until = Date.parse('2026-11-30T13:00:00Z')
    holdLiveOff(until)

    expect(liveHeldOff(until - 1)).toBe(true)
    expect(liveHeldOff(until)).toBe(false)
  })

  it('keeps the later of two holds', () => {
    holdLiveOff(2000)
    holdLiveOff(1000)

    expect(liveHeldOff(1500)).toBe(true)
  })
})
