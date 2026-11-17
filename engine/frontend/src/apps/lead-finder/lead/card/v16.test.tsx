/**
 * The lead card's PLAN-V16 parts (T3-4): the tier headline, the property record, size,
 * dampeners, the Contour angle and roles, the five filters, and an excluded lead's Override.
 */
import { screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { LeadDetail, Tier } from '@/api/types'
import { mockApi } from '@/test/mock-api'
import { renderWithProviders } from '@/test/render'
import LeadPage from '../index'
import { EXCLUDED, FULL_RECORD, LEAD_ID, makeLead } from '../test-lead'
import { TierHeadline } from './headline'
import { OverviewTab } from './tab-overview'
import { ScoreTab } from './tab-score'
import { SignsTab } from './tab-signs'

const FULL = makeLead(FULL_RECORD)

function section(title: string): HTMLElement {
  const heading = screen.getByText(title, { selector: '[data-slot="card-title"]' })
  const card = heading.closest('[data-slot="card"]')
  if (!card) throw new Error(`no section ${title}`)
  return card as HTMLElement
}

function renderPage(lead: LeadDetail) {
  return renderWithProviders(
    <Routes>
      <Route path="/leads/:leadId" element={<LeadPage />} />
    </Routes>,
    { route: `/leads/${lead.id}` },
  )
}

describe('the tier headline (PLAN-V16 T3-4)', () => {
  it('reads "A · 82 · Medium", then what changed and what the dampeners took off', () => {
    renderWithProviders(<TierHeadline lead={FULL} />)
    const headline = document.querySelector('[data-slot="tier-headline"]') as HTMLElement
    expect(headline).toHaveTextContent(/Tier A.*score 82.*Medium confidence/)
    // On screen it is the short form, with the dots.
    expect(within(headline).getByText('A')).toBeVisible()
    expect(within(headline).getByText('Pursue now')).toBeInTheDocument()
    expect(
      within(headline).getByText('Up from B to A: a lease end in 2028 was found.'),
    ).toBeInTheDocument()
    expect(within(headline).getByText(/What changed: Up\./)).toHaveClass('sr-only')
    expect(
      within(headline).getByText(/Dampeners took off 10 points \(92 before\)\./),
    ).toBeInTheDocument()
    expect(screen.queryByText('Verify before outreach.')).toBeNull()
  })

  it.each([
    ['A', 'Pursue now'],
    ['B', 'Nurture'],
    ['C', 'Watch'],
    ['discard', 'Do not list'],
  ] as [Tier, string][])('shows Tier %s and what it asks for: %s', (tier, action) => {
    renderWithProviders(<TierHeadline lead={makeLead({ tier })} />)
    const headline = document.querySelector('[data-slot="tier-headline"]') as HTMLElement
    expect(headline).toHaveTextContent(new RegExp(`Tier ${tier === 'discard' ? 'Discard' : tier}`))
    expect(within(headline).getByText(action)).toBeInTheDocument()
  })

  it('says "no tier yet" for a lead saved before tiers, instead of breaking', () => {
    const old = makeLead({ tier: undefined as unknown as Tier })
    renderWithProviders(<TierHeadline lead={old} />)
    expect(screen.getByText('Score 51, no tier yet')).toBeInTheDocument()
  })

  it('flags a Tier A lead with low confidence: verify before outreach', () => {
    renderWithProviders(<TierHeadline lead={makeLead({ tier: 'A', confidence: 'low' })} />)
    expect(screen.getByRole('status')).toHaveTextContent('Verify before outreach.')
  })
})

describe('the property record, size and dampeners (PLAN-V16 T3-4)', () => {
  it('a full record: the current office, the records newest first, and a line for each tool', () => {
    renderWithProviders(<OverviewTab lead={FULL} />)
    const property = section('Property record')
    const current = within(property).getByLabelText('Current office')
    expect(
      within(current).getByText('Level 12, Acme Tower, 120 Collins Street, Melbourne'),
    ).toBeInTheDocument()
    expect(current).toHaveTextContent('1,400 m² confirmed')
    expect(within(current).getByText('At this address since at least 2017.')).toBeInTheDocument()
    expect(current).toHaveTextContent('30 June 2028 confirmed')
    expect(within(current).getByText('Sample Interiors')).toBeInTheDocument()
    expect(within(property).getByText('From Property Daily.')).toBeInTheDocument()

    const records = within(property).getByRole('list', { name: 'Property records' })
    const items = within(records).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent(
      /Sample Interiors finished a fitout.*Fitout.*Property Daily.*1 Mar 2022/,
    )
    expect(items[1]).toHaveTextContent(/Leased 1,400 m².*Lease.*Property Daily.*1 July 2018/)
    // A link that isn't a web address is never a link.
    expect(within(items[0]).queryByRole('link')).toBeNull()
    expect(within(items[1]).getByRole('link')).toHaveAttribute(
      'href',
      'https://www.propertydaily.com.au/news/acme-lease',
    )
    const tools = within(property).getByRole('list', { name: 'What each tool found' })
    expect(
      within(tools)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Property Daily: 2 records', 'Arealytics: switched off'])
  })

  it('a full record: size now and projected, each confirmed or estimated', () => {
    renderWithProviders(<OverviewTab lead={FULL} />)
    const size = within(section('Size')).getByLabelText('Size')
    expect(size).toHaveTextContent('Local staff now120 staff confirmed')
    expect(size).toHaveTextContent('In 24 months180 staff estimated')
    expect(size).toHaveTextContent('Space nowabout 1,200 m² estimated')
    expect(size).toHaveTextContent('Space neededabout 1,800 m² estimated')
  })

  it('a full record: each dampener found with its evidence, and "Not found" for the others', () => {
    renderWithProviders(<OverviewTab lead={FULL} />)
    const dampeners = section('Dampeners')
    const found = within(dampeners).getByRole('list', { name: 'Dampeners found' })
    expect(found).toHaveTextContent('A fitout or move 3 to 5 years ago')
    expect(found).toHaveTextContent('Moderate: takes off 10 points')
    expect(found).toHaveTextContent('Sample Interiors finished a fitout of level 12 in March 2022.')
    expect(found).toHaveTextContent('Could change: Hiring would outgrow the space by 2027.')
    const notFound = within(dampeners).getByRole('list', { name: 'Dampeners not found' })
    expect(
      within(notFound)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'A fitout or move in the last 3 years',
      'A real estate outsourcing deal',
      'A tie to a competitor',
    ])
    expect(within(dampeners).getByText('Not checked: Procurement red flags.')).toBeInTheDocument()
  })

  it('a full record: the Contour angle, the suggested opener and the likely roles', () => {
    renderWithProviders(<OverviewTab lead={FULL} />)
    const summary = section('Summary')
    expect(summary).toHaveTextContent(
      'Contour angle: Growth planning: a bigger team needs more room by 2028.',
    )
    expect(within(summary).getByText('Suggested opener')).toBeInTheDocument()
    // The property record has the office, so the Summary doesn't say it again.
    expect(within(summary).queryByText('Office:')).toBeNull()
    expect(section('Who to talk to')).toHaveTextContent('Likely roles: CEO, COO, Head of People')
  })

  it('an empty record: says what is not known, never "none"', () => {
    renderWithProviders(<OverviewTab lead={makeLead()} />)
    const property = section('Property record')
    expect(within(property).getByText("The current office isn't known yet.")).toBeInTheDocument()
    const tools = within(property).getByRole('list', { name: 'What each tool found' })
    expect(
      within(tools)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Property Daily: not checked yet', 'Arealytics: not checked yet'])
    expect(section('Size')).toHaveTextContent("Local staff and space aren't known yet.")
    expect(section('Dampeners')).toHaveTextContent('Not checked for this lead yet.')
    for (const title of ['Property record', 'Size', 'Dampeners']) {
      expect(section(title).textContent).not.toMatch(/\bnone\b/i)
    }
  })

  it('says what a tool found when it was asked and had nothing, or could not be read', () => {
    renderWithProviders(
      <OverviewTab
        lead={makeLead({
          property: {
            records: [],
            checked: { property_daily: 'not_found', arealytics: 'error' },
            looked_up_at: '2026-11-14T22:00:00Z',
          },
        })}
      />,
    )
    const tools = within(section('Property record')).getByRole('list', {
      name: 'What each tool found',
    })
    expect(
      within(tools)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Property Daily: not found', "Arealytics: couldn't be read this time"])
  })
})

describe('the five filters and the dampeners in the score (PLAN-V16 T3-4)', () => {
  it('lists each filter met, not met or estimated, with its basis', () => {
    renderWithProviders(<ScoreTab lead={FULL} />)
    const filters = screen.getByRole('list', { name: 'Each filter' })
    const items = within(filters).getAllByRole('listitem')
    expect(items).toHaveLength(5)
    expect(items[1]).toHaveTextContent('Office size Estimated')
    expect(items[1]).toHaveTextContent('About 2,500 m², estimated from 250 staff.')
    expect(
      screen.getByText('92 before the dampeners; they took off 10 points, so the score is 82.'),
    ).toBeInTheDocument()
  })
})

describe('an excluded lead (PLAN-V16 T3-4)', () => {
  const excluded = makeLead(EXCLUDED)
  const judged = makeLead({
    tier: 'B',
    score: 61,
    score_before_dampeners: 61,
    result: 'pass',
    excluded: {
      ...(EXCLUDED.excluded as NonNullable<LeadDetail['excluded']>),
      overridden_by: 'Al-khair',
      overridden_at: '2026-11-15T01:00:00Z',
    },
  })

  function answers(onOverride: () => Response) {
    let current = excluded
    return mockApi({
      [`/api/v1/lead-finder/leads/${LEAD_ID}`]: () => Response.json(current),
      [`/api/v1/lead-finder/leads/${LEAD_ID}/override-exclusion`]: () => {
        const response = onOverride()
        if (response.ok) current = judged
        return response
      },
      [`/api/v1/lead-finder/leads/${LEAD_ID}/similar`]: {
        basis: 'none',
        note: 'This lead has no profile yet.',
        deals: [],
        leads: [],
      },
    })
  }

  it('shows its reason first, with the evidence and its page, and no tier headline', async () => {
    answers(() => Response.json(judged))
    renderPage(excluded)
    const quick = await screen.findByRole('region', { name: 'Quick view' })
    const notice = quick.querySelector('[data-slot="exclusion"]') as HTMLElement
    expect(quick.firstElementChild).toBe(notice)
    expect(notice).toHaveTextContent('Left out: A law firm')
    expect(notice).toHaveTextContent('Acme Software is a law firm, despite its name.')
    expect(within(notice).getByRole('link')).toHaveAttribute(
      'href',
      'https://www.example.com/acme-legal',
    )
    expect(quick.querySelector('[data-slot="tier-headline"]')).toBeNull()
  })

  it('asks once before Override, then judges it again and says the new tier', async () => {
    const calls = answers(() => Response.json(judged))
    const { user } = renderPage(excluded)
    await user.click(await screen.findByRole('button', { name: 'Override' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Override the exclusion?' })
    expect(dialog).toHaveTextContent(
      'The rules judge Acme Software again without the exclusion (A law firm). It is free',
    )

    await user.click(within(dialog).getByRole('button', { name: 'Override and judge again' }))

    expect(
      await screen.findByText('Acme Software judged again: Tier B, score 61.'),
    ).toBeInTheDocument()
    expect(
      calls.filter((call) => call.method === 'POST' && call.path.endsWith('/override-exclusion')),
    ).toHaveLength(1)
    expect(
      await screen.findByText(
        /Exclusion overridden by Al-khair on 15 Nov 2026\. It was: A law firm\./,
      ),
    ).toBeInTheDocument()
    expect(document.querySelector('[data-slot="tier-headline"]')).toHaveTextContent(/Tier B/)
  })

  it('changes nothing when the person cancels', async () => {
    const calls = answers(() => Response.json(judged))
    const { user } = renderPage(excluded)
    await user.click(await screen.findByRole('button', { name: 'Override' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })
    expect(calls.some((call) => call.path.endsWith('/override-exclusion'))).toBe(false)
  })
})

describe('a sign the search found (PLAN-V21 T1-8)', () => {
  it('says "From the search, not checked by the research" beside that sign only', () => {
    const sign = (id: string, whatHappened: string, fromSearch: boolean) => ({
      trigger: {
        id,
        what_happened: whatHappened,
        date: '2026-10',
        source_url: `https://example.com/${id}`,
        label: fromSearch ? ('estimated' as const) : ('confirmed' as const),
      },
      group: 'main' as const,
      source_kind: 'other_news',
      points: fromSearch ? 10 : 26,
      group_points: 15,
      source_points: 5,
      timing_points: 6,
      from_search: fromSearch,
    })
    const lead = makeLead({
      triggers: [
        sign('lease_ending', "Sample Software's lease ends in 2028.", false),
        sign('fast_growth', 'Sample Software doubled its staff this year.', true),
      ],
    })
    renderWithProviders(<SignsTab lead={lead} />)
    const marks = document.querySelectorAll('[data-slot="from-search"]')
    expect(marks).toHaveLength(1)
    expect(marks[0]).toHaveTextContent('From the search, not checked by the research')
    const found = screen.getByText('Sample Software doubled its staff this year.').parentElement
    expect(found).not.toBeNull()
    expect(
      within(found as HTMLElement).getByText('From the search, not checked by the research'),
    ).toBeInTheDocument()
  })
})
