import { screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { LeadDetail } from '@/api/types'
import { renderWithProviders } from '@/test/render'
import LeadPage from './index'
import { fact, HOSTILE, LEAD_ID, makeLead } from './test-lead'

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

describe('the lead page', () => {
  it('shows the result, the rules, the facts with sources and the notes', async () => {
    mockApi(makeLead())
    const { user } = renderLead()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Acme Software' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Score 51 of 77 checked')).toBeInTheDocument()
    const rules = screen.getByRole('list', { name: 'Each rule' })
    await user.click(within(rules).getByRole('button', { name: /City/ }))
    expect(await screen.findByText('Melbourne is a city we work in')).toBeInTheDocument()

    const facts = screen.getByRole('table', { name: /Facts about Acme Software/ })
    expect(within(facts).getByText('2,500 m²')).toBeInTheDocument()
    const website = within(facts).getByRole('link', { name: /acme\.com\.au/ })
    expect(website.getAttribute('href')).toMatch(/^https:\/\/acme\.com\.au\/?$/)
    expect(within(facts).getAllByText('Confirmed').length).toBeGreaterThan(0)
    expect(await screen.findByText('This lead has no profile yet.')).toBeInTheDocument()
    expect(screen.getByText(/A summary of each page/)).toBeInTheDocument()
  })

  it('shows the stage, the band and the score in parts, with what is not known yet', async () => {
    mockApi(makeLead())
    const { user } = renderLead()

    expect(await screen.findByText('Score 51 of 77 checked')).toBeInTheDocument()
    expect(screen.getByText('Active prospect')).toBeInTheDocument()
    expect(screen.getByText('Investigate')).toBeInTheDocument()
    expect(screen.getByText(/The tool could check 77 of the 100 points/)).toBeInTheDocument()

    const parts = screen.getByRole('list', { name: 'Each part of the score' })
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
    renderLead()
    expect(await screen.findByText('A dropped company is not scored.')).toBeInTheDocument()
    expect(screen.getByText('Not a target')).toBeInTheDocument()
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
    const { container } = renderLead()

    expect(await screen.findByText('Talking points')).toBeInTheDocument()
    expect(screen.getByText('Lease ends March 2028')).toBeInTheDocument()
    expect(screen.getByText(TAG)).toBeInTheDocument() // as text, never as a tag
    expect(container.querySelector('b')).toBeNull()
    expect(screen.getByText('Past fitout firms: Hassell, Geyer')).toBeInTheDocument()
    expect(screen.getByText(/Staff in Melbourne: 60 on LinkedIn, from HubSpot/)).toBeInTheDocument()
    const facts = screen.getByRole('table', { name: /Facts about Acme Software/ })
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
      }),
    )
    const { container } = renderLead()

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
    expect(within(row).queryByRole('link')).toBeNull() // its page address isn't known yet
  })

  it('shows no heading for a source that filled in nothing', async () => {
    mockApi(makeLead())
    renderLead()

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
    const jane = screen.getByText('Jane Citizen, Chief Financial Officer').closest('li')
    expect(jane).not.toBeNull()
    const person = within(jane as HTMLElement)
    expect(person.getByText('2026-09-01')).toBeInTheDocument()
    expect(person.getByRole('link')).toHaveAttribute('href', 'https://acme.com.au/leadership')
    expect(screen.getByText(`${TAG}, Head of Property`)).toBeInTheDocument() // as text
    expect(container.querySelector('b')).toBeNull()
    expect(container.querySelector('a[href^="javascript"]')).toBeNull()
    expect(screen.getByText(/check before you call/)).toBeInTheDocument()
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
    renderLead()
    expect(await screen.findByText(/usually within 18 months of the project/)).toBeInTheDocument()
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
    const { container } = renderLead()
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
      expect(seen.patches).toEqual([{ status: 'watching' }, { status: 'new', reject_reason: null }])
    })
  })

  it('asks why before it rejects, and sends the reason', async () => {
    const seen = mockApi(makeLead())
    const { user } = renderLead()
    await user.click(await screen.findByRole('button', { name: 'Reject' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reject Acme Software' })

    await user.click(within(dialog).getByRole('button', { name: 'Reject' }))
    expect(within(dialog).getByText('Say why it is rejected.')).toBeInTheDocument()
    expect(seen.patches).toEqual([])

    await user.type(within(dialog).getByLabelText('Reason'), 'Too small for us')
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }))
    await waitFor(() => {
      expect(seen.patches).toEqual([{ status: 'rejected', reject_reason: 'Too small for us' }])
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

  it('shows Send to HubSpot as coming later', async () => {
    mockApi(makeLead())
    renderLead()
    expect(await screen.findByRole('button', { name: 'Send to HubSpot' })).toBeDisabled()
    expect(screen.getByText('Sending to HubSpot comes in Phase 5.')).toBeInTheDocument()
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
    renderLead()
    expect(
      await screen.findByText('Might be the same company. A person confirms.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/close name, 92% alike, has an open deal/)).toBeInTheDocument()
  })
})
