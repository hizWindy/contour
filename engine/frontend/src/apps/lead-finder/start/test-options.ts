/** A small `RunOptions` for the Start page tests: two cities, three triggers, four modes. */
import type { RunOptions } from '@/api/types'

export const OPTIONS: RunOptions = {
  cities: [
    {
      name: 'Melbourne',
      kind: 'pass',
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
      lat: -33.87,
      lng: 151.21,
      areas: [
        { id: 'cbd', label: 'CBD', suburbs: ['Sydney CBD'] },
        { id: 'inner', label: 'Inner suburbs', suburbs: ['Pyrmont'] },
        { id: 'all', label: 'Whole city', suburbs: [] },
      ],
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
  companies_limit: { min: 1, max: 25 },
  caps: {
    run_cap_usd: '20.00',
    max_companies: 20,
    company_cap_usd: '2.50',
    daily_left_usd: '50.00',
  },
  defaults: {
    cities: ['Melbourne'],
    area: {},
    triggers: ['lease_ending'],
    since_days: 30,
    caps: { run_cap_usd: null, max_companies: null },
    watchlist: { include_unlikely: true, include_director: false, limit: null },
    companies: [],
    recheck: false,
  },
}
