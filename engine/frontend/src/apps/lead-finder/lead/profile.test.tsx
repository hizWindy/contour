/**
 * The one-page profile (PLAN-V16 T3-7): everything in Levi's section 9 for a lead, and Print. That
 * it fits one A4 page is checked in a real browser, by printing it to PDF (Track 3 Log).
 */
import { screen, within } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { mockApi } from '@/test/mock-api'
import { renderWithProviders } from '@/test/render'
import { LeadCardView } from './lead-card-view'
import ProfilePage from './profile'
import { FULL_RECORD, LEAD_ID, makeLead } from './test-lead'

const FULL = makeLead({
  ...FULL_RECORD,
  facts: {
    ...makeLead().facts,
    decision_makers: [
      {
        name: 'Jane Citizen',
        role: 'Chief Operating Officer',
        source_url: 'https://www.example.com/team',
        source_date: '2026-09-01',
      },
    ],
  },
})

function renderProfile() {
  mockApi({ [`/api/v1/lead-finder/leads/${LEAD_ID}`]: FULL })
  return renderWithProviders(
    <Routes>
      <Route path="/leads/:leadId/profile" element={<ProfilePage />} />
      <Route path="/leads/:leadId" element={<p>The lead card</p>} />
    </Routes>,
    { route: `/leads/${LEAD_ID}/profile` },
  )
}

function part(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { level: 2, name: title })
  return heading.closest('section') as HTMLElement
}

describe('the one-page profile (PLAN-V16 T3-7)', () => {
  it("has every part of Levi's section 9", async () => {
    renderProfile()
    const profile = await screen.findByRole('article', { name: 'Profile of Acme Software' })
    expect(within(profile).getByRole('heading', { level: 1 })).toHaveTextContent('Acme Software')
    expect(profile).toHaveTextContent('Melbourne · Software')
    expect(profile).toHaveTextContent(/Tier A.*score 82.*Medium confidence/)
    expect(profile).toHaveTextContent(
      'What changed: Up from B to A: a lease end in 2028 was found.',
    )

    expect(part('Contour angle')).toHaveTextContent('Growth planning')
    expect(part('Local headcount')).toHaveTextContent('Now: 120 staff (confirmed)')
    expect(part('Local headcount')).toHaveTextContent('In 24 months: 180 staff (estimated)')
    expect(part('Space needed')).toHaveTextContent('Projected: about 1,800 m²')
    expect(part('Current office')).toHaveTextContent(
      'Level 12, Acme Tower, 120 Collins Street, Melbourne',
    )
    expect(part('Current office')).toHaveTextContent('At this address since at least 2017.')
    expect(part('Current office')).toHaveTextContent('Last fitout by Sample Interiors')
    expect(part('Who to contact')).toHaveTextContent('CEO, COO, Head of People')
    expect(part('Who to contact')).toHaveTextContent('Jane Citizen, Chief Operating Officer')
    expect(part('Signs')).toHaveTextContent("Acme's Collins Street lease ends in March 2028.")
    expect(part('Dampeners')).toHaveTextContent(
      'A fitout or move 3 to 5 years ago. Moderate: takes off 10 points.',
    )
    expect(part('Dampeners')).toHaveTextContent('A tie to a competitor: not found')
    expect(part('Dampeners')).toHaveTextContent('Procurement red flags: not checked')
    expect(part('Suggested opener')).toHaveTextContent('Is a new office on the cards?')
    expect(part('Why now')).toHaveTextContent("Acme's Melbourne lease ends in 2028")
  })

  it('prints with the browser, and keeps the way back off the paper', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    const { user } = renderProfile()
    await screen.findByRole('article', { name: 'Profile of Acme Software' })
    await user.click(screen.getByRole('button', { name: 'Print' }))
    expect(print).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: 'Back to the lead' }).parentElement).toHaveClass(
      'print:hidden',
    )
  })

  it('is offered on the card of a Tier A lead only', () => {
    mockApi({})
    const { unmount } = renderWithProviders(<LeadCardView lead={FULL} />)
    expect(screen.getByRole('link', { name: 'Print the profile' })).toHaveAttribute(
      'href',
      `/leads/${LEAD_ID}/profile`,
    )
    unmount()
    renderWithProviders(<LeadCardView lead={makeLead({ tier: 'B' })} />)
    expect(screen.queryByRole('link', { name: 'Print the profile' })).toBeNull()
  })
})
