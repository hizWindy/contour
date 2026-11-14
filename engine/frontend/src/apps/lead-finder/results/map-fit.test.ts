import { describe, expect, it } from 'vitest'
import { spreadOverCities } from './map-fit'

describe('how the Results map fits (PLAN-V16 T3-5)', () => {
  it('fits all of Australia when the leads are in more than one city', () => {
    expect(spreadOverCities([{ city: 'Perth' }, { city: 'Brisbane' }])).toBe(true)
  })

  it('fits the one city when they are all in it, or have no city', () => {
    expect(spreadOverCities([{ city: 'Perth' }, { city: 'Perth' }, { city: null }])).toBe(false)
    expect(spreadOverCities([])).toBe(false)
  })
})
