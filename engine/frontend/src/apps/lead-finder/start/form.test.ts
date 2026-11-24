import { describe, expect, it } from 'vitest'
import type { RunEstimate } from '@/api/types'
import {
  AUSTRALIA,
  bodyOf,
  errorFor,
  estimateErrors,
  initialForm,
  pickPlaces,
  serverMode,
  targetChoice,
  tenureSummary,
  wholeNumberOf,
  type StartForm,
} from './form'
import { OPTIONS } from './test-options'

function estimate(changes: Partial<RunEstimate> = {}): RunEstimate {
  return {
    valid: true,
    errors: [],
    blocked: null,
    warnings: [],
    slices: 6,
    companies_expected: 20,
    cost_usd_low: '18.70',
    cost_usd_high: '24.00',
    cap_usd: '20.00',
    daily_left_usd: '50.00',
    basis: '',
    over_cap: false,
    target_companies: null,
    target_cost_usd_low: null,
    target_cost_usd_high: null,
    target_note: null,
    ...changes,
  }
}

describe('the old offices run (PLAN-V11 C3)', () => {
  it('is a watchlist run on the server, in the first watchlist city, 10 at a time', () => {
    const form = { ...initialForm(OPTIONS), mode: 'tenure' as const }
    expect(form.tenureLimit).toBe('10')
    expect(form.tenureCity).toBe('Melbourne')
    expect(serverMode('tenure')).toBe('watchlist')
    expect(serverMode('discovery')).toBe('discovery')
    expect(bodyOf(form, OPTIONS)).toEqual({
      app: 'lead_finder',
      mode: 'watchlist',
      params: { watchlist: { focus: 'tenure', city: 'Melbourne', limit: 10 } },
    })
  })

  it('leaves the limit out when "how many" is empty, and sends picked industries', () => {
    const form = {
      ...initialForm(OPTIONS),
      mode: 'tenure' as const,
      tenureCity: 'Perth',
      tenureLimit: ' ',
      tenureIndustries: ['Construction'],
    }
    expect(bodyOf(form, OPTIONS).params).toEqual({
      watchlist: { focus: 'tenure', city: 'Perth', industries: ['Construction'] },
    })
    expect(tenureSummary(form, 1)).toBe(
      'It researches 1 company in Perth in Construction, the most staff first, and sends their names to Claude.',
    )
  })
})

describe('the Start form', () => {
  it('starts from the defaults the backend gives', () => {
    const form = initialForm(OPTIONS)
    expect(form.mode).toBe('discovery')
    expect(form.cities).toEqual(['Melbourne'])
    expect(form.triggers).toEqual(['lease_ending'])
    expect(form.sinceDays).toBe(90)
  })

  it('sends only the parts of discovery, and an area only when it narrows a picked city', () => {
    const form = {
      ...initialForm(OPTIONS),
      cities: ['Melbourne'],
      area: { Melbourne: 'cbd', Sydney: 'inner', Perth: 'all' } as const,
    }
    expect(bodyOf(form, OPTIONS)).toEqual({
      app: 'lead_finder',
      mode: 'discovery',
      params: {
        cities: ['Melbourne'],
        triggers: ['lease_ending'],
        since_days: 90,
        area: { Melbourne: 'cbd' },
        target_companies: 50,
      },
    })
  })

  it('sends the watchlist options, and a limit only when one is typed', () => {
    const form = { ...initialForm(OPTIONS), mode: 'watchlist' as const }
    expect(bodyOf(form, OPTIONS).params).toEqual({
      watchlist: { include_unlikely: true, include_director: false },
    })
    expect(bodyOf({ ...form, watchLimit: ' 15 ' }, OPTIONS).params).toEqual({
      watchlist: { include_unlikely: true, include_director: false, limit: 15 },
    })
  })

  it('sends the typed companies, without empty rows or empty fields', () => {
    const form = {
      ...initialForm(OPTIONS),
      mode: 'company' as const,
      companies: [
        { name: ' Culture Amp ', city: 'Melbourne', website: '' },
        { name: '   ', city: 'Perth', website: '' },
        { name: 'Canva', city: '', website: 'canva.com' },
      ],
    }
    expect(bodyOf(form, OPTIONS).params).toEqual({
      companies: [
        { name: 'Culture Amp', city: 'Melbourne' },
        { name: 'Canva', website: 'canva.com' },
      ],
    })
  })

  it('adds the lower limits only when they are typed', () => {
    const form = { ...initialForm(OPTIONS), runCap: '5.00', maxCompanies: '3' }
    expect(bodyOf(form, OPTIONS).params?.caps).toEqual({ run_cap_usd: '5.00', max_companies: 3 })
    expect(bodyOf(initialForm(OPTIONS), OPTIONS).params?.caps).toBeUndefined()
  })

  it('reads the estimate errors by field, and finds a field from its parts', () => {
    const errors = estimateErrors(
      estimate({
        valid: false,
        errors: [
          { field: 'body.params.cities', message: 'Unknown city' },
          { field: 'body.params.companies.0.name', message: 'Use 2 to 80 characters' },
          { field: 'body.params', message: 'The run is too big' },
        ],
      }),
    )
    expect(errors).toEqual({
      cities: 'Unknown city',
      'companies.0.name': 'Use 2 to 80 characters',
      params: 'The run is too big',
    })
    expect(errorFor(errors, 'companies')).toBe('Use 2 to 80 characters')
    expect(errorFor(errors, 'triggers')).toBeUndefined()
  })
})

