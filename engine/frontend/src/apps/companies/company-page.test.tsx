/**
 * A company's own page (PLAN-V10 B5): on a phone "Prep a call" is a bar fixed at the bottom of the
 * screen, and the page keeps room for it, so what the keyboard lands on is never under it (WCAG
 * 2.2 2.4.11). Made-up names only.
 */
import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { CompanyDetail } from '@/api/types'
import { renderWithProviders } from '@/test/render'
import { asPhone } from '@/test/screen'
import CompanyPage from './company-page'

function detail(): CompanyDetail {
  return {
    key: '101',
    source: 'hubspot',
    name: 'Sample Logistics Pty Ltd',
    domain: 'samplelogistics.com.au',
    website: null,
    city: 'Perth',
    state: 'WA',
    industry: 'Logistics and Supply Chain',
    staff: 300,
    linkedin_staff: null,
    description: null,
    owner: 'Levi',
    lifecycle_stage: null,
    last_talk: '2026-10-01',
    last_talk_note: null,
    next_lease_end: '2027-06-30',
    deal: 'open',
    hubspot_url: null,
    offices: [],
    deals: [],
    notes: [],
    people: [],
    calls: [],
    people_status: 'ready',
    lead: null,
  }
}

/** The company answers; anything else isn't there (call notes off, as before they were merged). */
function mockServer(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request) => {
      const path = new URL(request.url).pathname
      if (path === '/api/v1/companies/101') return Promise.resolve(Response.json(detail()))
      return Promise.resolve(
        Response.json(
          { title: 'Not found', detail: 'Not here.', status: 404, code: 'not_found' },
          { status: 404 },
        ),
      )
    }),
  )
}

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/companies/:key" element={<CompanyPage />} />
    </Routes>,
    { route: '/companies/101' },
  )
}

describe("a company's own page", () => {
  it('on a phone keeps what the keyboard lands on above "Prep a call" at the bottom', async () => {
    asPhone()
    mockServer()
    renderPage()
    const prep = await screen.findByRole('button', { name: 'Prep a call' })
    expect(prep.closest('[data-slot=prep-bar]')).toHaveClass('fixed', 'bottom-0')
    expect(document.documentElement.style.scrollPaddingBottom).toBe('7rem')
  })

  it('on a laptop has no bar at the bottom, so the page keeps no room for one', async () => {
    mockServer()
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Sample Logistics Pty Ltd' })
    expect(document.querySelector('[data-slot=prep-bar]')).toBeNull()
    expect(document.documentElement.style.scrollPaddingBottom).toBe('')
  })
})
