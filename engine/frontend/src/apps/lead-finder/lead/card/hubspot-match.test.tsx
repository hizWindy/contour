/**
 * PLAN-V27 T1-3 on the lead card: the quiet label, and the maybe's "Same company" and "It's new"
 * buttons. The backend is a fetch mock that answers the way `POST /hubspot-match` does: the lead
 * judged again, with who settled it. Made-up names only (Northwind, Jo Sample).
 */
import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { LeadDetail } from '@/api/types'
import { renderWithProviders } from '@/test/render'
import { asLaptop, asPhone } from '@/test/screen'
import LeadPage from '../index'
import { LEAD_ID, makeLead } from '../test-lead'

type Candidate = LeadDetail['hubspot']['candidates'][number]

function candidate(changes: Partial<Candidate> = {}): Candidate {
  return {
    hubspot_id: '501',
    name: 'Northwind Group',
    owner: null,
    reason: 'close_name',
    score: 0.92,
    open_deals: [],
    last_dissolved: null,
    ...changes,
  }
}

/** A maybe: two HubSpot companies it might be. */
function maybe(): LeadDetail {
  const base = makeLead({ company: 'Northwind' })
  return {
    ...base,
    hubspot: {
      ...base.hubspot,
      status: 'possible_match',
      matched_by: 'close_name',
      candidates: [
        candidate(),
        candidate({ hubspot_id: '502', name: 'Northwind Logistics', score: 0.81 }),
      ],
    },
  }
}

/** The lead as the route returns it once settled. */
function settled(changes: Partial<LeadDetail['hubspot']>): LeadDetail {
  const base = maybe()
  return {
    ...base,
    hubspot: {
      ...base.hubspot,
      matched_by: null,
      candidates: [],
      confirmed_by: 'Jo Sample',
      ...changes,
    },
  }
}

interface Backend {
  picks: unknown[]
  reads: number
}

interface MockOptions {
  /** What the route answers: the settled lead, or a refusal. */
  answer?: (pick: { pick: string; hubspot_id?: string }) => Response
  /** Who is signed in. Left out, sign-in is off and every button shows. */
  me?: unknown
}

function mockApi(start: LeadDetail, options: MockOptions = {}): Backend {
  const backend: Backend = { picks: [], reads: 0 }
  let current = start
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname
      if (path === '/api/v1/auth/me' && options.me) {
        return Response.json(options.me)
      }
      if (path === `/api/v1/lead-finder/leads/${LEAD_ID}/hubspot-match`) {
        const pick = (await request.json()) as { pick: string; hubspot_id?: string }
        backend.picks.push(pick)
        const answer = options.answer?.(pick)
        if (answer) {
          return answer
        }
        current =
          pick.pick === 'new'
            ? settled({ status: 'new' })
            : settled({
                status: 'in_hubspot',
                hubspot_id: pick.hubspot_id ?? null,
                name: 'Northwind Group',
                matched_by: 'hubspot_id',
              })
        return Response.json(current)
      }
      if (path === `/api/v1/lead-finder/leads/${LEAD_ID}`) {
        backend.reads += 1
        return Response.json(current)
      }
      if (path === `/api/v1/lead-finder/leads/${LEAD_ID}/similar`) {
        return Response.json({ basis: 'none', note: null, deals: [], leads: [] })
      }
      return Response.json({ title: 'Not found', status: 404 }, { status: 404 })
    }),
  )
  return backend
}

function renderLead() {
  return renderWithProviders(
    <Routes>
      <Route path="/leads/:leadId" element={<LeadPage />} />
    </Routes>,
    { route: `/leads/${LEAD_ID}` },
  )
}

async function openHubSpotTab(user: UserEvent): Promise<HTMLElement> {
  const name = 'HubSpot and look-alikes'
  await user.click(await screen.findByRole('tab', { name }))
  return screen.getByRole('tabpanel', { name })
}

/** The HubSpot section of the tab (its first card). */
function hubspotSection(panel: HTMLElement): HTMLElement {
  const title = within(panel).getByText('HubSpot', { selector: '[data-slot="card-title"]' })
  const card = title.closest<HTMLElement>('[data-slot="card"]')
  if (!card) throw new Error('no HubSpot card')
  return card
}

describe('the quiet label (PLAN-V27 choice 3)', () => {
  it('says since when a quiet company was last worked, on the quick view and the HubSpot tab', async () => {
    const base = makeLead({ company: 'Northwind' })
    mockApi({
      ...base,
      hubspot: {
        ...base.hubspot,
        status: 'quiet',
        hubspot_id: '501',
        name: 'Northwind Group',
        matched_by: 'domain',
        last_activity: '2025-03-14',
      },
    })
    const { user } = renderLead()
    const quick = await screen.findByText('In HubSpot, quiet since March 2025')
    expect(quick.closest('[data-hubspot-status]')).toHaveAttribute('data-hubspot-status', 'quiet')

    const panel = await openHubSpotTab(user)
    expect(within(panel).getByText('In HubSpot, quiet since March 2025')).toBeInTheDocument()
  })

  it('says "never worked" when HubSpot has no activity for it', async () => {
    const base = makeLead({ company: 'Northwind' })
    mockApi({
      ...base,
      hubspot: { ...base.hubspot, status: 'quiet', name: 'Northwind Group', last_activity: null },
    })
    const { user } = renderLead()
    expect(await screen.findByText('In HubSpot, never worked')).toBeInTheDocument()
    const panel = await openHubSpotTab(user)
    expect(within(panel).getByText('In HubSpot, never worked')).toBeInTheDocument()
  })
})

