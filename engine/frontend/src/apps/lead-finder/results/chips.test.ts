import { describe, expect, it } from 'vitest'
import type { LeadFacets } from '@/api/types'
import { activeChips, panelFilterCount } from './chips'
import { NO_FILTERS } from './params'

const RUN = '11111111-2222-3333-4444-555555555555'

const FACETS = {
  trigger: [{ id: 'lease_ending', label: 'Lease ending in 1 to 3 years', count: 2 }],
  runs: [{ id: RUN, created_at: '2026-10-26T04:00:00Z', mode: 'discovery', count: 3 }],
} as unknown as LeadFacets

describe('the filters in use, as chips', () => {
  it('has no chip when no filter is set', () => {
    expect(activeChips(NO_FILTERS)).toEqual([])
  })

  it('gives each value of a list its own chip, in words, and removes only that value', () => {
    const chips = activeChips(
      { ...NO_FILTERS, city: ['Melbourne', 'Perth'], origin: ['hubspot'], result: ['pass'] },
      FACETS,
    )
    expect(chips.map((chip) => chip.label)).toEqual([
      'Result: Pass',
      'City: Melbourne',
      'City: Perth',
      'Source: From HubSpot',
    ])
    expect(chips[2]?.remove).toEqual({ city: ['Melbourne'] })
    expect(chips[3]?.remove).toEqual({ origin: [] })
  })

  it('names signs and runs by their labels, and still shows one the facets no longer list', () => {
    const chips = activeChips(
      { ...NO_FILTERS, trigger: ['lease_ending', 'new_office_fitout'], run_id: RUN },
      FACETS,
    )
    expect(chips.map((chip) => chip.label)).toEqual([
      'Sign: Lease ending in 1 to 3 years',
      'Sign: New office fitout',
      expect.stringMatching(/^Run: .+2026.*, Find new leads$/),
    ])
    expect(activeChips({ ...NO_FILTERS, run_id: RUN })[0]?.label).toBe('Run: one run')
  })

  it('says each number, date and switch in words, and removes it whole', () => {
    const chips = activeChips({
      ...NO_FILTERS,
      q: ' acme ',
      min_score: 60,
      office_m2_min: 1000,
      office_m2_max: 5000,
      created_since: '2026-10-01',
      trigger_since: '2026-01-01',
      include_tests: true,
      facts_missing: true,
    })
    expect(chips.map((chip) => [chip.label, chip.remove])).toEqual([
      ['Name: acme', { q: '' }],
      ['Researched: from 1 Oct 2026', { created_since: null, created_until: null }],
      ['Sign since 1 Jan 2026', { trigger_since: null }],
      ['Score: 60 or more', { min_score: null }],
      ['Office: 1,000 m² to 5,000 m²', { office_m2_min: null, office_m2_max: null }],
      ['Test set leads shown', { include_tests: false }],
      ['Only leads with facts missing', { facts_missing: false }],
    ])
    expect(
      activeChips({ ...NO_FILTERS, created_since: '2026-10-01', created_until: '2026-10-26' })[0]
        ?.label,
    ).toBe('Researched: 1 Oct 2026 to 26 Oct 2026')
    expect(activeChips({ ...NO_FILTERS, office_m2_max: 900 })[0]?.label).toBe(
      'Office: up to 900 m²',
    )
  })

  it('gives every chip its own key', () => {
    const chips = activeChips({
      ...NO_FILTERS,
      city: ['Perth'],
      industry: ['Perth'],
      status: ['new'],
      hubspot_status: ['new'],
    })
    expect(new Set(chips.map((chip) => chip.key)).size).toBe(chips.length)
  })
})

describe('the number on the Filters button', () => {
  it('counts the filters in the panel once each, and leaves out the bar on a laptop', () => {
    const filters = {
      ...NO_FILTERS,
      q: 'acme',
      result: ['pass' as const],
      city: ['Perth'],
      status: ['watching' as const],
      created_since: '2026-10-01',
      created_until: '2026-10-26',
      office_m2_min: 1000,
      office_m2_max: 5000,
      include_tests: true,
    }
    // Status, the dates (one range), the office size (one range) and the test set.
    expect(panelFilterCount(filters, true)).toBe(4)
    // On a phone, Result and City are in the panel too. The search never is.
    expect(panelFilterCount(filters, false)).toBe(6)
    expect(panelFilterCount(NO_FILTERS, false)).toBe(0)
  })
})
