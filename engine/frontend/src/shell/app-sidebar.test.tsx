import { screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LEAD_FINDER } from '@/apps/lead-finder/module'
import { routes } from '@/router'
import { renderWithProviders } from '@/test/render'
import { asLaptop } from '@/test/screen'

// The pages call the API. These tests are about the menu, so every call answers 404.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(Response.json({ title: 'Not found', status: 404 }, { status: 404 })),
    ),
  )
})

const LAZY = 5000

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  return renderWithProviders(<RouterProvider router={router} />, { withRouter: false })
}

function mainMenu() {
  return within(screen.getByRole('navigation', { name: 'Main menu' }))
}

describe("a project's dropdown in the open menu", () => {
  it('starts open, with the pages under the project name', async () => {
    asLaptop()
    renderAt('/runs')
    await screen.findByRole('heading', { level: 1, name: 'Runs' }, { timeout: LAZY })

    const toggle = mainMenu().getByRole('button', { name: LEAD_FINDER.name })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const group = within(mainMenu().getByRole('group', { name: LEAD_FINDER.name }))
    for (const item of LEAD_FINDER.pages) {
      expect(group.getByRole('link', { name: item.label })).toHaveAttribute('href', item.to)
    }
    expect(group.getByRole('link', { name: 'Runs' })).toHaveAttribute('aria-current', 'page')
  })

  it('closes and opens again, and marks the project while closed on one of its pages', async () => {
    asLaptop()
    const { user } = renderAt('/results')
    await screen.findByRole('heading', { level: 1, name: 'Results' }, { timeout: LAZY })
    const toggle = mainMenu().getByRole('button', { name: LEAD_FINDER.name })

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(mainMenu().queryByRole('link', { name: 'Results' })).not.toBeInTheDocument()
    expect(toggle).toHaveAttribute('data-active', 'true')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(mainMenu().getByRole('link', { name: 'Results' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(toggle).toHaveAttribute('data-active', 'false')
  })
})

describe('the menu folded to icons', () => {
  it('shows the pages as icons, with no dropdown to open first', async () => {
    // A tablet: the menu starts folded.
    renderAt('/runs')
    await screen.findByRole('heading', { level: 1, name: 'Runs' }, { timeout: LAZY })

    expect(mainMenu().queryByRole('button', { name: LEAD_FINDER.name })).not.toBeInTheDocument()
    const group = within(mainMenu().getByRole('group', { name: LEAD_FINDER.name }))
    for (const item of LEAD_FINDER.pages) {
      expect(group.getByRole('link', { name: item.label })).toHaveAttribute('href', item.to)
    }
  })
})

describe('the account at the foot of the menu (PLAN-V13 T1-6)', () => {
  it('shows the name and role, and opens the account menu', async () => {
    asLaptop()
    vi.stubGlobal(
      'fetch',
      vi.fn((request: Request) =>
        Promise.resolve(
          new URL(request.url).pathname === '/api/v1/auth/me'
            ? Response.json({
                auth_required: true,
                user: {
                  id: '11111111-2222-3333-4444-555555555555',
                  email: 'al@example.test',
                  username: 'alkhair',
                  name: 'Al-khair M. Pama',
                  role: 'admin',
                },
                session: null,
              })
            : Response.json({ title: 'Not found', status: 404 }, { status: 404 }),
        ),
      ),
    )
    const { user } = renderAt('/')
    const account = await screen.findByRole(
      'button',
      { name: 'Account menu, Al-khair M. Pama, System admin' },
      { timeout: LAZY },
    )
    expect(mainMenu().getByText('Al-khair M. Pama')).toBeInTheDocument()
    expect(mainMenu().getByText('System admin')).toBeInTheDocument()
    await user.click(account)
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText('al@example.test')).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument()
  })
})
