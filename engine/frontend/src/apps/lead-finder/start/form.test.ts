import { describe, expect, it } from 'vitest'
import type { RunEstimate } from '@/api/types'
import {
  AUSTRALIA,
  bodyOf,
  errorFor,
  estimateErrors,
  goalError,
  goalLine,
  initialForm,
  pickPlaces,
  readGoal,
  readySources,
  serverMode,
  tenureSummary,
} from './form'
import { OPTIONS } from './test-options'

/** The test options switch Property Daily off, so the web and Arealytics are ready. */
const READY = readySources(OPTIONS)

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
    companies_needed: 50,
    goal_note: null,
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
    expect(bodyOf(form, READY)).toEqual({
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
    expect(bodyOf(form, READY).params).toEqual({
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
    expect(form.sinceDays).toBe(30)
  })

  it('sends only the parts of discovery, and an area only when it narrows a picked city', () => {
    const form = {
      ...initialForm(OPTIONS),
      cities: ['Melbourne'],
      area: { Melbourne: 'cbd', Sydney: 'inner', Perth: 'all' } as const,
    }
    expect(bodyOf(form, READY)).toEqual({
      app: 'lead_finder',
      mode: 'discovery',
      params: {
        cities: ['Melbourne'],
        triggers: ['lease_ending'],
        since_days: 30,
        area: { Melbourne: 'cbd' },
        goal_leads: 20,
      },
    })
  })

  it('sends the watchlist options, and a limit only when one is typed', () => {
    const form = { ...initialForm(OPTIONS), mode: 'watchlist' as const }
    expect(bodyOf(form, READY).params).toEqual({
      watchlist: { include_unlikely: true, include_director: false },
    })
    expect(bodyOf({ ...form, watchLimit: ' 15 ' }, READY).params).toEqual({
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
    expect(bodyOf(form, READY).params).toEqual({
      companies: [
        { name: 'Culture Amp', city: 'Melbourne' },
        { name: 'Canva', website: 'canva.com' },
      ],
    })
  })

  it('adds the lower limits only when they are typed', () => {
    const form = { ...initialForm(OPTIONS), runCap: '5.00', maxCompanies: '3' }
    expect(bodyOf(form, READY).params?.caps).toEqual({ run_cap_usd: '5.00', max_companies: 3 })
    expect(bodyOf(initialForm(OPTIONS), READY).params?.caps).toBeUndefined()
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
    expect(bodyOf(form, READY).params).toMatchObject({ cities: ['Australia'], area: {} })
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

describe('how many leads (PLAN-V16 T3-2)', () => {
  it('starts at the default and sends it', () => {
    const form = initialForm(OPTIONS)
    expect(form.goalLeads).toBe('20')
    expect(bodyOf(form, READY).params).toMatchObject({ goal_leads: 20 })
  })

  it('reads "20 leads" as 20, and leaves an empty goal out', () => {
    expect(readGoal(' 20 leads ')).toBe(20)
    expect(readGoal('1 lead')).toBe(1)
    expect(readGoal('twenty')).toBeNull()
    const form = { ...initialForm(OPTIONS), goalLeads: '' }
    expect(bodyOf(form, READY).params).not.toHaveProperty('goal_leads')
    expect(goalError(form, OPTIONS)).toBeUndefined()
  })

  it('says what to type when the goal is outside 1 to 100 or not a number', () => {
    const words = 'Type a whole number from 1 to 100.'
    for (const typed of ['0', '101', 'lots', '2.5']) {
      expect(goalError({ ...initialForm(OPTIONS), goalLeads: typed }, OPTIONS)).toBe(words)
    }
    expect(goalError({ ...initialForm(OPTIONS), goalLeads: '100' }, OPTIONS)).toBeUndefined()
    // Only "Find new leads" has a goal.
    expect(
      goalError({ ...initialForm(OPTIONS), mode: 'company', goalLeads: '0' }, OPTIONS),
    ).toBeUndefined()
  })

  it('says how many companies the goal needs and their cost, or the limit that binds', () => {
    expect(goalLine(estimate(), 20)).toBe('About 50 companies, about US$19.')
    const binds = "20 leads needs about 50 companies. This run's limits allow 20."
    expect(goalLine(estimate({ goal_note: binds }), 20)).toBe(binds)
    expect(goalLine(estimate(), null)).toBeNull()
    expect(goalLine(estimate({ valid: false }), 20)).toBeNull()
    expect(goalLine(estimate({ companies_needed: null }), 20)).toBeNull()
  })
})

describe('where to look (PLAN-V16 T3-2)', () => {
  it('ticks every ready source and leaves them out of the body: the server default', () => {
    const form = initialForm(OPTIONS)
    expect(form.sources).toEqual(['web', 'arealytics'])
    expect(bodyOf(form, READY).params).not.toHaveProperty('sources')
  })

  it('sends the sources when a person changes them', () => {
    const form = { ...initialForm(OPTIONS), sources: ['web' as const] }
    expect(bodyOf(form, READY).params).toMatchObject({ sources: ['web'] })
  })
})
