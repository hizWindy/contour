import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SourceOut } from '@/api/types'
import { mockApi, type Call } from '@/test/mock-api'
import { renderWithProviders } from '@/test/render'
import AdminSourcesTab from './sources'

const DAILY: SourceOut = {
  id: 'property_daily',
  name: 'Property Daily',
  connected: true,
  on: true,
  signed_in: true,
  last_read_at: '2026-11-14T19:15:00Z',
  pages_today: 42,
  pages_limit: 300,
  records: 1240,
  paused_until: null,
  last_problem: null,
}

const AREALYTICS: SourceOut = {
  id: 'arealytics',
  name: 'Arealytics',
  connected: false,
  on: false,
  signed_in: null,
  last_read_at: null,
  pages_today: 0,
  pages_limit: 0,
  records: 0,
  paused_until: null,
  last_problem: 'Arealytics refused automated access. It waits on an API or written approval.',
}

const SETTINGS = { daily_left_usd: '50.00', fields: [] }

function answers(daily: SourceOut = DAILY, after: Partial<SourceOut> = {}): Call[] {
  return mockApi({
    '/api/v1/sources': { items: [daily, AREALYTICS] },
    '/api/v1/sources/property_daily/check': { ...daily, ...after },
    '/api/v1/sources/property_daily/resume': { ...daily, paused_until: null },
    '/api/v1/settings': SETTINGS,
  })
}

function card(name: string): HTMLElement {
  const title = screen.getByText(name, { selector: '[data-slot="card-title"]' })
  return title.closest('[data-slot="source"]') as HTMLElement
}

describe('Admin, Sources (PLAN-V16 T3-6)', () => {
  it("shows each tool's switch, sign-in, last read, pages today and records", async () => {
    answers()
    renderWithProviders(<AdminSourcesTab />)
    await screen.findByText('Property Daily', { selector: '[data-slot="card-title"]' })
    const daily = card('Property Daily')
    expect(within(daily).getByRole('switch', { name: 'Switched on' })).toBeChecked()
    expect(daily).toHaveTextContent('Sign-inSigned in')
    expect(daily).toHaveTextContent('Pages today42 of 300')
    expect(daily).toHaveTextContent('In our copy1,240 records')
    expect(within(daily).getByRole('button', { name: 'Check now' })).toBeInTheDocument()
    expect(within(daily).queryByRole('button', { name: 'Resume' })).toBeNull()
  })

  it('shows a tool that is not connected with its reason, and no switch, check or resume', async () => {
    answers()
    renderWithProviders(<AdminSourcesTab />)
    await screen.findByText('Arealytics', { selector: '[data-slot="card-title"]' })
    const arealytics = card('Arealytics')
    expect(arealytics).toHaveTextContent('Not connected: there is no connector for it.')
    expect(arealytics).toHaveTextContent(AREALYTICS.last_problem ?? '')
    expect(within(arealytics).queryByRole('switch')).toBeNull()
    expect(within(arealytics).queryByRole('button')).toBeNull()
  })

  it('switches a tool off at once, with an Undo that switches it back', async () => {
    const calls = answers()
    const { user } = renderWithProviders(<AdminSourcesTab />)
    await screen.findByText('Property Daily', { selector: '[data-slot="card-title"]' })

    await user.click(within(card('Property Daily')).getByRole('switch'))

    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'PATCH').map((call) => call.body)).toEqual([
        { values: { property_daily_enabled: false } },
      ])
    })
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'PATCH').at(-1)?.body).toEqual({
        values: { property_daily_enabled: true },
      })
    })
  })

  it('"Check now" reads one page and says how it went', async () => {
    const calls = answers()
    const { user } = renderWithProviders(<AdminSourcesTab />)
    await screen.findByText('Property Daily', { selector: '[data-slot="card-title"]' })
    await user.click(screen.getByRole('button', { name: 'Check now' }))
    expect(await screen.findByText('Signed in to Property Daily.')).toBeInTheDocument()
    expect(calls.some((call) => call.method === 'POST' && call.path.endsWith('/check'))).toBe(true)
  })

  it('a failed check shows its plain sentence', async () => {
    const problem = "Property Daily's sign-in page came up twice. Check the login."
    answers(DAILY, { signed_in: false, last_problem: problem })
    const { user } = renderWithProviders(<AdminSourcesTab />)
    await screen.findByText('Property Daily', { selector: '[data-slot="card-title"]' })
    await user.click(screen.getByRole('button', { name: 'Check now' }))
    expect(await screen.findByText(`Property Daily: ${problem}`)).toBeInTheDocument()
    expect(card('Property Daily')).toHaveTextContent(problem)
    expect(card('Property Daily')).toHaveTextContent('Sign-inNot signed in')
  })

  it('shows a pause and lifts it with Resume', async () => {
    const calls = answers({ ...DAILY, paused_until: '2026-11-15T19:15:00Z' })
    const { user } = renderWithProviders(<AdminSourcesTab />)
    await screen.findByText(/^Paused until/)
    await user.click(screen.getByRole('button', { name: 'Resume' }))
    expect(await screen.findByText('Property Daily resumed.')).toBeInTheDocument()
    expect(calls.some((call) => call.path.endsWith('/resume'))).toBe(true)
    await waitFor(() => {
      expect(screen.queryByText(/^Paused until/)).toBeNull()
    })
  })

  it('says so in plain words when the sources cannot be read', async () => {
    mockApi({
      '/api/v1/sources': () =>
        Response.json({ title: 'Something went wrong', status: 500 }, { status: 500 }),
    })
    renderWithProviders(<AdminSourcesTab />)
    expect(await screen.findByText("The sources couldn't be loaded.")).toBeInTheDocument()
  })
})
