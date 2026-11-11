import { describe, expect, it } from 'vitest'
import {
  barLabels,
  costBars,
  costSince,
  daysBefore,
  firstName,
  greetingWord,
  longDate,
  shortDay,
  weekdayDay,
} from './home-words'

describe("Home's greeting", () => {
  it('follows the clock: morning from 5 am, afternoon from noon, evening from 6 pm', () => {
    expect(greetingWord(4)).toBe('Good evening')
    expect(greetingWord(5)).toBe('Good morning')
    expect(greetingWord(11)).toBe('Good morning')
    expect(greetingWord(12)).toBe('Good afternoon')
    expect(greetingWord(17)).toBe('Good afternoon')
    expect(greetingWord(18)).toBe('Good evening')
  })

  it('uses the first name', () => {
    expect(firstName('Al-khair M. Pama')).toBe('Al-khair')
    expect(firstName('  Levi   Young ')).toBe('Levi')
    expect(firstName('')).toBe('')
  })

  it('writes the date in full, with no comma', () => {
    expect(longDate(new Date(2026, 10, 11, 9))).toBe('Wednesday 11 November')
  })
})

describe('the Runs and cost card', () => {
  it('looks back 30 days, today included', () => {
    expect(daysBefore('2026-11-11', 1)).toBe('2026-11-10')
    expect(costSince('2026-11-11')).toBe('2026-10-13')
  })

  it('labels the bars as short as it can, with the month where it changes', () => {
    expect(
      barLabels(
        ['2026-10-27', '2026-10-28', '2026-10-31', '2026-11-03', '2026-11-10', '2026-11-11'],
        '2026-11-11',
      ),
    ).toEqual(['27 Oct', '28', '31', '3 Nov', '10', 'Today'])
  })

  it('names days short', () => {
    expect(shortDay('2026-10-27')).toBe('27 Oct')
    expect(weekdayDay('2026-10-27')).toBe('Tue 27 Oct')
  })

  it('draws the newest days with a run, oldest first, each against the biggest', () => {
    const days = Array.from({ length: 10 }, (_, index) => ({
      date: `2026-11-${String(index + 1).padStart(2, '0')}`,
      runs: index === 4 ? 0 : 1,
      cost_usd: String(index + 1),
    }))
    const bars = costBars({ since: '2026-10-13', total_cost_usd: '0', total_runs: 9, days })
    expect(bars).toHaveLength(8)
    expect(bars[0]?.date).toBe('2026-11-02') // the 5th had no run, so it is left out
    expect(bars.at(-1)).toEqual({ date: '2026-11-10', runs: 1, cost: '10', share: 1 })
    expect(bars[0]?.share).toBeCloseTo(0.2)
  })
})
