import { describe, expect, it } from 'vitest'
import { csvName } from '@/api/hooks'
import type { LeadFacets } from '@/api/types'
import {
  activeFilterCount,
  dateOf,
  dayOf,
  DEFAULT_STATE,
  exportQuery,
  filterQuery,
  hidesInHubSpot,
  hubspotChipApplies,
  inHubSpotCount,
  isDefaultTiers,
  listQuery,
  NO_FILTERS,
  readResults,
  writeResults,
} from './params'

const RUN = '0f3c9a2e-1111-4222-8333-444455556666'
const LEAD = '99999999-2222-3333-4444-555555555555'

function read(search: string) {
  return readResults(new URLSearchParams(search))
}

describe('the results address', () => {
  it('opens on the default view: every lead, best score first, page 1', () => {
    expect(read('')).toEqual(DEFAULT_STATE)
    expect(writeResults(DEFAULT_STATE).toString()).toBe('')
  })

  it('reads every filter, the sort, the page, the view and the open lead', () => {
    const state = read(
      `result=pass&result=watch&city=Melbourne&trigger=lease_ending&industry=Software` +
        `&industry_group=Tech&hubspot_status=new&status=watching&origin=hubspot&origin=web` +
        `&run_id=${RUN}&min_score=60` +
        `&office_m2_min=1000&office_m2_max=5000&created_since=2026-10-01&created_until=2026-10-26` +
        `&trigger_since=2026-01-01&q=acme&include_tests=true&facts_missing=true` +
        `&show_in_hubspot=true` +
        `&sort=company&order=asc&page=3` +
        `&view=map&lead=${LEAD}`,
    )
    expect(state).toEqual({
      view: 'map',
      sort: 'company',
      order: 'asc',
      page: 2,
      lead: LEAD,
      filters: {
        // PLAN-V21: no tier in the address is the default view, A, B, C and no tier yet.
        tier: ['A', 'B', 'C', 'none'],
        confidence: [],
        city_group: [],
        has_property: false,
        excluded: false,
        result: ['pass', 'watch'],
        city: ['Melbourne'],
        trigger: ['lease_ending'],
        industry: ['Software'],
        industry_group: ['Tech'],
        hubspot_status: ['new'],
        status: ['watching'],
        origin: ['hubspot', 'web'],
        run_id: RUN,
        min_score: 60,
        office_m2_min: 1000,
        office_m2_max: 5000,
        created_since: '2026-10-01',
        created_until: '2026-10-26',
        trigger_since: '2026-01-01',
        q: 'acme',
        include_tests: true,
        facts_missing: true,
        show_in_hubspot: true,
      },
    })
    // Written back, it reads the same.
    expect(readResults(writeResults(state))).toEqual(state)
  })

  it('ignores values it cannot read, so a bad link still opens the page', () => {
    const state = read(
      'result=best&result=pass&result=pass&hubspot_status=maybe&status=gone&run_id=12' +
        '&origin=linkedin&origin=typed' +
        '&min_score=-4&office_m2_min=lots&created_since=2026-02-30&trigger_since=yesterday' +
        '&sort=salary&order=up&page=0&view=globe&lead=<img>',
    )
    expect(state.filters.result).toEqual(['pass'])
    expect(state.filters.hubspot_status).toEqual([])
    expect(state.filters.status).toEqual([])
    expect(state.filters.origin).toEqual(['typed'])
    expect(state.filters.run_id).toBeNull()
    expect(state.filters.min_score).toBeNull()
    expect(state.filters.office_m2_min).toBeNull()
    expect(state.filters.created_since).toBeNull()
    expect(state.filters.trigger_since).toBeNull()
    expect(state.sort).toBe('score')
    expect(state.order).toBe('desc')
    expect(state.page).toBe(0)
    expect(state.view).toBe('table')
    expect(state.lead).toBeNull()
  })

  it('gives a sort without an order its natural first order', () => {
    expect(read('sort=company').order).toBe('asc')
    expect(read('sort=office_m2').order).toBe('desc')
  })

  it('keeps a typed space in the search, but never sends it', () => {
    const state = { ...DEFAULT_STATE, filters: { ...NO_FILTERS, q: 'acme ' } }
    expect(writeResults(state).get('q')).toBe('acme ')
    expect(filterQuery(state.filters).q).toBe('acme')
    expect(writeResults({ ...state, filters: { ...NO_FILTERS, q: '  ' } }).has('q')).toBe(false)
  })

  it('sends only the filters that are set, with the page as an offset', () => {
    const state = {
      ...DEFAULT_STATE,
      page: 2,
      filters: { ...NO_FILTERS, city: ['Perth'], min_score: 0 },
    }
    // PLAN-V27: new leads only, unless the "In HubSpot" chip is pressed.
    const newLeads = ['new', 'quiet', 'possible_match']
    expect(filterQuery(state.filters)).toEqual({
      tier: ['A', 'B', 'C', 'none'],
      city: ['Perth'],
      hubspot_status: newLeads,
      min_score: 0,
    })
    expect(filterQuery({ ...NO_FILTERS, origin: ['web'] })).toEqual({
      tier: ['A', 'B', 'C', 'none'],
      hubspot_status: newLeads,
      origin: ['web'],
    })
    expect(listQuery(state)).toEqual({
      tier: ['A', 'B', 'C', 'none'],
      city: ['Perth'],
      hubspot_status: newLeads,
      min_score: 0,
      sort: 'score',
      order: 'desc',
      limit: 50,
      offset: 100,
    })
    expect(exportQuery(state)).toEqual({
      tier: ['A', 'B', 'C', 'none'],
      city: ['Perth'],
      hubspot_status: newLeads,
      min_score: 0,
      sort: 'score',
      order: 'desc',
    })
  })

  it('counts the filters that are set, once per field', () => {
    expect(activeFilterCount(NO_FILTERS)).toBe(0)
    expect(
      activeFilterCount({
        ...NO_FILTERS,
        result: ['pass', 'watch'],
        office_m2_min: 1000,
        include_tests: true,
      }),
    ).toBe(3)
  })

  it('turns calendar days into the address form and back', () => {
    expect(dayOf(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(dayOf(dateOf('2026-10-26'))).toBe('2026-10-26')
  })
})

describe('the CSV file name', () => {
  it("uses the backend's name, kept to safe characters", () => {
    expect(csvName('attachment; filename=leads-2026-10-26.csv')).toBe('leads-2026-10-26.csv')
    expect(csvName('attachment; filename="../../leads 1.csv"')).toBe('leads1.csv')
  })

  it('falls back to leads and the date when the backend gives no name', () => {
    expect(csvName(null)).toMatch(/^leads-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(csvName('attachment; filename="run.exe"')).toMatch(/^leads-\d{4}-\d{2}-\d{2}\.csv$/)
  })
})

describe('the tier and the other PLAN-V16 filters (T3-5)', () => {
  it('opens on A, B, C and no tier yet, and sends them spelled out (PLAN-V21 T3-5)', () => {
    expect(read('').filters.tier).toEqual(['A', 'B', 'C', 'none'])
    expect(filterQuery(read('').filters).tier).toEqual(['A', 'B', 'C', 'none'])
    // The default isn't a filter a person set, and it stays out of the address.
    expect(activeFilterCount(read('').filters)).toBe(0)
    expect(writeResults(read('')).toString()).toBe('')
    expect(isDefaultTiers(['none', 'C', 'B', 'A'])).toBe(true)
    expect(isDefaultTiers(['A', 'B'])).toBe(false)
  })

  it('shows every tier with tier=all, and sends all five, so no lead is left out', () => {
    const state = read('tier=all')
    expect(state.filters.tier).toEqual([])
    expect(filterQuery(state.filters).tier).toEqual(['A', 'B', 'C', 'discard', 'none'])
    expect(writeResults(state).toString()).toBe('tier=all')
    expect(activeFilterCount(state.filters)).toBe(1)
  })

  it('reads picked tiers in their order, and ignores a tier it does not know', () => {
    expect(read('tier=C&tier=A').filters.tier).toEqual(['A', 'C'])
    expect(read('tier=discard').filters.tier).toEqual(['discard'])
    expect(read('tier=none&tier=B').filters.tier).toEqual(['B', 'none'])
    expect(read('tier=Z').filters.tier).toEqual(['A', 'B', 'C', 'none'])
    expect(writeResults(read('tier=discard')).toString()).toBe('tier=discard')
    expect(writeResults(read('tier=none')).toString()).toBe('tier=none')
    expect(filterQuery(read('tier=none').filters).tier).toEqual(['none'])
  })

  it('reads and writes confidence, city group, property records and exclusions', () => {
    const search =
      'confidence=low&confidence=nonsense&city_group=regional&has_property=true&excluded=true'
    const state = read(search)
    expect(state.filters).toMatchObject({
      confidence: ['low'],
      city_group: ['regional'],
      has_property: true,
      excluded: true,
    })
    expect(filterQuery(state.filters)).toMatchObject({
      confidence: ['low'],
      city_group: ['regional'],
      has_property: true,
      excluded: true,
    })
    expect(writeResults(state).toString()).toBe(
      'confidence=low&city_group=regional&has_property=true&excluded=true',
    )
    expect(activeFilterCount(state.filters)).toBe(4)
  })
})

describe('new leads only (PLAN-V27 T1-3, choice 6)', () => {
  const FACETS = {
    hubspot_status: [
      { value: 'new', count: 3 },
      { value: 'in_hubspot', count: 5 },
      { value: 'open_deal', count: 2 },
      { value: 'dissolved_deal', count: 1 },
      { value: 'quiet', count: 4 },
    ],
  } as LeadFacets

  it('asks for new, quiet and possible-match leads until the chip is pressed', () => {
    expect(hidesInHubSpot(NO_FILTERS)).toBe(true)
    expect(filterQuery(NO_FILTERS).hubspot_status).toEqual(['new', 'quiet', 'possible_match'])
    const shown = { ...NO_FILTERS, show_in_hubspot: true }
    expect(hidesInHubSpot(shown)).toBe(false)
    expect(filterQuery(shown).hubspot_status).toBeUndefined()
    expect(writeResults({ ...DEFAULT_STATE, filters: shown }).toString()).toBe(
      'show_in_hubspot=true',
    )
  })

  it('lets a HubSpot pick win over the chip, pressed or not', () => {
    for (const show of [false, true]) {
      const picked = {
        ...NO_FILTERS,
        hubspot_status: ['open_deal' as const],
        show_in_hubspot: show,
      }
      expect(hubspotChipApplies(picked)).toBe(false)
      expect(hidesInHubSpot(picked)).toBe(false)
      expect(filterQuery(picked).hubspot_status).toEqual(['open_deal'])
    }
  })

  it('counts In HubSpot, Open deal and Dissolved deal for the chip, once the facets are in', () => {
    expect(inHubSpotCount(FACETS)).toBe(8)
    expect(inHubSpotCount(undefined)).toBeUndefined()
    expect(inHubSpotCount({ hubspot_status: [] } as unknown as LeadFacets)).toBe(0)
  })

  it('is not a filter in use: Clear all and the counts leave it alone', () => {
    expect(activeFilterCount({ ...NO_FILTERS, show_in_hubspot: true })).toBe(0)
  })
})
