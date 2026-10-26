import { screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { routes } from '@/router'
import { ADMIN_TABS, NAV_ITEMS } from '@/shell/nav'
import { RouteError } from '@/shell/route-error'
import { renderWithProviders } from '@/test/render'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const result = renderWithProviders(<RouterProvider router={router} />, { withRouter: false })
  return { ...result, router }
}

function crumbs(): string[] {
  const nav = screen.getByRole('navigation', { name: 'breadcrumb' })
  return within(nav)
    .getAllByRole('listitem')
    .map((item) => item.textContent)
    .filter((text) => text !== '')
}

describe('the router', () => {
  it.each([
    ['/start', 'Start a run', ['Start a run']],
    ['/runs', 'Runs', ['Runs']],
    ['/runs/0f3c9a2e-1111-2222-3333-444444444444', 'Run', ['Runs', 'Run 0f3c9a2e']],
    ['/results', 'Results', ['Results']],
    ['/leads/99999999-2222-3333-4444-555555555555', 'Lead', ['Lead']],
  ])('shows the page at %s with its title and breadcrumbs', async (path, title, trail) => {
    renderAt(path)

    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'This page is being built.' }),
    ).toBeInTheDocument()
    expect(crumbs()).toEqual(trail)
    expect(document.title).toBe(`${trail.at(-1) ?? ''} - Lead Finder`)
  })

  it('sends the home address to Start a run', async () => {
    const { router } = renderAt('/')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Start a run' }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/start')
  })

  it('opens the first Admin tab, and every tab has its own address', async () => {
    const { router } = renderAt('/admin')
    expect(await screen.findByRole('heading', { level: 1, name: 'Admin' })).toBeInTheDocument()
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin/runs')
    })

    const tabs = screen.getByRole('navigation', { name: 'Admin sections' })
    const links = within(tabs).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual(ADMIN_TABS.map((tab) => tab.to))
    expect(await within(tabs).findByRole('link', { current: 'page' })).toHaveTextContent(
      'Runs and cost',
    )
  })

  it.each(ADMIN_TABS.map((tab) => [tab.to, tab.label]))(
    'shows the Admin tab at %s',
    async (path, label) => {
      renderAt(path)
      expect(await screen.findByRole('heading', { level: 1, name: 'Admin' })).toBeInTheDocument()
      expect(
        await screen.findByRole('heading', { level: 3, name: 'This page is being built.' }),
      ).toBeInTheDocument()
      expect(crumbs()).toEqual(['Admin', label])
    },
  )

  it('says plainly when an address does not exist', async () => {
    renderAt('/nowhere/at/all')
    expect(
      await screen.findByRole('heading', { level: 1, name: "This page doesn't exist." }),
    ).toBeInTheDocument()
    const page = screen.getByRole('heading', { level: 1 }).closest('section')
    expect(page).not.toBeNull()
    expect(within(page as HTMLElement).getByRole('link', { name: 'Start a run' })).toHaveAttribute(
      'href',
      '/start',
    )
  })

  it('lists every main page in the menu, and marks the one you are on', async () => {
    renderAt('/runs/0f3c9a2e-1111-2222-3333-444444444444')
    await screen.findByRole('heading', { level: 1, name: 'Run' })

    const menu = within(screen.getByRole('navigation', { name: 'Main menu' }))
    for (const item of NAV_ITEMS) {
      expect(menu.getByRole('link', { name: item.label })).toHaveAttribute('href', item.to)
    }
    expect(menu.getByRole('link', { name: 'Runs' })).toHaveAttribute('aria-current', 'page')
    expect(menu.getByRole('link', { name: 'Results' })).not.toHaveAttribute('aria-current')
  })

  it('keeps Results marked while a lead card is open', async () => {
    renderAt('/leads/99999999-2222-3333-4444-555555555555')
    await screen.findByRole('heading', { level: 1, name: 'Lead' })
    const menu = within(screen.getByRole('navigation', { name: 'Main menu' }))
    expect(menu.getByRole('link', { name: 'Results' })).toHaveAttribute('aria-current', 'page')
  })

  it('has a skip link to the page content, before everything else', async () => {
    renderAt('/results')
    await screen.findByRole('heading', { level: 1, name: 'Results' })
    const skip = screen.getByRole('link', { name: 'Skip to the page' })
    const target = document.getElementById(skip.getAttribute('href')?.slice(1) ?? '')
    expect(target).not.toBeNull()
    expect(target).toContainElement(screen.getByRole('heading', { level: 1, name: 'Results' }))
  })
})

describe('the error page', () => {
  function Broken(): never {
    throw new TypeError("Cannot read properties of undefined (reading 'x')")
  }

  it('says the page broke, not that the backend is down, and offers a reload', async () => {
    const router = createMemoryRouter([
      { path: '/', Component: Broken, errorElement: <RouteError /> },
    ])
    renderWithProviders(<RouterProvider router={router} />, { withRouter: false })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("This page couldn't be shown")
    expect(alert).not.toHaveTextContent('backend')
    expect(alert).not.toHaveTextContent('reading')
    expect(within(alert).getByRole('button', { name: 'Reload the page' })).toBeInTheDocument()
  })
})