describe('where to search (PLAN-V16 T3-2)', () => {
  const PRIORITY = ['Melbourne']
  const SECONDARY = ['Sydney']

  it('makes "All of Australia" the only place, and clears the cities', () => {
    const cities = pickPlaces(OPTIONS, ['Melbourne', 'Sydney'], [AUSTRALIA], [AUSTRALIA])
    expect(cities).toEqual([AUSTRALIA])
    const form = { ...initialForm(OPTIONS), cities, area: { Melbourne: 'cbd' } as const }
    expect(bodyOf(form, OPTIONS).params).toMatchObject({ cities: ['Australia'], area: {} })
  })

  it('clears "All of Australia" when a city is picked, and keeps the options order', () => {
    expect(pickPlaces(OPTIONS, [AUSTRALIA], SECONDARY, ['Sydney'])).toEqual(['Sydney'])
    expect(pickPlaces(OPTIONS, ['Sydney'], PRIORITY, ['Melbourne'])).toEqual([
      'Melbourne',
      'Sydney',
    ])
  })

  it('unpicks within one group and keeps the other groups', () => {
    expect(pickPlaces(OPTIONS, ['Melbourne', 'Sydney'], SECONDARY, [])).toEqual(['Melbourne'])
    expect(pickPlaces(OPTIONS, [AUSTRALIA], [AUSTRALIA], [])).toEqual([])
  })
})

describe('no goal of good leads (PLAN-V20)', () => {
  it('sends no goal: a run researches every company it chooses', () => {
    const body = bodyOf(initialForm(OPTIONS), OPTIONS)
    expect(body.params).not.toHaveProperty('goal_leads')
    expect(initialForm(OPTIONS)).not.toHaveProperty('goalLeads')
  })
})

describe('where to look (PLAN-V16 T3-2)', () => {
  it('ticks every ready source and leaves them out of the body: the server default', () => {
    const form = initialForm(OPTIONS)
    expect(form.sources).toEqual(['web', 'arealytics'])
    expect(bodyOf(form, OPTIONS).params).not.toHaveProperty('sources')
  })

  it('sends the sources when a person changes them', () => {
    const form = { ...initialForm(OPTIONS), sources: ['web' as const] }
    expect(bodyOf(form, OPTIONS).params).toMatchObject({ sources: ['web'] })
  })
})

describe('how many companies (PLAN-V21 T3-3), and no top up (PLAN-V27 choice 5)', () => {
  const form = (changes: Partial<StartForm> = {}): StartForm => ({
    ...initialForm(OPTIONS),
    ...changes,
  })

  it('starts at the backend default, 50', () => {
    expect(form().targetCompanies).toBe('50')
  })

  it('reads a number the way people type it', () => {
    expect(wholeNumberOf(' 40 ')).toBe(40)
    expect(wholeNumberOf('1,000')).toBe(1000)
    expect(wholeNumberOf('30 companies')).toBe(30)
    expect(wholeNumberOf('1 company')).toBe(1)
    expect(wholeNumberOf('fifty')).toBeNull()
    expect(wholeNumberOf('5.5')).toBeNull()
    expect(wholeNumberOf('')).toBeNull()
  })

  it('sends the target for discovery only, and never a top up', () => {
    const discovery = bodyOf(form({ targetCompanies: '25' }), OPTIONS).params
    expect(discovery).toMatchObject({ target_companies: 25 })
    expect(discovery).not.toHaveProperty('top_up')
    for (const mode of ['watchlist', 'tenure', 'company'] as const) {
      const params = bodyOf(form({ mode }), OPTIONS).params
      expect(params).not.toHaveProperty('target_companies')
      expect(params).not.toHaveProperty('top_up')
    }
  })

  it('leaves the target out when the field is empty: the run aims for the default', () => {
    const params = bodyOf(form({ targetCompanies: '  ' }), OPTIONS).params
    expect(params).not.toHaveProperty('target_companies')
  })

  it('says why in plain words when the number cannot be used, and sends no target', () => {
    expect(targetChoice(form({ targetCompanies: 'lots' }), OPTIONS).error).toBe(
      'Type a whole number, like 50.',
    )
    expect(targetChoice(form({ targetCompanies: '3' }), OPTIONS).error).toBe('Pick 5 or more.')
    expect(targetChoice(form({ targetCompanies: '100' }), OPTIONS).error).toBe(
      "Pick at most 70: the run's company limit.",
    )
    expect(bodyOf(form({ targetCompanies: '100' }), OPTIONS).params).not.toHaveProperty(
      'target_companies',
    )
  })

  it('aims for the lower limit when "Most companies to research" is under the target', () => {
    const lowered = form({ targetCompanies: '50', maxCompanies: '30' })
    expect(targetChoice(lowered, OPTIONS)).toEqual({ value: 30, error: null, pulledTo: 30 })
    expect(bodyOf(lowered, OPTIONS).params).toMatchObject({
      target_companies: 30,
      caps: { max_companies: 30 },
    })
    // Under the smallest target the server takes, it is left out: the server pulls its own default
    // down to the limit.
    const tiny = form({ targetCompanies: '50', maxCompanies: '3' })
    expect(targetChoice(tiny, OPTIONS)).toEqual({ value: null, error: null, pulledTo: 3 })
    expect(bodyOf(tiny, OPTIONS).params).not.toHaveProperty('target_companies')
    // A limit at or above the target changes nothing.
    expect(targetChoice(form({ targetCompanies: '25', maxCompanies: '30' }), OPTIONS)).toEqual({
      value: 25,
      error: null,
      pulledTo: null,
    })
  })
})
