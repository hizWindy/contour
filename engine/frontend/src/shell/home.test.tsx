import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LEAD_FINDER } from '@/apps/lead-finder/module'
import { renderWithProviders } from '@/test/render'
import HomePage from './home'

const RUN = {
  id: '11111111-2222-3333-4444-555555555555',
  app: 'lead_finder',
  status: 'done',
  mode: 'discovery',
  created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
  cost_usd: '5.48',
}

/** A backend with `runs` and the result counts of the leads, or one that fails. */
function stubBackend({
  runs = [RUN],
  results = [
    { value: 'pass', count: 4 },
    { value: 'director_review', count: 8 },
    { value: 'watch', count: 30 },
    { value: 'drop', count: 0 },
  ],
  fail = false,
}: { runs?: unknown[]; results?: Array<{ value: string; count: number }>; fail?: boolean } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request) => {
      if (fail) return Promise.reject(new TypeError('Failed to fetch'))
      const path = new URL(request.url).pathname.replace(/^\/api\/v1/, '')
      if (path === '/runs')
        return Promise.resolve(Response.json({ items: runs, total: runs.length }))
      if (path === '/lead-finder/leads/facets')
        return Promise.resolve(Response.json({ result: results }))
      return Promise.resolve(Response.json({ title: 'Not found', status: 404 }, { status: 404 }))
    }),
  )
}

const card = () => screen.getByRole('region', { name: LEAD_FINDER.name })

describe('the Lead Finder card on Home', () => {
  it('says where things stand: the last run and the leads by result, each a link', async () => {
    stubBackend()
    renderWithProviders(<HomePage />)

    const lastRun = await within(card()).findByRole('link', { name: '2 hours ago' })
    expect(lastRun).toHaveAttribute('href', `/runs/${RUN.id}`)
    expect(within(card()).getByText('US$5.48')).toBeInTheDocument()

    expect(await within(card()).findByRole('link', { name: '42 leads' })).toHaveAttribute(
      'href',
      '/results',
    )
    expect(within(card()).getByRole('link', { name: 'Pass: 4 leads' })).toHaveAttribute(
      'href',
      '/results?result=pass',
    )
    expect(within(card()).getByRole('link', { name: 'Director review: 8 leads' })).toHaveAttribute(
      'href',
      '/results?result=director_review',
    )
    // A result with no leads is left out.
    expect(within(card()).queryByRole('link', { name: /^Drop/ })).toBeNull()
  })

  it('says so plainly when there are no runs or leads yet', async () => {
    stubBackend({ runs: [], results: [] })
    renderWithProviders(<HomePage />)

    expect(
      await within(card()).findByText('No runs yet. Start one to find leads.'),
    ).toBeInTheDocument()
    expect(await within(card()).findByText('No leads yet.')).toBeInTheDocument()
  })

  it('keeps the page links when the backend cannot be reached', async () => {
    stubBackend({ fail: true })
    renderWithProviders(<HomePage />)

    expect(await within(card()).findByText("Can't load the runs right now.")).toBeInTheDocument()
    expect(await within(card()).findByText("Can't load the leads right now.")).toBeInTheDocument()
    expect(within(card()).getByRole('link', { name: 'Start a run' })).toHaveAttribute(
      'href',
      '/start',
    )
  })

  it('lists each page as a row: its name is the link, and its purpose describes it', () => {
    stubBackend()
    renderWithProviders(<HomePage />)

    for (const item of LEAD_FINDER.pages) {
      const row = within(card()).getByRole('link', { name: item.label })
      expect(row).toHaveAttribute('href', item.to)
      expect(item.purpose).toBeTruthy()
      expect(row).toHaveAccessibleDescription(item.purpose ?? '')
    }
  })
})
