import { describe, expect, it } from 'vitest'
import { bodyOf, errorFor, estimateErrors, initialForm, serverMode, tenureSummary } from './form'
import { OPTIONS } from './test-options'

describe('the old offices run (PLAN-V11 C3)', () => {
  it('is a watchlist run on the server, in the first watchlist city, 10 at a time', () => {
    const form = { ...initialForm(OPTIONS), mode: 'tenure' as const }
    expect(form.tenureLimit).toBe('10')
    expect(form.tenureCity).toBe('Melbourne')
    expect(serverMode('tenure')).toBe('watchlist')
    expect(serverMode('discovery')).toBe('discovery')
    expect(bodyOf(form)).toEqual({
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
    expect(bodyOf(form).params).toEqual({
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
    expect(bodyOf(form)).toEqual({
      app: 'lead_finder',
      mode: 'discovery',
      params: {
        cities: ['Melbourne'],
        triggers: ['lease_ending'],
        since_days: 30,
        area: { Melbourne: 'cbd' },
      },
    })
  })

  it('sends the watchlist options, and a limit only when one is typed', () => {
    const form = { ...initialForm(OPTIONS), mode: 'watchlist' as const }
    expect(bodyOf(form).params).toEqual({
      watchlist: { include_unlikely: true, include_director: false },
    })
    expect(bodyOf({ ...form, watchLimit: ' 15 ' }).params).toEqual({
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
    expect(bodyOf(form).params).toEqual({
      companies: [
        { name: 'Culture Amp', city: 'Melbourne' },
        { name: 'Canva', website: 'canva.com' },
      ],
    })
  })

  it('adds the lower limits only when they are typed', () => {
    const form = { ...initialForm(OPTIONS), runCap: '5.00', maxCompanies: '3' }
    expect(bodyOf(form).params?.caps).toEqual({ run_cap_usd: '5.00', max_companies: 3 })
    expect(bodyOf(initialForm(OPTIONS)).params?.caps).toBeUndefined()
  })

  it('reads the estimate errors by field, and finds a field from its parts', () => {
    const errors = estimateErrors({
      valid: false,
      errors: [
        { field: 'body.params.cities', message: 'Unknown city' },
        { field: 'body.params.companies.0.name', message: 'Use 2 to 80 characters' },
        { field: 'body.params', message: 'The run is too big' },
      ],
      blocked: null,
      warnings: [],
      slices: 0,
      companies_expected: 0,
      cost_usd_low: '0',
      cost_usd_high: '0',
      cap_usd: '20.00',
      daily_left_usd: '50.00',
      basis: '',
      over_cap: false,
    })
    expect(errors).toEqual({
      cities: 'Unknown city',
      'companies.0.name': 'Use 2 to 80 characters',
      params: 'The run is too big',
    })
    expect(errorFor(errors, 'companies')).toBe('Use 2 to 80 characters')
    expect(errorFor(errors, 'triggers')).toBeUndefined()
  })
})
