/**
 * The role words (PLAN-V19 T3-2): "Platform admin", "Admin", "Staff", "Viewer".
 */
import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AdminPeopleTab from '@/apps/lead-finder/admin/people'
import { SAMPLE_USER, signedIn, stubAuthBackend } from '@/test/fake-auth'
import { renderWithProviders } from '@/test/render'
import { ROLE_NAMES, roleName } from './roles'
import { UserMenu } from './user-menu'

const AL_KHAIR = {
  id: 'aaaaaaaa-2222-3333-4444-555555555555',
  name: 'Al-khair M. Pama',
  position: null,
  email: 'al@example.test',
  username: 'alkhair',
  role: 'platform_admin',
  apps: ['lead_finder', 'companies'],
  features: [
    'lead_finder.start_run',
    'lead_finder.results',
    'lead_finder.rules',
    'lead_finder.send_to_hubspot',
    'companies.companies',
    'companies.call_logs',
    'companies.meetings',
    'companies.call_prep',
  ],
  active: true,
  created_at: '2026-11-05T00:00:00Z',
  last_signed_in_at: '2026-11-08T00:00:00Z',
}
const ARIA = {
  ...AL_KHAIR,
  id: 'cccccccc-2222-3333-4444-555555555555',
  name: 'Aria Sample',
  position: 'Sales Manager',
  email: 'aria@example.test',
  role: 'admin',
}
const MARCUS = {
  ...AL_KHAIR,
  id: 'bbbbbbbb-2222-3333-4444-555555555555',
  name: 'Marcus Lee',
  email: 'marcus@example.test',
  role: 'staff',
  features: ['companies.call_logs'],
  apps: ['companies'],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the role words', () => {
  it('names each role in plain words', () => {
    expect(ROLE_NAMES).toEqual({
      platform_admin: 'Platform admin',
      admin: 'Admin',
      staff: 'Staff',
      viewer: 'Viewer',
    })
    expect(roleName('platform_admin')).toBe('Platform admin')
    expect(roleName('admin')).toBe('Admin')
    expect(roleName('staff')).toBe('Staff')
    expect(roleName('viewer')).toBe('Viewer')
    expect(roleName('auditor')).toBe('auditor')
  })

  it('shows the role name in the account menu', async () => {
    stubAuthBackend({
      me: signedIn({
        ...SAMPLE_USER,
        name: 'Aria Sample',
        email: 'aria@example.test',
        role: 'admin',
      }),
    })
    const { user } = renderWithProviders(<UserMenu />)
    await user.click(await screen.findByRole('button', { name: 'Account menu, Aria Sample' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText('Aria Sample')).toBeInTheDocument()
    expect(within(menu).getByText('Admin')).toBeInTheDocument()
  })

  it('shows Platform admin, Admin and Staff on the People tab', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((request: Request) => {
        const path = new URL(request.url).pathname
        if (path === '/api/v1/auth/me') {
          return Promise.resolve(Response.json({ auth_required: false, user: null, session: null }))
        }
        if (path === '/api/v1/people') {
          return Promise.resolve(Response.json([AL_KHAIR, ARIA, MARCUS]))
        }
        return Promise.resolve(Response.json({ title: 'Not found', status: 404 }, { status: 404 }))
      }),
    )
    const { user } = renderWithProviders(<AdminPeopleTab />)
    const table = await screen.findByRole('table', { name: 'People' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(within(rows[0]).getByText('Al-khair M. Pama')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Platform admin')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Everything')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Sales Manager')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Admin')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Staff')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Call logs')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit Al-khair M. Pama' }))
    expect(
      within(await screen.findByRole('dialog')).getByText('(the Platform admin has everything)'),
    ).toBeInTheDocument()
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: 'Edit Aria Sample' }))
    expect(
      within(await screen.findByRole('dialog')).getByText('(an Admin has everything)'),
    ).toBeInTheDocument()
  })
})
