/**
 * The Schedules control's pure parts (PLAN-V13 T1-7): the checks in the backend's words, the
 * preview line for weeks and for days, the split and the month.
 */
import { describe, expect, it } from 'vitest'
import {
  bodyOf,
  checkForm,
  monthWords,
  oftenOf,
  previewWords,
  splitWords,
  usd,
  withOften,
  type RoundForm,
} from './round-plan'

const MONDAY_10AM = new Date('2026-11-15T23:00:00Z') // Mon 16 Nov, 10:00 am in Melbourne

function form(changes: Partial<RoundForm> = {}): RoundForm {
  return {
    enabled: true,
    cities: ['Melbourne', 'Adelaide', 'Perth', 'Sydney'],
    often: 'two-weeks',
    every: '2',
    unit: 'weeks',
    weekday: 0,
    at: '07:00',
    budget: '150',
    ...changes,
  }
}

describe('the preview line', () => {
  it('starts the next round on the first day still to come', () => {
    expect(previewWords(form(), MONDAY_10AM)).toBe(
      'Next round: Mon 23 Nov, 7:00 am. Melbourne Mon, Adelaide Tue, Perth Wed, Sydney Thu. Up to US$150.',
    )
    // Today still counts while its time hasn't come.
    expect(previewWords(form({ at: '11:30' }), MONDAY_10AM)).toBe(
      'Next round: Mon 16 Nov, 11:30 am. Melbourne Mon, Adelaide Tue, Perth Wed, Sydney Thu. Up to US$150.',
    )
  })

  it('keeps the fixed order and one day apart, past Sunday, for days too', () => {
    const days = form({ often: 'thirty-days', every: '30', unit: 'days', weekday: 5 })
    expect(previewWords({ ...days, cities: ['Sydney', 'Perth'] }, MONDAY_10AM)).toBe(
      'Next round: Sat 21 Nov, 7:00 am. Perth Sat, Sydney Sun. Up to US$150.',
    )
    expect(previewWords({ ...days, enabled: false }, MONDAY_10AM)).toBe(
      'When it is on, the next round would be: Sat 21 Nov, 7:00 am. Melbourne Sat, Adelaide Sun, Perth Mon, Sydney Tue. Up to US$150.',
    )
  })

  it('says nothing while no city is picked', () => {
    expect(previewWords(form({ cities: [] }), MONDAY_10AM)).toBe('')
  })
})

describe('the checks', () => {
  it('passes a good plan, and names each field that is wrong', () => {
    expect(checkForm(form(), 200)).toEqual({})
    expect(checkForm(form({ cities: [] }), 200).cities).toBe('Pick at least one city.')
    expect(checkForm(form({ every: '3', unit: 'days' }), 200).every).toBe(
      '4 cities run on 4 days in a row, so a round can repeat every 4 days at most often.',
    )
    expect(checkForm(form({ every: '53' }), 200).every).toBe('Use 52 weeks or fewer.')
    expect(checkForm(form({ every: '1.5' }), 200).every).toBe('Use a whole number, 1 or more.')
    expect(checkForm(form({ budget: '0.5' }), 200).budget).toBe('Use US$1 or more.')
    expect(checkForm(form({ budget: '250' }), 200).budget).toBe(
      'Must be at most US$200. The ceiling on the server is lower.',
    )
    expect(checkForm(form({ budget: '10.005' }), 200).budget).toBe('Use whole cents.')
  })

  it('sends the cities in the fixed order and the budget in cents', () => {
    expect(bodyOf(form({ cities: ['Sydney', 'Melbourne'], budget: '120.5' }))).toEqual({
      enabled: true,
      cities: ['Melbourne', 'Sydney'],
      every: 2,
      unit: 'weeks',
      weekday: 0,
      at: '07:00',
      budget_usd: '120.50',
    })
  })
})

describe('how often, the split and the month', () => {
  it('knows the two usual plans and keeps Custom as it is', () => {
    expect(oftenOf(2, 'weeks')).toBe('two-weeks')
    expect(oftenOf(30, 'days')).toBe('thirty-days')
    expect(oftenOf(3, 'weeks')).toBe('custom')
    expect(withOften(form({ every: '3' }), 'thirty-days')).toMatchObject({
      every: '30',
      unit: 'days',
    })
    expect(withOften(form({ every: '3' }), 'custom')).toMatchObject({ every: '3', unit: 'weeks' })
  })

  it('splits the budget as a guide, and says the most a month could spend', () => {
    expect(splitWords('150', 4)).toBe('US$150 a round, so about US$37 a city if all 4 run.')
    expect(splitWords('150', 1)).toBe('US$150 a round, for one city.')
    expect(splitWords('', 4)).toBe('')
    expect(monthWords(form())).toBe('US$327') // 150 x 30.4375 / 14, rounded up
    expect(usd(37.5)).toBe('US$37.50')
  })
})
