import { describe, expect, it } from 'vitest'
import { csvName } from '@/api/hooks'
import {
  activeFilterCount,
  dateOf,
  dayOf,
  DEFAULT_STATE,
  exportQuery,
  filterQuery,
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
    expect(filterQuery(state.filters)).toEqual({ city: ['Perth'], min_score: 0 })
    expect(filterQuery({ ...NO_FILTERS, origin: ['web'] })).toEqual({ origin: ['web'] })
    expect(listQuery(state)).toEqual({
      city: ['Perth'],
      min_score: 0,
      sort: 'score',
      order: 'desc',
      limit: 50,
      offset: 100,
    })
    expect(exportQuery(state)).toEqual({
      city: ['Perth'],
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
