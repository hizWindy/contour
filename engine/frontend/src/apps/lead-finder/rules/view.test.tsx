import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { mockApi } from '@/test/mock-api'
import { renderWithProviders } from '@/test/render'
import RulesView from './view'

const RULES_V2 = {
  version: 'abc123',
  criteria: {
    cities: { pass: ['Melbourne'], director_review: ['Sydney'], other_cities: 'director_review' },
    size: {
      staff_min: 100,
      staff_hint_min: 75,
      staff_floor: 50,
      growth_signs: ['fast_growth', 'new_to_australia'],
      staff_max: 600,
      staff_counted_in: 'city',
      linkedin_staff_multiplier: 2,
      office_m2_min: 1000,
      office_m2_max: 6000,
      director_band_m2: [800, 1000],
      grow_into_range_months: 24,
      staff_sources: ['hubspot', 'headcount_tool', 'linkedin', 'web_research'],
    },
    data_sources: {
      company_details: ['headcount_tool', 'web_research'],
      office_cities: ['headcount_tool', 'web_research'],
      decision_makers: ['headcount_tool', 'web_research'],
    },
    conflicts: { staff_gap_ratio: 2 },
    score: {
      parts: {
        trigger: { label: 'Business or property trigger', points: 25 },
        size: { label: 'Project size', points: 20 },
      },
      bands: { research_first: 75, investigate: 50 },
      band_basis: 'scaled',
    },
    office_age: {
      due_years: 5,
      recent_move_years: 3,
      just_moved_months: 12,
      tenure_years: 8,
      tenure_sign: 'long_tenure',
      lease_guess_years: [5, 7],
    },
    stages: { pass: 'Active prospect', watch: 'Target account' },
    triggers: {
      main: [],
      other: [],
      weak: [],
      recent_months: 12,
      window_years: 3,
      best_window_years: [1, 3],
    },
    rivals: {
      enabled: true,
      tiers: ['tier_1', 'tier_2'],
      per_lead: 5,
      per_run: 5,
      max_searches: 2,
      sign: 'rival_growth',
    },
    never_suggest: {
      already_sent: true,
      open_deal: true,
      dissolved_deal_wait_months: 12,
      do_not_contact: true,
    },
    tbc: [],
    source_domains: { blocked: ['propertydaily.com.au'] },
  },
  watchlist: { tbc: [] },
}

describe('Rules', () => {
  it('lists what is still to be confirmed with Levi', async () => {
    mockApi({
      '/api/v1/lead-finder/rules': {
        ...RULES_V2,
        criteria: {
          ...RULES_V2.criteria,
          cities: { pass: ['Melbourne'], director_review: ['Sydney'], other_cities: 'drop' },
          triggers: {
            ...RULES_V2.criteria.triggers,
            main: [{ id: 'lease_ending', label: 'Lease ending in 1 to 3 years' }],
          },
          tbc: [{ key: 'size.m2_per_staff', note: 'Is 10 m² per person right?' }],
        },
      },
    })
    renderWithProviders(<RulesView />)
    expect(await screen.findByText('size.m2_per_staff')).toBeInTheDocument()
    expect(screen.getByText('Is 10 m² per person right?')).toBeInTheDocument()
    expect(screen.getByText('TBC')).toBeInTheDocument()
    expect(screen.getByText(/propertydaily\.com\.au/)).toBeInTheDocument()
  })

  it('shows the version 2 rules: the staff hint, the six parts, the bands and the stages', async () => {
    mockApi({
      '/api/v1/lead-finder/rules': RULES_V2,
    })
    renderWithProviders(<RulesView />)
    expect(await screen.findByText(/75\s*\+ fits; 50 to 74 is a Watch/)).toBeInTheDocument()
    expect(screen.getByText(/under 50 is a Drop, too small/)).toBeInTheDocument()
    expect(screen.getByText(/up to 5 of its rivals in the same city/)).toBeInTheDocument()
    expect(screen.getByText('Business or property trigger: 25 points')).toBeInTheDocument()
    expect(
      screen.getByText(/75 to 100 research first, 50 to 74 investigate, under 50 nurture/),
    ).toBeInTheDocument()
    expect(screen.getByText(/scaled to the points checked/)).toBeInTheDocument()
    expect(screen.getByText('Pass: Active prospect')).toBeInTheDocument()
    expect(screen.getByText('Watch: Target account')).toBeInTheDocument()
    expect(screen.getByText(/More than 5 years at the same address is due/)).toBeInTheDocument()
    expect(screen.getByText(/One in the last 12 months makes a lead a Watch/)).toBeInTheDocument()
    expect(
      screen.getByText(/old office's sign \(8\+ years at the same address\) comes from the office/),
    ).toBeInTheDocument()
    // PLAN-V12 B1: the lease guess on the lead card's Why now
    expect(
      screen.getByText(/Why now guesses that a lease may end 5 to 7 years after the move-in/),
    ).toBeInTheDocument()
  })

  it('shows no Watch band for size once the hint and the floor are both 50 (PLAN-V11 B2)', async () => {
    mockApi({
      '/api/v1/lead-finder/rules': {
        ...RULES_V2,
        criteria: {
          ...RULES_V2.criteria,
          size: { ...RULES_V2.criteria.size, staff_min: 50, staff_hint_min: 50, staff_floor: 50 },
        },
      },
    })
    renderWithProviders(<RulesView />)
    expect(
      await screen.findByText(/50\s*\+ fits;\s*under 50 is a Drop, too small/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/is a Watch with a/)).not.toBeInTheDocument()
    expect(
      screen.getByText('The HubSpot watchlist lists companies with 50+ staff in the city.'),
    ).toBeInTheDocument()
  })

  it('shows which source is main for which data', async () => {
    mockApi({
      '/api/v1/lead-finder/rules': RULES_V2,
    })
    renderWithProviders(<RulesView />)
    expect(await screen.findByText('Where the data comes from')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Staff in the city: HubSpot, then Signal Hire, then LinkedIn (doubled), then the web research',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Company name, website and industry: Signal Hire, then the web research'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Decision makers: Signal Hire, then the web research'),
    ).toBeInTheDocument()
    expect(screen.getByText(/more than 2 times apart raise a flag/)).toBeInTheDocument()
  })
})
