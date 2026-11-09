import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { LeadDetail } from '@/api/types'
import { renderWithProviders } from '@/test/render'
import LeadPage from './index'
import { makeWrite } from '@/components/hubspot/test-write'
import { fact, HOSTILE, LEAD_ID, makeLead } from './test-lead'

type Wrapped = (request: Request) => Promise<Response | undefined> | Response | undefined

/** Answers some paths first and passes the rest to the fetch mock already in place. */
function wrapFetch(inner: typeof fetch, first: Wrapped): typeof fetch {
  return (async (request: Request) => (await first(request)) ?? inner(request)) as typeof fetch
}

interface Seen {
  patches: Record<string, unknown>[]
  rechecks: number
}

function mockApi(start: LeadDetail): Seen {
  const seen: Seen = { patches: [], rechecks: 0 }
  let current = start
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname
      if (path === `/api/v1/lead-finder/leads/${LEAD_ID}` && request.method === 'PATCH') {
        const patch = (await request.json()) as Record<string, unknown>
        seen.patches.push(patch)
        current = { ...current, ...patch }
        return Response.json(current)
      }
      if (path === `/api/v1/lead-finder/leads/${LEAD_ID}`) {
        return Response.json(current)
      }
      if (path === `/api/v1/lead-finder/leads/${LEAD_ID}/similar`) {
        return Response.json({
          basis: 'none',
          note: 'This lead has no profile yet.',
          deals: [],
          leads: [],
        })
      }
      if (path === '/api/v1/lead-finder/rules') {
        return Response.json({
          version: 'r1',
          criteria: { triggers: { consultant_window_months: 18 } },
          watchlist: { tbc: [] },
        })
      }
      if (path === `/api/v1/lead-finder/leads/${LEAD_ID}/recheck`) {
        seen.rechecks += 1
        return Response.json({ id: 'new-run', status: 'queued' }, { status: 201 })
      }
      return Response.json({ title: 'Not found', status: 404 }, { status: 404 })
    }),
  )
  return seen
}

function renderLead() {
  return renderWithProviders(
    <Routes>
      <Route path="/leads/:leadId" element={<LeadPage />} />
      <Route path="/runs/:runId" element={<p>The new run</p>} />
    </Routes>,
    { route: `/leads/${LEAD_ID}` },
  )
}

const TAG = '<b onmouseover=alert(1)>hover</b>'

/** Opens one tab of the card and returns its panel. */
async function openTab(user: UserEvent, name: string): Promise<HTMLElement> {
  await user.click(await screen.findByRole('tab', { name }))
  return screen.getByRole('tabpanel', { name })
}