describe.each([
  ['1440', asLaptop],
  ['390', asPhone],
])('settling a maybe at %s px (PLAN-V27 choice 4)', (_width, screenSize) => {
  it('"Same company" links the lead, says who settled it and that Results keeps it under In HubSpot', async () => {
    screenSize()
    const backend = mockApi(maybe())
    const { user } = renderLead()
    const panel = await openHubSpotTab(user)
    const section = hubspotSection(panel)
    expect(
      within(section).getByText('Might be the same company. A person confirms.'),
    ).toBeInTheDocument()
    expect(within(section).getAllByRole('button', { name: /^Same company as / })).toHaveLength(2)

    await user.click(
      within(section).getByRole('button', { name: 'Same company as Northwind Logistics' }),
    )
    expect(backend.picks).toEqual([{ pick: 'same', hubspot_id: '502' }])

    // The card shows the lead the route returned.
    expect(await within(section).findByText('Settled by Jo Sample.')).toBeInTheDocument()
    expect(within(section).getByText('In HubSpot')).toBeInTheDocument()
    expect(within(section).queryByRole('button', { name: /Same company/ })).toBeNull()
    expect(within(section).queryByRole('button', { name: "It's new" })).toBeNull()
    // The toast host is shared between tests, so an earlier test's toast may still be there.
    expect(
      await screen.findAllByText(
        'Northwind is linked to Northwind Group. Results now keeps it under "In HubSpot".',
      ),
    ).not.toHaveLength(0)
  })

  it('"It\'s new" keeps it a new lead, from the keyboard alone', async () => {
    screenSize()
    const backend = mockApi(maybe())
    const { user } = renderLead()
    const panel = await openHubSpotTab(user)
    const section = hubspotSection(panel)

    const itsNew = within(section).getByRole('button', { name: "It's new" })
    itsNew.focus()
    await user.keyboard('{Enter}')
    expect(backend.picks).toEqual([{ pick: 'new' }])

    expect(await within(section).findByText('Settled by Jo Sample.')).toBeInTheDocument()
    expect(within(section).getByText('New')).toBeInTheDocument()
    expect(await screen.findAllByText('Northwind is marked as new.')).not.toHaveLength(0)
  })
})

describe('settling a maybe', () => {
  it('a quiet company stays a new lead after "Same company"', async () => {
    mockApi(maybe(), {
      answer: () =>
        Response.json(
          settled({
            status: 'quiet',
            hubspot_id: '501',
            name: 'Northwind Group',
            matched_by: 'hubspot_id',
            last_activity: '2025-03-14',
          }),
        ),
    })
    const { user } = renderLead()
    const section = hubspotSection(await openHubSpotTab(user))
    await user.click(
      within(section).getByRole('button', { name: 'Same company as Northwind Group' }),
    )

    expect(
      await within(section).findByText('In HubSpot, quiet since March 2025'),
    ).toBeInTheDocument()
    expect(
      await screen.findAllByText(
        'Northwind is linked to Northwind Group. Nobody has worked it for a year, so it stays a new lead.',
      ),
    ).not.toHaveLength(0)
  })

  it('the choice stays after a reload: the card opens settled, with no buttons', async () => {
    mockApi(maybe())
    const first = renderLead()
    const section = hubspotSection(await openHubSpotTab(first.user))
    await first.user.click(
      within(section).getByRole('button', { name: 'Same company as Northwind Group' }),
    )
    await within(section).findByText('Settled by Jo Sample.')
    first.unmount()

    // A new page: a fresh cache reads the lead from the server again.
    const second = renderLead()
    const again = hubspotSection(await openHubSpotTab(second.user))
    expect(await within(again).findByText('Settled by Jo Sample.')).toBeInTheDocument()
    expect(within(again).getByText('In HubSpot')).toBeInTheDocument()
    expect(within(again).queryByRole('button', { name: /Same company/ })).toBeNull()
  })

  it('shows a refusal in plain words, and reads the card again when someone settled it first', async () => {
    const backend = mockApi(maybe(), {
      answer: () =>
        Response.json(
          {
            title: 'Already settled',
            status: 409,
            detail: "This lead isn't a possible match any more, so there is nothing to settle.",
            code: 'not_a_maybe',
          },
          { status: 409 },
        ),
    })
    const { user } = renderLead()
    const section = hubspotSection(await openHubSpotTab(user))
    const readsBefore = backend.reads
    await user.click(within(section).getByRole('button', { name: "It's new" }))

    const error = await within(section).findByText('Already settled')
    expect(error.closest('[data-slot="error-state"]')).toHaveAttribute('data-code', 'not_a_maybe')
    expect(
      within(section).getByText(
        "This lead isn't a possible match any more, so there is nothing to settle.",
      ),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(backend.reads).toBeGreaterThan(readsBefore)
    })
  })

  it('a Viewer sees the possible matches without the buttons', async () => {
    mockApi(maybe(), {
      me: {
        auth_required: true,
        user: {
          id: 'u-viewer',
          email: 'viewer@example.test',
          username: null,
          name: 'Jo Sample',
          position: null,
          role: 'viewer',
          apps: ['lead_finder'],
          features: ['lead_finder.results'],
          hubspot_owner: null,
          active: true,
          last_signed_in_at: '2026-11-17T01:00:00Z',
          created_at: '2026-11-01T00:00:00Z',
        },
        session: { id: 'sess-1', current: true },
      },
    })
    const { user } = renderLead()
    const section = hubspotSection(await openHubSpotTab(user))
    expect(within(section).getByText('Northwind Logistics')).toBeInTheDocument()
    expect(within(section).queryByRole('button', { name: /Same company/ })).toBeNull()
    expect(within(section).queryByRole('button', { name: "It's new" })).toBeNull()
  })
})
