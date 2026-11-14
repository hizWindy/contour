/**
 * A small `RunOptions` for the Start page tests: "All of Australia" and a city in each of the four
 * groups (PLAN-V16), three triggers, four modes, the goal, and the three sources with Property
 * Daily switched off.
 */
import type { RunOptions } from '@/api/types'

const AREAS = (city: string, inner: string) => [
  { id: 'cbd' as const, label: 'CBD', suburbs: [`${city} CBD`] },
  { id: 'inner' as const, label: 'Inner suburbs', suburbs: [inner] },
  { id: 'all' as const, label: 'Whole city', suburbs: [] },
]

/** The backend's sentence for a tool that isn't ready. */
export const PROPERTY_DAILY_OFF = 'Property Daily is switched off. An Admin can switch it on.'

export const OPTIONS: RunOptions = {
  cities: [
    {
      name: 'Australia',
      kind: 'pass',
      group: 'national',
      lat: -25.27,
      lng: 133.78,
      areas: [],
    },
    {
      name: 'Melbourne',
      kind: 'pass',
      group: 'priority',
      lat: -37.81,
      lng: 144.96,
      areas: [
        { id: 'cbd', label: 'CBD', suburbs: ['Melbourne CBD', 'Docklands'] },
        { id: 'inner', label: 'Inner suburbs', suburbs: ['Richmond'] },
        { id: 'all', label: 'Whole city', suburbs: [] },
      ],
    },
    {
      name: 'Sydney',
      kind: 'director_review',
      group: 'secondary',
      lat: -33.87,
      lng: 151.21,
      areas: [
        { id: 'cbd', label: 'CBD', suburbs: ['Sydney CBD'] },
        { id: 'inner', label: 'Inner suburbs', suburbs: ['Pyrmont'] },
        { id: 'all', label: 'Whole city', suburbs: [] },
      ],
    },
    {
      name: 'Darwin',
      kind: 'pass',
      group: 'capital',
      lat: -12.46,
      lng: 130.84,
      areas: AREAS('Darwin', 'Parap'),
    },
    {
      name: 'Geelong',
      kind: 'pass',
      group: 'regional',
      lat: -38.15,
      lng: 144.36,
      areas: AREAS('Geelong', 'Newtown'),
    },
  ],
  triggers: [
    { id: 'lease_ending', label: 'Lease ending in 1 to 3 years', group: 'main', default: true },
    { id: 'fast_growth', label: 'Fast growth', group: 'main', default: false },
    { id: 'new_ceo', label: 'New CEO or culture change', group: 'weak', default: false },
  ],
  since_days: { choices: [7, 30], default: 30 },
  modes: [
    { mode: 'discovery', title: 'Find new leads', needs_approval: false, approved: true },
    {
      mode: 'watchlist',
      title: 'Research the HubSpot watchlist',
      needs_approval: true,
      approved: false,
    },
    { mode: 'company', title: 'Research companies by name', needs_approval: false, approved: true },
    { mode: 'testset', title: 'Run the test set', needs_approval: false, approved: true },
  ],
  watchlist_cities: ['Melbourne', 'Adelaide', 'Perth'],
  companies_limit: { min: 1, max: 25 },
  caps: {
    run_cap_usd: '20.00',
    max_companies: 20,
    company_cap_usd: '2.50',
    daily_left_usd: '50.00',
  },
  goal_leads: { default: 20, min: 1, max: 100 },
  sources: {
    web: { on: true, ready: true, message: null },
    property_daily: { on: false, ready: false, message: PROPERTY_DAILY_OFF },
    arealytics: { on: true, ready: true, message: null },
  },
  defaults: {
    cities: ['Melbourne'],
    area: {},
    triggers: ['lease_ending'],
    since_days: 30,
    sources: null,
    goal_leads: null,
    caps: { run_cap_usd: null, max_companies: null },
    watchlist: {
      include_unlikely: true,
      include_director: false,
      limit: null,
      focus: 'growth',
      city: null,
      industries: [],
    },
    companies: [],
    recheck: false,
  },
}
