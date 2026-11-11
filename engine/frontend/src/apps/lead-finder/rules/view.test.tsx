import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockApi } from '@/test/mock-api'
import { renderWithProviders } from '@/test/render'
import RulesView from './view'
import { list, partChecks, SECTIONS } from './words'

/** The rules as the API gives them today (11 Nov), cut to what the page reads. */
const RULES = {
  version: 'abc123',
  criteria: {
    label: "Draft version 2, 30 Oct 2026, with Levi's 9 Nov changes",
    cities: {
      pass: ['Melbourne', 'Adelaide', 'Perth'],
      director_review: ['Sydney'],
      other_cities: 'director_review',
      no_city_director_signs: ['new_to_australia'],
    },
    size: {
      staff_min: 50,
      staff_hint_min: 50,
      staff_floor: 50,
      growth_signs: ['fast_growth', 'new_to_australia'],
      staff_max: 600,
      staff_counted_in: 'city',
      linkedin_staff_multiplier: 2,
      headcount_tool_multiplier: 2,
      headcount_tool_name_check: 'auto',
      m2_per_staff: 10,
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
    fitout: { rate_per_m2_aud: '1500' },
    industries: {
      tier_1: ['Energy and infrastructure', 'Mining and resources'],
      tier_2: ['Defence and advanced manufacturing'],
      director_review: ['Government', 'Law firms'],
      check_office_size: ['Construction', 'Retail'],
    },
    fit: { local_team_runs_project: true, healthy: true },
    office_age: {
      due_years: 5,
      recent_move_years: 3,
      just_moved_months: 12,
      tenure_years: 8,
      tenure_sign: 'long_tenure',
      lease_guess_years: [5, 7],
    },
    triggers: {
      main: [
        { id: 'lease_ending', label: 'Lease ending in 1 to 3 years, or a relocation' },
        { id: 'new_to_australia', label: 'An overseas company opening its first office here' },
        { id: 'long_tenure', label: 'At the same address for 8 or more years' },
      ],
      other: [{ id: 'restructure', label: 'Restructure' }],
      weak: [{ id: 'rival_growth', label: 'A rival of a booming company' }],
      recent_months: 12,
      window_years: 3,
      best_window_years: [1, 3],
      consultant_window_months: 18,
    },
    rivals: {
      enabled: true,
      tiers: ['tier_1', 'tier_2'],
      per_lead: 5,
      per_run: 5,
      max_searches: 2,
      sign: 'rival_growth',
    },
    boosters: [{ id: 'buys_strategy', label: 'Talks about culture or hybrid work' }],
    never_suggest: {
      already_sent: true,
      open_deal: true,
      dissolved_deal_wait_months: 12,
      do_not_contact: true,
    },
    sources_rank: ['property_daily', 'asx_or_official_news', 'other_news', 'job_ads'],
    source_domains: {
      property_daily: [],
      asx_or_official_news: ['asx.com.au'],
      job_ads: ['seek.com.au'],
      blocked: ['propertydaily.com.au', 'lusha.com'],
    },
    score: {
      parts: {
        trigger: { label: 'Business or property trigger', points: 25 },
        size: { label: 'Project size', points: 20 },
        timing: { label: 'Timing', points: 15 },
        access: { label: 'Decision-maker access', points: 15 },
        fit: { label: 'Integrated strategic fit', points: 15 },
        competition: { label: 'Competitive opportunity', points: 10 },
      },
      check_labels: {
        trigger_group: 'The best trigger',
        source: 'How strong its source is',
        size: 'Office size',
        recency: 'How recent the trigger is',
        years_at_address: 'Years at the same address',
        no_recent_move: 'No recent move or fitout',
        contact_role: 'A contact role found',
        hubspot_contact: 'A contact already in HubSpot',
        customer_link: 'A link to a current customer',
        buys_strategy: 'Talks about culture',
        industry_tier: 'Industry tier',
        no_rival_in_place: "Not in a competitor's case studies",
        no_contractor_relationship: 'No known fitout contractor relationship',
      },
      trigger_group: { main: 15, other: 10, weak: 4 },
      source: { property_daily: 10, asx_or_official_news: 8, other_news: 5, job_ads: 2 },
      size: {
        confirmed_in_range: 20,
        estimated_in_range: 16,
        growing_into_range: 14,
        director: 10,
      },
      recency: [
        { within_days: 30, points: 6 },
        { within_days: 90, points: 4 },
      ],
      undated: 1,
      lease_in_best_window: 6,
      years_at_address: 7,
      no_recent_move: 2,
      access: { contact_role: 5, hubspot_contact: 5, customer_link: 5 },
      fit: { buys_strategy: 8, tier_1: 7, tier_2: 4 },
      competition: { no_rival_in_place: 6, no_contractor_relationship: 4 },
      unseen: ['hubspot_contact', 'customer_link', 'no_contractor_relationship'],
      bands: { research_first: 75, investigate: 50 },
      band_basis: 'scaled',
    },
    results: ['pass', 'director_review', 'watch', 'drop'],
    stages: { pass: 'Active prospect', watch: 'Target account' },
    tbc: [
      { key: 'size.m2_per_staff', note: 'Question 8. Is 10 m² per person right?' },
      {
        key: 'score',
        note: "The six parts are the Profile's, which leadership hasn't approved. The checks inside them and all their points are our proposal, until Levi fills in the Importance column. Three checks can't be judged yet.",
      },
    ],
  },
  watchlist: {
    count_cities: ['Melbourne', 'Adelaide', 'Perth'],
    staff: { missing: 'unknown', staff_max_applies_to_director: false },
    director_industries: {},
    not_office_based: {},
    tbc: [{ key: 'staff.missing', note: 'A missing LinkedIn number stays unknown.' }],
  },
  queries: {
    areas: { Melbourne: {}, Adelaide: {}, Perth: {}, Sydney: {} },
    discovery: { lease_ending: [], new_to_australia: [] },
    company: { property: [], people: [], money: [], tenure: [] },
  },
  hubspot_map: { list_name: 'x', company: {} },
}

function row(rule: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(`[data-rule="${rule}"]`)
  if (!node) throw new Error(`no row for ${rule}`)
  return node
}

describe('Rules', () => {
  it('shows every section the segmented control names, each with its rules in table digits', async () => {
    mockApi({ '/api/v1/lead-finder/rules': RULES })
    renderWithProviders(<RulesView />)
    const jump = await screen.findByRole('radiogroup', { name: 'Jump to a section' })
    for (const section of SECTIONS) {
      expect(within(jump).getByRole('radio', { name: section.label })).toBeInTheDocument()
      expect(document.getElementById(`rules-${section.value}`)).not.toBeNull()
    }
    expect(screen.getByText(/^Version/)).toHaveTextContent('Version abc123')
    // Cities
    expect(screen.getByText('Melbourne, Adelaide and Perth')).toBeInTheDocument()
    expect(row('cities.no_city_director_signs')).toHaveTextContent(
      'Director review, when the sign is "An overseas company opening its first office here"',
    )
    // Size: the numbers, in the site's number format
    expect(screen.getByText('1,000 to 6,000 m²')).toBeInTheDocument()
    expect(row('size.staff_hint_min')).toHaveTextContent('50+')
    expect(row('size.staff_floor')).toHaveTextContent('under 50')
    expect(screen.getByText('600 staff')).toBeInTheDocument()
    expect(row('size.grow_into_range_months')).toHaveTextContent('24 months')
    expect(row('size.headcount_tool_name_check')).toHaveTextContent(/auto: strict while/)
    // No Watch band once the hint and the floor are both 50 (PLAN-V11 B2)
    expect(screen.queryByText(/check office size" flag/)).not.toBeInTheDocument()
    // Timing
    expect(row('office_age.just_moved_months')).toHaveTextContent('the last 12 months')
    expect(row('office_age.lease_guess_years')).toHaveTextContent('5 to 7 years after the move-in')
    // Never suggest, with an icon and a word
    expect(row('never_suggest.dissolved_deal_wait_months')).toHaveTextContent('12 months')
    expect(screen.getAllByText('Yes').length).toBeGreaterThanOrEqual(5)
    // Sources
    expect(row('size.staff_sources')).toHaveTextContent(
      'HubSpot, then Signal Hire, then LinkedIn (doubled), then the web research',
    )
    expect(screen.getByText('propertydaily.com.au, lusha.com')).toBeInTheDocument()
    expect(screen.getByText('2 signs in 4 cities')).toBeInTheDocument()
  })

  it('shows a Watch band for size only while the hint is above the floor', async () => {
    mockApi({
      '/api/v1/lead-finder/rules': {
        ...RULES,
        criteria: { ...RULES.criteria, size: { ...RULES.criteria.size, staff_hint_min: 75 } },
      },
    })
    renderWithProviders(<RulesView />)
    expect(await screen.findByText(/check office size" flag/)).toBeInTheDocument()
    const size = document.getElementById('rules-size') as HTMLElement
    expect(within(size).getByText('50 to 74')).toBeInTheDocument()
  })

  it('groups the signs as Claude reads them, with their code names', async () => {
    mockApi({ '/api/v1/lead-finder/rules': RULES })
    renderWithProviders(<RulesView />)
    const signs = await screen.findByText('Signs of an office change')
    const card = signs.closest('[data-section]') as HTMLElement
    expect(within(card).getByText('Main')).toBeInTheDocument()
    expect(within(card).getByText('Boosters')).toBeInTheDocument()
    expect(within(card).getByText('Other')).toBeInTheDocument()
    expect(within(card).getByText('Weak')).toBeInTheDocument()
    expect(
      within(card).getByText('Lease ending in 1 to 3 years, or a relocation'),
    ).toBeInTheDocument()
    expect(within(card).getByText('lease_ending')).toBeInTheDocument()
    expect(within(card).getByText('Talks about culture or hybrid work')).toBeInTheDocument()
    expect(within(card).getByText('A rival of a booming company')).toBeInTheDocument()
    // The new sign of 9 Nov carries its mark
    expect(row('triggers.main.long_tenure')).toHaveTextContent('New 9 Nov')
  })

  it('marks what is TBC and what changed on 9 Nov, and lists the TBC rules beside', async () => {
    mockApi({ '/api/v1/lead-finder/rules': RULES })
    const { user } = renderWithProviders(<RulesView />)
    expect(await screen.findByRole('heading', { name: /Waiting on Levi/ })).toHaveTextContent('3')
    const aside = screen.getByRole('complementary')
    expect(within(aside).getByText('Office size from staff')).toBeInTheDocument()
    expect(within(aside).getByText('size.m2_per_staff')).toBeInTheDocument()
    expect(within(aside).getByText('Question 8. Is 10 m² per person right?')).toBeInTheDocument()
    expect(within(aside).getByText('Watchlist: a missing staff number')).toBeInTheDocument()
    // A long note sits behind More
    const more = within(aside).getByRole('button', { name: 'More' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    await user.click(more)
    expect(within(aside).getByRole('button', { name: 'Less' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    // The rows carry the marks
    expect(within(row('size.m2_per_staff')).getByText('TBC')).toBeInTheDocument()
    expect(within(row('size.staff_floor')).queryByText('TBC')).not.toBeInTheDocument()
    expect(row('size.staff_floor')).toHaveTextContent('Changed 9 Nov')
    expect(row('score.years_at_address')).toHaveTextContent('Changed 9 Nov')
    // A note on a whole section marks its title
    const score = screen.getByText('Score', { selector: '[data-slot=card-title]' })
    expect(within(score).getByText('TBC')).toBeInTheDocument()
  })

  it('jumps to a section from the segmented control, by mouse and keyboard', async () => {
    const scrolled = vi.fn()
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(scrolled)
    mockApi({ '/api/v1/lead-finder/rules': RULES })
    const { user } = renderWithProviders(<RulesView />)
    const jump = await screen.findByRole('radiogroup', { name: 'Jump to a section' })
    await user.click(within(jump).getByRole('radio', { name: 'Score' }))
    expect(within(jump).getByRole('radio', { name: 'Score' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    // The segmented control also scrolls its own chosen radio into view, so look for the card.
    const sections = () =>
      (scrolled.mock.contexts as HTMLElement[]).filter((node) => node.id?.startsWith('rules-'))
    expect(sections().at(-1)?.id).toBe('rules-score')
    await user.keyboard('{ArrowRight}')
    expect(within(jump).getByRole('radio', { name: 'Industries' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(sections().at(-1)?.id).toBe('rules-industries')
  })

  it('splits the score into parts that add up to 100, and shows the checks of the part pointed at', async () => {
    mockApi({ '/api/v1/lead-finder/rules': RULES })
    const { user } = renderWithProviders(<RulesView />)
    const bar = await screen.findByRole('tablist', { name: "The score's parts" })
    const tabs = within(bar).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['25', '20', '15', '15', '15', '10'])
    expect(tabs.map((t) => Number(t.textContent)).reduce((a, b) => a + b, 0)).toBe(100)
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent(
      'Business or property trigger: 25 points',
    )
    expect(screen.getByRole('tabpanel')).toHaveTextContent('15 main, 10 other, 4 weak')
    await user.hover(within(bar).getByRole('tab', { name: 'Decision-maker access: 15 points' }))
    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveTextContent('Decision-maker access: 15 points')
    expect(panel).toHaveTextContent("A contact already in HubSpot (can't be judged yet)")
    // Keyboard: focus the bar, move with the arrows
    tabs[3]?.focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Integrated strategic fit: 15 points')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('7 tier 1, 4 tier 2')
  })

  it('words: partChecks and list', () => {
    const checks = partChecks(RULES.criteria.score as never, 'timing')
    expect(checks.map((c) => c.id)).toEqual(['recency', 'years_at_address', 'no_recent_move'])
    expect(checks[0]?.points).toBe(
      '6 within 30 days, 4 within 90 days, 1 undated, 6 for a lease end in the best window',
    )
    expect(list(['a'])).toBe('a')
    expect(list(['a', 'b'])).toBe('a and b')
    expect(list(['a', 'b', 'c'])).toBe('a, b and c')
  })
})
