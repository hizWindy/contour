/**
 * The prep card's header answers (PLAN-V14 T2-3 and T2-5) and the script header with "Research
 * again" (T2-4), drawn on their own with test data. The whole card, with its requests, is tried in
 * companies.test.tsx.
 */
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CompanyDetail, PrepFacts, PrepScript, PrepSource } from '@/api/types'
import { renderWithProviders } from '@/test/render'
import { BeforeYouDial, type BeforeYouDialProps } from './before-you-dial'
import { SourcesContext } from './guide-sources'

const TODAY = '2026-11-11'

const SOURCES: PrepSource[] = [
  {
    id: 'W1',
    kind: 'web',
    label: 'ABC Logistics wins contract',
    url: 'https://www.afr.com/abc',
    date: '2026-10-20',
  },
]

function company(changes: Partial<CompanyDetail> = {}): CompanyDetail {
  return {
    key: '101',
    source: 'hubspot',
    name: 'ABC Logistics',
    domain: null,
    website: null,
    city: 'Perth',
    state: 'WA',
    industry: null,
    staff: 300,
    linkedin_staff: null,
    description: null,
    owner: 'Levi',
    lifecycle_stage: null,
    last_talk: '2026-10-01',
    last_talk_note: null,
    next_lease_end: null,
    deal: 'none',
    hubspot_url: null,
    offices: [],
    deals: [],
    notes: [],
    people: [],
    calls: [],
    people_status: 'ready',
    lead: null,
    ...changes,
  }
}

function facts(changes: Partial<PrepFacts> = {}): PrepFacts {
  return {
    company_key: '101',
    company_name: 'ABC Logistics',
    city: 'Perth',
    industry: null,
    staff: 300,
    owner: 'Levi',
    deal: 'none',
    next_lease_end: null,
    last_talk: '2026-10-01',
    hubspot_url: null,
    person: { id: '201', name: 'Jason Reeds', title: 'Head of Operations' },
    phone: null,
    last_call: null,
    facts: [],
    people: [],
    people_status: 'ready',
    prep_enabled: true,
    names_ok: true,
    ...changes,
  }
}

function script(changes: Partial<PrepScript> = {}): PrepScript {
  return {
    still_there: 'yes',
    still_there_note: { text: 'Jason is still Head of Operations.', sources: ['W1'] },
    news: [{ text: 'ABC Logistics won a A$40M contract.', sources: ['W1'] }],
    opener: [],
    why_now: [],
    questions: [],
    if_they_say: [],
    goal: null,
    dropped: 0,
    ...changes,
  }
}

function renderAnswers(changes: Partial<BeforeYouDialProps> = {}) {
  const props: BeforeYouDialProps = {
    company: company(),
    facts: facts(),
    script: script(),
    checking: false,
    person: { id: '201', name: 'Jason Reeds' },
    today: TODAY,
    ...changes,
  }
  return renderWithProviders(
    <SourcesContext.Provider value={new Map(SOURCES.map((source) => [source.id, source]))}>
      <BeforeYouDial {...props} />
    </SourcesContext.Provider>,
  )
}

describe('the answers in the card header', () => {
  it('shows Still there?, Last talk and News in one list, and no Connections yet', () => {
    renderAnswers()
    const list = screen.getByRole('list', { name: 'Before you dial' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent(/^Still there\?Still there/)
    expect(items[1]).toHaveTextContent(/^Last talk1 Oct 2026/)
    expect(items[2]).toHaveTextContent(/^NewsABC Logistics won a A\$40M contract\./)
    expect(screen.queryByText('Connections')).not.toBeInTheDocument()
    // The sources show as marks in the row, and the screen reader hears them in the popover.
    expect(within(items[0]).getByText('W1')).toBeInTheDocument()
    expect(within(items[2]).getByText('W1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^News/ })).not.toHaveAccessibleName(/W1/)
  })

  it('shows Connections once it is asked for', () => {
    renderAnswers({ connections: true })
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getByText('Waiting for the customer list.')).toBeInTheDocument()
  })

  it('opens an answer in full, with its source, by keyboard, and Esc closes it', async () => {
    const { user } = renderAnswers()
    await user.tab()
    const still = screen.getByRole('button', { name: /^Still there\?/ })
    expect(still).toHaveFocus()
    await user.keyboard('{Enter}')
    const full = await screen.findByRole('dialog')
    expect(within(full).getByText('Jason is still Head of Operations.')).toBeInTheDocument()
    expect(
      within(full).getByRole('link', { name: /Source: ABC Logistics wins contract/ }),
    ).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(still).toHaveFocus()
  })

  it('says a person has left in Terracotta, with an icon and words', () => {
    renderAnswers({ script: script({ still_there: 'no' }) })
    const still = screen.getByRole('button', { name: /^Still there\?/ })
    expect(still).toHaveTextContent('Has left')
    expect(still.className).toContain('border-destructive')
  })

  it('says in one short line what is missing while call prep is off', () => {
    renderAnswers({ script: null, facts: facts({ prep_enabled: false }) })
    const still = screen.getByRole('button', { name: /^Still there\?/ })
    expect(still).toHaveTextContent('Not checked')
    expect(still).toHaveTextContent('Call prep is off.')
    const news = screen.getByRole('button', { name: /^News/ })
    expect(news).toHaveTextContent('Not checked')
    expect(news).toHaveTextContent('Call prep is off.')
  })

  it('says names are off in a short line, and in full in the popover', async () => {
    const { user } = renderAnswers({ script: null, facts: facts({ names_ok: false }) })
    const still = screen.getByRole('button', { name: /^Still there\?/ })
    expect(still).toHaveTextContent("Names don't go to Claude yet.")
    await user.click(still)
    expect(
      await screen.findByText("Names don't go to Claude yet, so there is no web check."),
    ).toBeInTheDocument()
  })

  it('shows still grey lines while call prep checks the web, and nothing to press', () => {
    renderAnswers({ script: null, checking: true })
    expect(screen.queryByRole('button', { name: /^Still there\?/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^News/ })).not.toBeInTheDocument()
    expect(screen.getAllByText('Call prep is checking.')).toHaveLength(2)
    expect(screen.getByRole('button', { name: /^Last talk/ })).toBeInTheDocument()
  })

  it('asks for the switchboard on a cold call', () => {
    renderAnswers({ person: null })
    expect(screen.getByRole('button', { name: /^Who/ })).toHaveTextContent('Nobody named')
  })
})
