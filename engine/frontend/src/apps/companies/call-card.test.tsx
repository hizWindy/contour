/**
 * The prep card's header answers (PLAN-V14 T2-3 and T2-5) and the script header with "Research
 * again" (T2-4), drawn on their own with test data. The whole card, with its requests, is tried in
 * companies.test.tsx.
 */
import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CompanyDetail, PrepFacts, PrepOut, PrepScript, PrepSource } from '@/api/types'
import { renderWithProviders } from '@/test/render'
import { BeforeYouDial, type BeforeYouDialProps } from './before-you-dial'
import { SourcesContext } from './guide-sources'
import { ScriptHeader, type ScriptHeaderProps } from './script-header'

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
    prep_cap_usd: '0.25',
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

const MORE_SOURCES: PrepSource[] = [
  ...SOURCES,
  {
    id: 'W2',
    kind: 'web',
    label: 'New chief executive',
    url: 'https://example.com/ceo',
    date: '2026-03-02',
  },
  { id: 'W3', kind: 'web', label: 'An undated page', url: null, date: null },
]

function renderNews(changes: Partial<BeforeYouDialProps> = {}) {
  return renderWithProviders(
    <SourcesContext.Provider value={new Map(MORE_SOURCES.map((source) => [source.id, source]))}>
      <BeforeYouDial
        company={company()}
        facts={facts()}
        script={script()}
        checking={false}
        person={{ id: '201', name: 'Jason Reeds' }}
        today={TODAY}
        {...changes}
      />
    </SourcesContext.Provider>,
  )
}

describe('the News answer', () => {
  it('shows the newest item with its date and age, however old', () => {
    renderNews({
      script: script({
        news: [{ text: 'A contract won in June.', sources: ['W1'], date: '2026-06-14' }],
      }),
    })
    const news = screen.getByRole('button', { name: /^News/ })
    expect(news).toHaveTextContent('A contract won in June.')
    expect(news).toHaveTextContent('14 June 2026, 4 months ago')
    expect(news).not.toHaveTextContent('more')
  })

  it('says "No date" for an item whose pages have none', () => {
    renderNews({
      script: script({ news: [{ text: 'An old item.', sources: ['W3'], date: null }] }),
    })
    expect(screen.getByRole('button', { name: /^News/ })).toHaveTextContent('No date')
  })

  it('puts the others behind "+2 more", with each date and source in the popover', async () => {
    const { user } = renderNews({
      script: script({
        news: [
          { text: 'A new clinic opened.', sources: ['W1'], date: '2026-10-20' },
          { text: 'A new chief executive.', sources: ['W2'], date: '2026-03-02' },
          { text: 'An undated item.', sources: ['W3'], date: null },
        ],
      }),
    })
    const news = screen.getByRole('button', { name: /^News/ })
    expect(news).toHaveTextContent('20 Oct 2026, 3 weeks ago · +2 more')
    await user.click(news)
    const popover = await screen.findByRole('dialog', { name: 'News' })
    const items = within(popover).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent(
      /^A new clinic opened\..*20 Oct 2026, 3 weeks ago · ABC Logistics wins contract$/,
    )
    expect(items[1]).toHaveTextContent('2 Mar 2026, 8 months ago · New chief executive')
    expect(items[2]).toHaveTextContent('No date · An undated page')
    expect(
      within(popover).getByRole('link', { name: /Source: New chief executive/ }),
    ).toHaveAttribute('href', 'https://example.com/ceo')
  })

  it("falls back to the Lead Finder's newest saved note when the web found nothing", () => {
    renderNews({
      script: script({ news: [] }),
      company: company({
        notes: [
          {
            text: 'Plans a second Perth office.',
            date: '2026-10-03',
            found_by: 'lead_finder',
            url: null,
          },
        ],
      }),
    })
    const news = screen.getByRole('button', { name: /^News/ })
    expect(news).toHaveTextContent('Plans a second Perth office.')
    expect(news).toHaveTextContent('Saved research, 3 Oct 2026')
  })

  it('says "No news found" when there is no note either, and never names 90 days', () => {
    renderNews({ script: script({ news: [] }) })
    const news = screen.getByRole('button', { name: /^News/ })
    expect(news).toHaveTextContent('No news found')
    expect(news).toHaveTextContent('Nothing on the web or in saved research.')
    expect(document.body).not.toHaveTextContent(/90 days/)
  })
})

