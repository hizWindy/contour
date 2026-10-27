import { screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { LeadDetail } from '@/api/types'
import { renderWithProviders } from '@/test/render'
import LeadPage from './index'
import { HOSTILE, LEAD_ID, makeLead } from './test-lead'

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

describe('the lead page', () => {
  it('shows the result, the rules, the facts with sources and the notes', async () => {
    mockApi(makeLead())
    const { user } = renderLead()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Acme Software' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Score 78')).toBeInTheDocument()
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
