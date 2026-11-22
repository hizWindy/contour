/**
 * Admin, People, a person, Activity (PLAN-V26 T3-3), against the generated contract and a fake
 * server, at a laptop's width (1440px) and a phone's (390px). Made-up names only.
 */
import { screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { asLaptop, asPhone } from '@/test/screen'
import AdminPersonActivity from './activity'

const ID = 'bbbbbbbb-2222-3333-4444-555555555555'
const AT = '2026-11-23T04:40:00Z' // 3:40 pm in Melbourne

const JO = {
  id: ID,
  name: 'Jo Sample',
  email: 'jo@example.test',
  username: 'jsample',
  position: null,
  role: 'staff',
  apps: ['companies'],
  features: ['companies.call_logs'],
  active: true,
  created_at: AT,
  last_signed_in_at: AT,
  hubspot_owner: null,
}

const FULL: Record<string, unknown> = {
  'sign-ins': {
    total: 2,
    items: [
      {
        id: 2,
        at: AT,
        event: 'account_changed',
        ip: null,
        device: null,
        details: {
          fields: ['username'],
          username_from: 'jo',
          username_to: 'jsample',
          admin_name: 'Al Khair',
          admin_ip: '203.0.113.7',
          admin_device: 'Chrome on Windows',
        },
      },
      {
        id: 1,
        at: AT,
        event: 'sign_in',
        ip: '203.0.113.9',
        device: 'Firefox on Linux',
        details: {},
      },
    ],
  },
  devices: {
    total: 1,
    items: [
      {
        id: 'cccccccc-2222-3333-4444-555555555555',
        current: false,
        device: 'Firefox on Linux',
        ip: '203.0.113.9',
        first_used_at: AT,
        last_used_at: AT,
      },
    ],
  },
  calls: {
    total: 1,
    items: [{ id: '1', at: AT, what: 'Northwind', detail: 'Jo Example', state: 'To confirm' }],
  },
  preps: {
    total: 1,
    items: [{ id: '2', at: AT, what: 'Sample Logistics', detail: null, state: 'Ready' }],
  },
  sent: {
    total: 1,
    items: [
      {
        id: '3',
        at: AT,
        what: 'Northwind',
        detail: 'First meeting',
        state: 'Pre-read to the team',
      },
    ],
  },
  spending: {
    total: 1,
    total_usd: '0.150000',
    items: [{ day: '2026-11-23', kind: 'Preps', requests: 2, cost_usd: '0.150000' }],
  },
}

function serve(empty = false): string[] {
  const posts: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1', '')
      if (request.method === 'POST') {
        posts.push(path)
        return Promise.resolve(Response.json({ sessions_ended: 1 }))
      }
      if (path === '/auth/me') {
        return Promise.resolve(Response.json({ auth_required: false, user: null, session: null }))
      }
      if (path === '/people') return Promise.resolve(Response.json([JO]))
      const tab = path.split('/activity/')[1] ?? ''
      const body = empty ? { total: 0, total_usd: '0', items: [] } : FULL[tab]
      return Promise.resolve(Response.json(body))
    }),
  )
  return posts
}

function open() {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/people/:personId" element={<AdminPersonActivity />} />
    </Routes>,
    { route: `/admin/people/${ID}` },
  )
}

afterEach(() => {
  toast.dismiss()
  vi.unstubAllGlobals()
})

describe.each([
  ['1440px', asLaptop],
  ['390px', asPhone],
])('the Activity page at %s', (_width, setWidth) => {
  it('shows the rows of each of the six tabs', async () => {
    setWidth()
    serve()
    const { user } = open()
    const log = await screen.findByRole('list', { name: 'Sign-ins' })
    expect(log).toHaveTextContent('Changed: username')
    expect(log).toHaveTextContent('Username jo to jsample')
    expect(log).toHaveTextContent('By Al Khair')
    expect(log).toHaveTextContent('Signed in')
    expect(log).toHaveTextContent('Firefox on Linux, 203.0.113.9')

    const tabs = [
      ['Devices', 'Firefox on Linux'],
      ['Calls and notes', 'To confirm'],
      ['Preps', 'Sample Logistics'],
      ['Sent', 'Pre-read to the team'],
      ['Spending', '2 requests'],
    ] as const
    for (const [tab, words] of tabs) {
      await user.click(screen.getByRole('radio', { name: tab }))
      expect(await screen.findByRole('list', { name: tab })).toHaveTextContent(words)
    }
    expect(screen.getByText('Earlier: Not recorded before this update.')).toBeInTheDocument()
  })

  it('says so in words when a tab is empty', async () => {
    setWidth()
    serve(true)
    const { user } = open()
    expect(await screen.findByText('No sign-ins yet.')).toBeInTheDocument()
    const tabs = [
      ['Devices', 'Not signed in on any browser now.'],
      ['Calls and notes', 'No calls or notes yet.'],
      ['Preps', 'No call preps yet.'],
      ['Sent', 'Nothing sent yet.'],
      ['Spending', 'No Claude spending recorded.'],
    ] as const
    for (const [tab, words] of tabs) {
      await user.click(screen.getByRole('radio', { name: tab }))
      expect(await screen.findByText(words)).toBeInTheDocument()
    }
  })

  it('asks before it signs a browser out', async () => {
    setWidth()
    const posts = serve()
    const { user } = open()
    await user.click(await screen.findByRole('radio', { name: 'Devices' }))
    await user.click(await screen.findByRole('button', { name: 'Sign out Firefox on Linux' }))
    const asked = await screen.findByRole('alertdialog')
    expect(asked).toHaveTextContent('Sign Jo Sample out of Firefox on Linux?')
    expect(posts).toEqual([])
    await user.click(within(asked).getByRole('button', { name: 'Sign out' }))
    await waitFor(() => {
      expect(posts).toEqual([`/people/${ID}/devices/cccccccc-2222-3333-4444-555555555555/sign-out`])
    })
  })

  it('signs out everywhere, after asking', async () => {
    setWidth()
    const posts = serve()
    const { user } = open()
    await user.click(await screen.findByRole('radio', { name: 'Devices' }))
    await user.click(await screen.findByRole('button', { name: 'Sign out everywhere' }))
    const asked = await screen.findByRole('alertdialog')
    expect(posts).toEqual([])
    await user.click(within(asked).getByRole('button', { name: 'Sign out' }))
    await waitFor(() => {
      expect(posts).toEqual([`/people/${ID}/sign-out`])
    })
  })
})