function made(changes: Partial<PrepOut> = {}): PrepOut {
  return {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    company_key: '101',
    company_name: 'ABC Logistics',
    person: { id: '201', name: 'Jason Reeds', title: 'Head of Operations' },
    kind: 'person',
    trigger: 'person',
    status: 'ready',
    stage: 3,
    error: null,
    script: script(),
    sources: SOURCES,
    web_checked: true,
    reused: true,
    made_by: 'Tom',
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    finished_at: null,
    ...changes,
  }
}

function renderHeader(changes: Partial<ScriptHeaderProps> = {}) {
  const onResearch = vi.fn()
  const props: ScriptHeaderProps = {
    madeFrom: 'claude',
    prep: made(),
    enabled: true,
    namesOk: true,
    capUsd: '0.25',
    running: false,
    stage: 0,
    failed: false,
    onResearch,
    ...changes,
  }
  return { ...renderWithProviders(<ScriptHeader {...props} />), onResearch }
}

describe('"Research again" in the script header', () => {
  it('says what it does and what it costs, and a press asks for a new prep at once', async () => {
    const { user, onResearch } = renderHeader({
      prep: made({ style_used: { mine: false, team_notes: 3 } }),
    })
    expect(screen.getByRole('heading', { name: 'Sales script' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Made 2 days ago by Tom. Written with the team style.',
    )
    const again = screen.getByRole('button', { name: 'Research again' })
    expect(again).toHaveAccessibleDescription(
      'New news, a new "still there?" check and a new script. Costs up to US$0.25.',
    )
    again.focus()
    await user.keyboard('{Enter}')
    expect(onResearch).toHaveBeenCalledTimes(1)
  })

  it('names your style and the team style when both were used', () => {
    renderHeader({ prep: made({ style_used: { mine: true, team_notes: 2 } }) })
    expect(screen.getByRole('status')).toHaveTextContent('Written with the team style and yours.')
  })

  it('says when call prep searched ahead, and a date after a week', () => {
    const { unmount } = renderHeader({
      prep: made({ trigger: 'search_ahead', made_by: null, created_at: '2026-11-10T20:30:00Z' }),
    })
    expect(screen.getByRole('status')).toHaveTextContent(/^Searched ahead at .+\.$/)
    unmount()
    renderHeader({ prep: made({ created_at: '2026-10-03T01:00:00Z', made_by: 'Mia' }) })
    expect(screen.getByRole('status')).toHaveTextContent(/^Made on .+2026 by Mia\.$/)
  })

  it('is greyed out while call prep is off, and says an admin can switch it on', () => {
    renderHeader({ madeFrom: 'hubspot', prep: undefined, enabled: false })
    expect(screen.getByRole('status')).toHaveTextContent('Written from our HubSpot copy.')
    const again = screen.getByRole('button', { name: 'Research again' })
    expect(again).toBeDisabled()
    expect(again).toHaveAccessibleDescription('Call prep is off. An admin can switch it on.')
  })

  it('waits, greyed out, until the facts say whether call prep is on', () => {
    renderHeader({ madeFrom: 'hubspot', prep: undefined, enabled: null, capUsd: null })
    expect(screen.getByRole('button', { name: 'Research again' })).toBeDisabled()
  })

  it('says there is no web check while names stay off', () => {
    renderHeader({ namesOk: false })
    expect(screen.getByRole('button', { name: 'Research again' })).toHaveAccessibleDescription(
      "Names don't go to Claude yet, so there is no web check. Costs up to US$0.25.",
    )
  })

  it('shows "Researching..." with the 3-step bar while it runs', () => {
    renderHeader({ madeFrom: 'hubspot', prep: undefined, running: true, stage: 1 })
    expect(screen.getByRole('button', { name: 'Researching...' })).toBeDisabled()
    expect(screen.getByRole('progressbar', { name: 'Call prep: Web check' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Written from our HubSpot copy until the new one is ready.',
    )
  })

  it('says "Try again" after a failure', () => {
    renderHeader({ madeFrom: 'hubspot', prep: undefined, failed: true })
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  })

  it('is full width under the title on a phone', () => {
    renderHeader()
    expect(screen.getByRole('button', { name: 'Research again' }).className).toContain(
      'max-sm:w-full',
    )
  })
})