describe('the lead page', () => {
  it('shows the result, the rules, the facts with sources and the notes, a tab each', async () => {
    mockApi(makeLead())
    const { user } = renderLead()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Acme Software' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Score 51 of 77 checked')).toBeInTheDocument()

    const score = await openTab(user, 'Score and rules')
    const rules = within(score).getByRole('list', { name: 'Each rule' })
    await user.click(within(rules).getByRole('button', { name: /City/ }))
    expect(await within(score).findByText('Melbourne is a city we work in')).toBeInTheDocument()

    const factsTab = await openTab(user, 'Facts')
    const facts = within(factsTab).getByRole('table', { name: /Facts about Acme Software/ })
    expect(within(facts).getByText('2,500 m²')).toBeInTheDocument()
    const website = within(facts).getByRole('link', { name: /acme\.com\.au/ })
    expect(website.getAttribute('href')).toMatch(/^https:\/\/acme\.com\.au\/?$/)
    expect(within(facts).getAllByText('Confirmed').length).toBeGreaterThan(0)

    const hubspot = await openTab(user, 'HubSpot and look-alikes')
    expect(await within(hubspot).findByText('This lead has no profile yet.')).toBeInTheDocument()
    const research = await openTab(user, 'Research')
    expect(within(research).getByText(/A summary of each page/)).toBeInTheDocument()
  })

  it('opens on a quick view: the score bar, the best sign, staff, office, HubSpot and who to call', async () => {
    const base = makeLead()
    mockApi(
      makeLead({
        hubspot: { ...base.hubspot, status: 'in_hubspot', owner: 'Sample Owner' },
        facts: {
          ...base.facts,
          decision_makers: [
            {
              name: 'Jane Citizen',
              role: 'Chief Operating Officer',
              source_url: 'https://acme.com.au/about',
              source_date: null,
            },
          ],
        },
        fact_sources: [
          { fact: 'staff_in_city', used: 'signalhire', others: [], conflict: null },
          { fact: 'decision_makers', used: 'claude', others: [], conflict: null },
        ],
      }),
    )
    renderLead()

    const quick = await screen.findByRole('region', { name: 'Quick view' })
    const meter = within(quick).getByRole('meter', { name: 'Score' })
    expect(meter).toHaveAttribute('aria-valuenow', '51')
    expect(meter).toHaveAttribute('aria-valuemax', '77')
    expect(meter).toHaveAttribute('aria-valuetext', '51 of 77 points checked')
    expect(within(quick).getByText('Investigate')).toBeInTheDocument()
    expect(within(quick).getByText('Active prospect')).toBeInTheDocument()
    expect(within(quick).getByText('Typed')).toBeInTheDocument()
    expect(within(quick).getByText(/^City: Melbourne\. Size/)).toBeInTheDocument()
    expect(
      within(quick).getByText("Acme's Collins Street lease ends in March 2028."),
    ).toBeInTheDocument()
    expect(within(quick).getByText('2028-03')).toBeInTheDocument()
    expect(within(quick).getByText('250 staff')).toBeInTheDocument()
    expect(within(quick).getByText('from Signal Hire')).toBeInTheDocument()
    expect(within(quick).getByText('2,500 m²')).toBeInTheDocument()
    expect(within(quick).getByText('Owner: Sample Owner')).toBeInTheDocument()
    expect(within(quick).getByText('Jane Citizen, Chief Operating Officer')).toBeInTheDocument()
    expect(within(quick).getByText('Role to ask for: Head of Property')).toBeInTheDocument()
    for (const action of ['Watch', 'Reject', 'Send to HubSpot', 'Re-check']) {
      expect(within(quick).getByRole('button', { name: action })).toBeInTheDocument()
    }
    // The details wait in the tabs: the facts table is not on the first screen.
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('table', { name: /Facts about/ })).toBeNull()
  })

  it('moves between the tabs with the arrow keys', async () => {
    mockApi(makeLead())
    const { user } = renderLead()

    const overview = await screen.findByRole('tab', { name: 'Overview' })
    expect(
      within(screen.getByRole('tablist', { name: 'Lead details' }))
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual([
      'Overview',
      'Facts',
      'Signs',
      'Score and rules',
      'HubSpot and look-alikes',
      'Research',
    ])
    overview.focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Facts' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Facts' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('table', { name: /Facts about Acme Software/ })).toBeInTheDocument()
    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Research' })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Home}')
    expect(overview).toHaveAttribute('aria-selected', 'true')
  })

  it('shows the first three of a long list, then all of them', async () => {
    const notes = Array.from({ length: 5 }, (_, index) => ({
      claim: `Note number ${String(index + 1)}`,
      url: `https://www.afr.com/property/note-${String(index + 1)}`,
      published: '2026-10-01',
      angle: 'property',
      from_memory: false,
    }))
    mockApi(makeLead({ notes }))
    const { user } = renderLead()

    const research = await openTab(user, 'Research')
    const list = within(research).getByRole('list', { name: 'What each source said' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    const more = within(research).getByRole('button', { name: 'Show all 5' })
    expect(more).toHaveAttribute('aria-expanded', 'false')

    await user.click(more)
    expect(within(list).getAllByRole('listitem')).toHaveLength(5)
    expect(within(list).getByText('Note number 5')).toBeInTheDocument()
    await user.click(within(research).getByRole('button', { name: 'Show fewer' }))
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
  })

  it('marks where the company came from, apart from its HubSpot label', async () => {
    mockApi(makeLead({ origin: 'hubspot' }))
    renderLead()

    const mark = await screen.findByText('From HubSpot')
    expect(mark).toHaveAttribute('data-origin', 'hubspot')
    expect(mark.querySelector('svg')).not.toBeNull()
  })

  it('shows the stage, the band and the score in parts, with what is not known yet', async () => {
    mockApi(makeLead())
    const { user } = renderLead()

    expect(await screen.findByText('Score 51 of 77 checked')).toBeInTheDocument()
    expect(screen.getByText('Active prospect')).toBeInTheDocument()
    expect(screen.getByText('Investigate')).toBeInTheDocument()
    const score = await openTab(user, 'Score and rules')
    expect(within(score).getByText(/The tool could check 77 of the 100 points/)).toBeInTheDocument()

    const parts = within(score).getByRole('list', { name: 'Each part of the score' })
    expect(within(parts).getByText('20 of 25 checked')).toBeInTheDocument()
    await user.click(within(parts).getByRole('button', { name: /Decision-maker access/ }))
    expect(await within(parts).findByText('A contact already in HubSpot')).toBeInTheDocument()
    expect(within(parts).getByText('Not known yet')).toBeInTheDocument()
    expect(within(parts).getByText('The part is worth 15 points.')).toBeInTheDocument()
  })

  it('says when a lead was scored under version 1, and that a drop is not scored', async () => {
    mockApi(makeLead({ score: 78, score_parts: [], score_checked: null, band: null, stage: null }))
    const first = renderLead()
    expect(await screen.findByText('Score 78')).toBeInTheDocument()
    expect(screen.queryByRole('meter')).toBeNull() // no bar without the points checked
    await openTab(first.user, 'Score and rules')
    expect(screen.getByText(/scored under version 1 of the rules/)).toBeInTheDocument()
    first.unmount()

    mockApi(
      makeLead({
        result: 'drop',
        score: 0,
        score_parts: [],
        score_checked: null,
        band: null,
        stage: 'Not a target',
      }),
    )
    const second = renderLead()
    expect(await screen.findByText('Not a target')).toBeInTheDocument()
    await openTab(second.user, 'Score and rules')
    expect(screen.getByText('A dropped company is not scored.')).toBeInTheDocument()
  })

  it('shows the talking points, the past fitout firms and the numbers from HubSpot', async () => {
    const base = makeLead()
    mockApi(
      makeLead({
        from_hubspot: [
          'Staff in Melbourne: 60 on LinkedIn, from HubSpot. The real number is about double.',
        ],
        facts: {
          ...base.facts,
          talking_points: ['Lease ends March 2028', TAG],
          fitout_contractors: ['Hassell', 'Geyer'],
          office_matters: fact(true),
          office_since: fact('2016'),
          last_fitout: fact('2024-05'),
          growth_plan: fact(true),
          size_needed_m2: fact(1500),
          growth_by: fact('2027-06'),
        },
      }),
    )
    const { container, user } = renderLead()

    // The Overview tab is open first. Its Summary starts with the office line (PLAN-V11 B5).
    expect(await screen.findByText('Talking points')).toBeInTheDocument()
    expect(
      screen.getByText(/^At this address since 2016 \(\d+ years\)\. Last fitout May 2024\.$/),
    ).toBeInTheDocument()
    expect(screen.getByText('Lease ends March 2028')).toBeInTheDocument()
    expect(screen.getByText(TAG)).toBeInTheDocument() // as text, never as a tag
    expect(container.querySelector('b')).toBeNull()
    expect(screen.getByText('Past fitout firms: Hassell, Geyer')).toBeInTheDocument()
    const factsTab = await openTab(user, 'Facts')
    expect(
      within(factsTab).getByText(/Staff in Melbourne: 60 on LinkedIn, from HubSpot/),
    ).toBeInTheDocument()
    const facts = within(factsTab).getByRole('table', { name: /Facts about Acme Software/ })
    expect(within(facts).getByText('2016')).toBeInTheDocument()
    expect(within(facts).getByText('2024-05')).toBeInTheDocument()
    expect(within(facts).getByText('Will need about 1,500 m² by 2027-06')).toBeInTheDocument()
  })

  it('shows the staff number Signal Hire filled in, with its note as text and no link', async () => {
    const base = makeLead()
    const note = 'Staff in Melbourne: about 210, from Signal Hire (105 people on file x 2, TBC).'
    mockApi(
      makeLead({
        from_signalhire: [note, HOSTILE],
        facts: {
          ...base.facts,
          staff_in_city: { value: 210, label: 'estimated', source_url: null, source_date: null },
        },
        fact_sources: [{ fact: 'staff_in_city', used: 'signalhire', others: [], conflict: null }],
      }),
    )
    const { container, user } = renderLead()

    await openTab(user, 'Facts')
    const heading = await screen.findByText('From Signal Hire')
    const notes = within(heading.parentElement as HTMLElement)
    expect(notes.getByText(note)).toBeInTheDocument()
    expect(notes.getByText(HOSTILE)).toBeInTheDocument() // as text, never as a tag
    expect(container.querySelector('img')).toBeNull()
    expect(screen.queryByText('From HubSpot')).toBeNull() // each source has its own heading
    const facts = screen.getByRole('table', { name: /Facts about Acme Software/ })
    const row = within(facts).getByRole('row', { name: /Staff in the city/ })
    expect(within(row).getByText('210 staff')).toBeInTheDocument()
    expect(within(row).getByText('Estimated')).toBeInTheDocument()
    expect(within(row).getByText('Signal Hire')).toBeInTheDocument() // where it came from
    expect(within(row).queryByRole('link')).toBeNull() // its page address isn't known yet
  })

  it('says plainly when the facts are missing because the answer form failed', async () => {
    mockApi(makeLead({ form_failed: true }))
    renderLead()

    // The loading shape is a status too, so wait for the card first.
    await screen.findByRole('region', { name: 'Quick view' })
    const note = screen.getByRole('status')
    expect(note).toHaveTextContent('Facts missing.')
    expect(note).toHaveTextContent('Re-check this lead.')
  })

  it('shows no missing-facts note when the form was filled', async () => {
    mockApi(makeLead())
    renderLead()

    expect(await screen.findByRole('region', { name: 'Quick view' })).toBeVisible()
    expect(screen.queryByText('Facts missing.')).toBeNull()
  })

  it('lists the senior people from Signal Hire under who to talk to, as text', async () => {
    mockApi(
      makeLead({
        signalhire_people: [
          { name: 'Pat Example', title: 'Chief Financial Officer', signalhire_id: 'sh-1' },
          { name: HOSTILE, title: null, signalhire_id: 'sh-2' },
        ],
      }),
    )
    const { container } = renderLead()

    const list = await screen.findByRole('list', { name: 'Senior people from Signal Hire' })
    expect(within(list).getByText('Pat Example, Chief Financial Officer')).toBeInTheDocument()
    expect(within(list).getByText(HOSTILE)).toBeInTheDocument() // as text, never as a tag
    expect(container.querySelector('img')).toBeNull()
  })

  it('says where each fact came from, and what the other sources said', async () => {
    const base = makeLead()
    mockApi(
      makeLead({
        facts: {
          ...base.facts,
          staff_in_city: { value: 570, label: 'estimated', source_url: null, source_date: null },
          office_since: {
            value: '2016-03-01',
            label: 'estimated',
            source_url: 'https://app.hubspot.com/contacts/1/company/102',
            source_date: null,
          },
        },
        fact_sources: [
          {
            fact: 'staff_in_city',
            used: 'signalhire',
            others: [
              { source: 'claude', value: '250', url: 'https://www.afr.com/property/acme-moves' },
            ],
            conflict: null,
          },
          { fact: 'office_since', used: 'hubspot', others: [], conflict: null },
        ],
      }),
    )
    const { user } = renderLead()

    await openTab(user, 'Facts')
    const facts = await screen.findByRole('table', { name: /Facts about Acme Software/ })
    const staff = within(facts).getByRole('row', { name: /Staff in the city/ })
    expect(within(staff).getByText('Signal Hire')).toBeInTheDocument()
    expect(within(staff).getByText('Claude says 250')).toBeInTheDocument()
    const page = within(staff).getByRole('link', { name: /afr\.com/ }) // the other source's page
    expect(page.getAttribute('href')).toBe('https://www.afr.com/property/acme-moves')
    const since = within(facts).getByRole('row', { name: /At this address since/ })
    expect(within(since).getByText('HubSpot')).toBeInTheDocument()
    // A fact with no entry came from Claude's web research, and shows the page it read.
    const city = within(facts).getByRole('row', { name: /^City/ })
    expect(within(city).getByText('Claude')).toBeInTheDocument()
    expect(within(city).getByRole('link', { name: /afr\.com/ })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Sources that disagree' })).toBeNull()
  })

  it('flags sources that disagree, as text, above the facts', async () => {
    const flag =
      'The staff numbers are more than 2 times apart: Signal Hire about 570, Claude about 250. Check which is right.'
    mockApi(
      makeLead({
        fact_sources: [
          {
            fact: 'staff_in_city',
            used: 'signalhire',
            others: [{ source: 'claude', value: '250', url: null }],
            conflict: flag,
          },
          {
            fact: 'website',
            used: 'claude',
            others: [{ source: 'signalhire', value: HOSTILE, url: null }],
            conflict: `The websites differ: ${HOSTILE}`,
          },
        ],
      }),
    )
    const { container, user } = renderLead()

    await openTab(user, 'Facts')
    const flags = await screen.findByRole('list', { name: 'Sources that disagree' })
    expect(within(flags).getByText(flag)).toBeInTheDocument()
    expect(within(flags).getByText(`The websites differ: ${HOSTILE}`)).toBeInTheDocument()
    expect(within(flags).getAllByText('Check.')).toHaveLength(2)
    expect(container.querySelector('img')).toBeNull() // as text, never as a tag
  })

  it("shows Signal Hire's record of the company as text, with the head office marked", async () => {
    mockApi(
      makeLead({
        signalhire_company: {
          signalhire_id: 7,
          slug: 'acme-software',
          name: HOSTILE,
          website: 'acme.com.au',
          industry: 'Software Development',
          linkedin_url: 'https://www.linkedin.com/company/55555',
          staff_count: 420,
          staffing_company: true,
          offices: [
            { city: 'Melbourne', area: 'Victoria', country: 'Australia', head_office: true },
            { city: 'Sydney', area: null, country: null, head_office: false },
          ],
          fetched_at: '2026-11-02T09:00:00Z',
        },
      }),
    )
    const { container, user } = renderLead()

    await openTab(user, 'Facts')
    const title = await screen.findByText("Signal Hire's record")
    const record = within(title.closest('[data-slot="card"]') as HTMLElement)
    expect(record.getByText(HOSTILE)).toBeInTheDocument() // as text, never as a tag
    expect(record.getByText('Software Development')).toBeInTheDocument()
    expect(record.getByRole('link', { name: /Company page/ }).getAttribute('href')).toBe(
      'https://www.linkedin.com/company/55555',
    )
    expect(record.getByText(/About 420/)).toBeInTheDocument()
    expect(record.getByText(/not the one in this city/)).toBeInTheDocument()
    expect(record.getByText('Melbourne, Victoria, Australia (head office)')).toBeInTheDocument()
    expect(record.getByText('Sydney')).toBeInTheDocument()
    expect(record.getByText(/staffing company/)).toBeInTheDocument()
    expect(record.getByText(/Read from Signal Hire on 2 Nov 2026/)).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  it('shows no Signal Hire record when it knows nothing of the company', async () => {
    mockApi(makeLead())
    const { user } = renderLead()

    await openTab(user, 'Facts')
    expect(await screen.findByRole('table', { name: /Facts about Acme Software/ })).toBeVisible()
    expect(screen.queryByText("Signal Hire's record")).toBeNull()
  })

  it('never makes a link of an address that is not a plain web address', async () => {
    mockApi(
      makeLead({
        signalhire_company: {
          signalhire_id: 7,
          slug: 'acme-software',
          name: 'Acme Software',
          website: null,
          industry: null,
          linkedin_url: 'javascript:alert(1)',
          staff_count: null,
          staffing_company: null,
          offices: [],
          fetched_at: '2026-11-02T09:00:00Z',
        },
      }),
    )
    const { user } = renderLead()

    await openTab(user, 'Facts')
    const title = await screen.findByText("Signal Hire's record")
    const record = within(title.closest('[data-slot="card"]') as HTMLElement)
    expect(record.queryByRole('link')).toBeNull()
    expect(record.getByText('Company page')).toBeInTheDocument() // shown as text
  })

  it('puts the people from the first source in the rules first', async () => {
    const base = makeLead()
    const people = {
      signalhire_people: [{ name: 'Pat Example', title: 'CFO', signalhire_id: 'sh-1' }],
      facts: {
        ...base.facts,
        decision_makers: [
          {
            name: 'Jane Citizen',
            role: 'Chief Operating Officer',
            source_url: 'https://acme.com.au/about',
            source_date: null,
          },
        ],
      },
    }
    const order = async (used: 'signalhire' | 'claude') => {
      mockApi(
        makeLead({
          ...people,
          fact_sources: [{ fact: 'decision_makers', used, others: [], conflict: null }],
        }),
      )
      const view = renderLead()
      const title = await screen.findByText('Who to talk to')
      const text = (title.closest('[data-slot="card"]') as HTMLElement).textContent ?? ''
      view.unmount()
      return text.indexOf('From Signal Hire') < text.indexOf('Decision makers')
    }

    expect(await order('signalhire')).toBe(true)
    expect(await order('claude')).toBe(false)
  })

  it('shows no heading for a source that filled in nothing', async () => {
    mockApi(makeLead())
    const { user } = renderLead()

    await openTab(user, 'Facts')
    expect(await screen.findByRole('table', { name: /Facts about Acme Software/ })).toBeVisible()
    expect(screen.queryByText('From Signal Hire')).toBeNull()
    expect(screen.queryByText('From HubSpot')).toBeNull()
  })

  it('names the decision makers a public page gives, each with its page, as text', async () => {
    const base = makeLead()
    mockApi(
      makeLead({
        facts: {
          ...base.facts,
          decision_makers: [
            {
              name: 'Jane Citizen',
              role: 'Chief Financial Officer',
              source_url: 'https://acme.com.au/leadership',
              source_date: '2026-09-01',
            },
            {
              name: TAG,
              role: 'Head of Property',
              source_url: 'javascript:alert(1)',
              source_date: null,
            },
          ],
        },
      }),
    )
    const { container } = renderLead()

    expect(await screen.findByText('Decision makers')).toBeInTheDocument()
    const overview = screen.getByRole('tabpanel', { name: 'Overview' })
    const jane = within(overview).getByText('Jane Citizen, Chief Financial Officer').closest('li')
    expect(jane).not.toBeNull()
    const person = within(jane as HTMLElement)
    expect(person.getByText('2026-09-01')).toBeInTheDocument()
    expect(person.getByRole('link')).toHaveAttribute('href', 'https://acme.com.au/leadership')
    expect(within(overview).getByText(`${TAG}, Head of Property`)).toBeInTheDocument() // as text
    expect(container.querySelector('b')).toBeNull()
    expect(container.querySelector('a[href^="javascript"]')).toBeNull()
    expect(within(overview).getByText(/check before you call/)).toBeInTheDocument()
  })

  it('says so when no public page names a decision maker', async () => {
    mockApi(makeLead())
    renderLead()
    expect(
      await screen.findByText('No decision makers named on a public page.'),
    ).toBeInTheDocument()
  })

  it('says when to talk: before a consultant is appointed', async () => {
    mockApi(makeLead())
    const { user } = renderLead()
    const signs = await openTab(user, 'Signs')
    expect(
      within(signs).getByText("Acme's Collins Street lease ends in March 2028."),
    ).toBeInTheDocument()
    expect(within(signs).getByText('26 points')).toBeInTheDocument()
    expect(
      await within(signs).findByText(/usually within 18 months of the project/),
    ).toBeInTheDocument()
  })

  it('has a back button above the title', async () => {
    mockApi(makeLead())
    renderLead()
    const title = await screen.findByRole('heading', { level: 1, name: 'Acme Software' })
    // Opened directly, so there is no page to go back to: it links to the list and says so.
    const back = screen.getByRole('link', { name: 'Back to Results' })
    expect(back.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows a hostile note as text and never links to javascript', async () => {
    mockApi(makeLead())
    const { container, user } = renderLead()
    await openTab(user, 'Research')
    expect(await screen.findByText(HOSTILE)).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    for (const link of container.querySelectorAll('a')) {
      expect(link.getAttribute('href') ?? '').not.toMatch(/^javascript:/i)
    }
    for (const link of container.querySelectorAll('a[target="_blank"]')) {
      expect(link.getAttribute('rel')).toBe('noopener noreferrer nofollow')
    }
  })

  it('watches a lead, then undoes it with the exact values from before', async () => {
    const seen = mockApi(makeLead())
    const { user } = renderLead()
    await user.click(await screen.findByRole('button', { name: 'Watch' }))

    expect(await screen.findByRole('button', { name: 'Stop watching' })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Undo' }))

    await waitFor(() => {
      expect(seen.patches).toEqual([
        { status: 'watching' },
        { status: 'new', reject_reason: null, reject_note: null },
      ])
    })
  })

  it('asks why before it rejects, and sends the reason', async () => {
    const seen = mockApi(makeLead())
    const { user } = renderLead()
    await user.click(await screen.findByRole('button', { name: 'Reject' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reject Acme Software' })

    await user.click(within(dialog).getByRole('button', { name: 'Reject' }))
    expect(within(dialog).getByText('Pick a reason.')).toBeInTheDocument()
    expect(seen.patches).toEqual([])

    // "Other" needs a note (PLAN-V9 D1).
    await user.click(within(dialog).getByRole('radio', { name: 'Other' }))
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }))
    expect(within(dialog).getByText('Say what the other reason is.')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('radio', { name: 'Too small' }))
    await user.type(within(dialog).getByLabelText('A note (optional)'), 'About 20 staff')
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }))
    await waitFor(() => {
      expect(seen.patches).toEqual([
        { status: 'rejected', reject_reason: 'too_small', reject_note: 'About 20 staff' },
      ])
    })
  })

  it('marks a lead useful, and a second click clears it', async () => {
    const seen = mockApi(makeLead())
    const { user } = renderLead()
    await user.click(await screen.findByRole('button', { name: 'Useful' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Useful' })).toHaveAttribute('aria-pressed', 'true')
    })
    await user.click(screen.getByRole('button', { name: 'Useful' }))
    await waitFor(() => {
      expect(seen.patches).toEqual([{ useful: true }, { useful: null }])
    })
  })

  it('confirms the cost before a re-check, then opens the new run', async () => {
    const seen = mockApi(makeLead())
    const { user } = renderLead()
    await user.click(await screen.findByRole('button', { name: 'Re-check' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(confirm).toHaveTextContent('It costs money')
    expect(seen.rechecks).toBe(0)

    await user.click(within(confirm).getByRole('button', { name: 'Research again' }))

    expect(await screen.findByText('The new run')).toBeInTheDocument()
    expect(seen.rechecks).toBe(1)
  })

  it('previews Send to HubSpot, and waits for write access before it writes', async () => {
    const previews: string[] = []
    mockApi(makeLead())
    vi.stubGlobal(
      'fetch',
      wrapFetch(globalThis.fetch, (request) => {
        const path = new URL(request.url).pathname
        if (path === `/api/v1/lead-finder/leads/${LEAD_ID}/hubspot/preview`) {
          previews.push(request.method)
          return Response.json(makeWrite())
        }
        return undefined
      }),
    )
    const { user } = renderLead()
    await user.click(await screen.findByRole('button', { name: 'Send to HubSpot' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(
      await within(dialog).findByText(/This makes a new company in HubSpot/),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('status')).toHaveTextContent('Waiting for write access.')
    expect(within(dialog).getByRole('button', { name: 'Send to HubSpot' })).toBeDisabled()
    expect(previews).toEqual(['POST'])
  })

  it('sends once after a confirm, then shows the lead as sent', async () => {
    const sends: unknown[] = []
    mockApi(makeLead())
    vi.stubGlobal(
      'fetch',
      wrapFetch(globalThis.fetch, async (request) => {
        const path = new URL(request.url).pathname
        if (path.endsWith('/hubspot/preview')) {
          return Response.json(makeWrite({ can_write: true, waiting_for: null }))
        }
        if (path.endsWith('/hubspot/send')) {
          sends.push(await request.json())
          return Response.json(
            makeWrite({
              status: 'done',
              can_write: true,
              waiting_for: null,
              hubspot_url: 'https://app.hubspot.com/contacts/1/record/0-2/7',
              steps: [{ step: 'company', status: 'done', detail: null, hubspot_id: '7' }],
            }),
          )
        }
        return undefined
      }),
    )
    const { user } = renderLead()
    await user.click(await screen.findByRole('button', { name: 'Send to HubSpot' }))
    const dialog = await screen.findByRole('alertdialog')
    const send = await within(dialog).findByRole('button', { name: 'Send to HubSpot' })
    await waitFor(() => {
      expect(send).toBeEnabled()
    })
    await user.click(send)
    expect(
      await screen.findByRole('heading', { name: 'Acme Software is in HubSpot' }),
    ).toBeInTheDocument()
    expect(sends).toEqual([{ write_id: makeWrite().id }])
  })

  it('lists possible HubSpot matches for a person to confirm', async () => {
    mockApi(
      makeLead({
        hubspot: {
          status: 'possible_match',
          hubspot_id: null,
          name: null,
          owner: null,
          matched_by: 'close_name',
          open_deals: [],
          last_dissolved: null,
          candidates: [
            {
              hubspot_id: '501',
              name: 'Acme Group',
              owner: null,
              reason: 'close_name',
              score: 0.92,
              open_deals: ['Acme fitout'],
              last_dissolved: null,
            },
          ],
        },
      }),
    )
    const { user } = renderLead()
    await openTab(user, 'HubSpot and look-alikes')
    expect(
      await screen.findByText('Might be the same company. A person confirms.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/close name, 92% alike, has an open deal/)).toBeInTheDocument()
  })
})
