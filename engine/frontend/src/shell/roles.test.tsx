/**
 * The role words (PLAN-V13 T1-4): the person who runs the platform shows as "System admin" in the
 * account menu and on the People tab. Staff and Viewer stay as they are.
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
  email: 'al@example.test',
  username: 'alkhair',
  role: 'admin',
  apps: [],
  active: true,
  created_at: '2026-11-05T00:00:00Z',
  last_signed_in_at: '2026-11-08T00:00:00Z',
}
const MARCUS = {
  ...AL_KHAIR,
  id: 'bbbbbbbb-2222-3333-4444-555555555555',
  name: 'Marcus Lee',
  role: 'staff',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the role words', () => {
  it('names each role in plain words', () => {
    expect(ROLE_NAMES).toEqual({ admin: 'System admin', staff: 'Staff', viewer: 'Viewer' })
    expect(roleName('admin')).toBe('System admin')
    expect(roleName('auditor')).toBe('auditor') // a role the website doesn't know yet
  })

  it('shows "Al-khair M. Pama, System admin" in the account menu', async () => {
    stubAuthBackend({
      me: signedIn({ ...SAMPLE_USER, name: 'Al-khair M. Pama', email: 'al@example.test' }),
    })
    const { user } = renderWithProviders(<UserMenu />)
    await user.click(await screen.findByRole('button', { name: 'Account menu, Al-khair M. Pama' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText('Al-khair M. Pama')).toBeInTheDocument()
    expect(within(menu).getByText('System admin')).toBeInTheDocument()
  })

  it('shows "Al-khair M. Pama, System admin" on the People tab, and Staff stays Staff', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((request: Request) => {
        const path = new URL(request.url).pathname
        if (path === '/api/v1/auth/me') {
          return Promise.resolve(Response.json({ auth_required: false, user: null, session: null }))
        }
        if (path === '/api/v1/people') return Promise.resolve(Response.json([AL_KHAIR, MARCUS]))
        return Promise.resolve(Response.json({ title: 'Not found', status: 404 }, { status: 404 }))
      }),
    )
    const { user } = renderWithProviders(<AdminPeopleTab />)
    const table = await screen.findByRole('table', { name: 'People' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(within(rows[0]).getByText('Al-khair M. Pama')).toBeInTheDocument()
    expect(within(rows[0]).getByText('System admin')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Every project')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Staff')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit Al-khair M. Pama' }))
    expect(
      within(await screen.findByRole('dialog')).getByText('(a System admin has every project)'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/^Admin$/)).toBeNull()
  })
})
