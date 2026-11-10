import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LeadDetail } from '@/api/types'
import { renderWithProviders } from '@/test/render'
import { fact, HOSTILE, makeLead, WHY_NOW } from '../test-lead'
import { OverviewTab } from './tab-overview'
import { whyNotWritten } from './words'

function renderOverview(lead: LeadDetail) {
  return renderWithProviders(<OverviewTab lead={lead} />)
}

function whyNowSection(): HTMLElement {
  const title = screen.getByText('Why now', { selector: '[data-slot="card-title"]' })
  const card = title.closest('[data-slot="card"]')
  expect(card).not.toBeNull()
  return card as HTMLElement
}

describe('Why now on the lead card (PLAN-V12 D1)', () => {
  it('comes first on the Overview, above the Summary', () => {
    renderOverview(makeLead({ why_now: WHY_NOW }))
    const titles = [...document.querySelectorAll('[data-slot="card-title"]')].map(
      (title) => title.textContent,
    )
    expect(titles.slice(0, 2)).toEqual(['Why now', 'Summary'])
  })

  it('shows the reason, the next step, the lines, the questions and how sure it is', () => {
    renderOverview(makeLead({ why_now: WHY_NOW }))
    const why = within(whyNowSection())
    expect(why.getByText('Medium confidence')).toBeInTheDocument()
    expect(why.getByText(WHY_NOW.reason)).toBeInTheDocument()
    expect(why.getByText(/^It will likely ask fitout firms/)).toBeInTheDocument()
    expect(why.getByText(WHY_NOW.when.text)).toBeInTheDocument()
    // an estimate says so, and shows its working
    expect(why.getByText(WHY_NOW.size.text)).toBeInTheDocument()
    expect(why.getByText('No office size found; No decision maker named.')).toBeInTheDocument()
    expect(why.getByText('“Who is leading the search for the next office?”')).toBeInTheDocument()
    expect(why.getByText(/Written 10 Nov 2026 by claude-opus-5-5, US\$0\.04\./)).toBeInTheDocument()
    expect(why.queryByText(/Thin lead/)).toBeNull()
  })

  it('keeps every text as text and links only to web pages', () => {
    const { container } = renderOverview(makeLead({ why_now: WHY_NOW }))
    const why = within(whyNowSection())
    expect(why.getByText(`“${HOSTILE}”`)).toBeInTheDocument() // as text, never as a tag
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('a[href^="javascript"]')).toBeNull()
    const links = why.getAllByRole('link')
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(link).toHaveAttribute('href', 'https://www.afr.com/property/acme-moves')
    }
  })

  it('says a low one is a thin lead, to check before calling', () => {
    renderOverview(makeLead({ why_now: { ...WHY_NOW, confidence: 'low' } }))
    const why = within(whyNowSection())
    expect(why.getByText('Low confidence')).toBeInTheDocument()
    expect(why.getByText('Thin lead:')).toBeInTheDocument()
    expect(why.getByText(/check the sources before you call/)).toBeInTheDocument()
  })

  it('lists what the check removed, and says when it removed the reason', () => {
    const dropped = 'Reason: removed "It moved in 2014.": 2014 isn\'t in the facts'
    renderOverview(makeLead({ why_now: { ...WHY_NOW, reason: '', dropped: [dropped] } }))
    const why = within(whyNowSection())
    expect(why.getByText(/The check removed Claude's reason/)).toBeInTheDocument()
    expect(why.getByText('Removed by the check:')).toBeInTheDocument()
    expect(why.getByText(dropped)).toBeInTheDocument()
  })

  it('replaces the office line, so the office is not shown twice', () => {
    const facts = { ...makeLead().facts, office_since: fact('2016') }
    renderOverview(makeLead({ facts, why_now: WHY_NOW }))
    expect(screen.queryByText('Office:')).toBeNull()
  })

  it('says why a lead has none, and keeps the office line then', () => {
    const facts = { ...makeLead().facts, office_since: fact('2016') }
    renderOverview(makeLead({ facts, why_now: null, why_now_skipped: 'switched_off' }))
    const why = within(whyNowSection())
    expect(
      why.getByText('Not written for this lead: Why now was switched off when it was researched.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Office:')).toBeInTheDocument()
    expect(screen.getByText(/^At this address since 2016/)).toBeInTheDocument()
  })

  it('has words for every reason, and for an older lead', () => {
    const reasons = ['switched_off', 'drop', 'no_facts', 'budget', 'failed'] as const
    for (const reason of reasons) {
      expect(whyNotWritten(makeLead({ why_now_skipped: reason }))).not.toBe('')
    }
    expect(whyNotWritten(makeLead({ why_now_skipped: 'drop' }))).toBe('it is a Drop.')
    expect(whyNotWritten(makeLead())).toBe('it was researched before Why now existed.')
  })
})
