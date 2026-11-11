import { screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LEAD_FINDER } from '@/apps/lead-finder/module'
import { MODULES, PLANNED } from '@/modules'
import { routes } from '@/router'
import { ADMIN, ADMIN_TABS, HOME } from '@/shell/nav'
import { RouteError } from '@/shell/route-error'
import { renderWithProviders } from '@/test/render'

// The pages call the API. These tests are about addresses, titles and the menu, so every call
// answers 404: a page then shows its title and a plain error, which is enough here.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(Response.json({ title: 'Not found', status: 404 }, { status: 404 })),
    ),
  )
})

// A page loads its code the first time it is visited (a lazy route). Under a busy test run the
// first load of a heavy page (the charts) can take more than the 1 s default.
const LAZY = 5000

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
    ['/runs/0f3c9a2e-1111-2222-3333-444444444444', 'Run 0f3c9a2e', ['Runs', 'Run 0f3c9a2e']],
    ['/results', 'Results', ['Results']],
    ['/leads/99999999-2222-3333-4444-555555555555', 'Lead', ['Lead']],
    ['/rules', 'Rules', ['Rules']],
    ['/test-set', 'Test set', ['Test set']],
  ])('shows the page at %s with its title and breadcrumbs', async (path, title, trail) => {
    renderAt(path)

    expect(
      await screen.findByRole('heading', { level: 1, name: title }, { timeout: LAZY }),
    ).toBeInTheDocument()
    expect(crumbs()).toEqual(trail)
    expect(document.title).toBe(`${trail.at(-1) ?? ''} - Contour`)
  })

  it('shows Home at the home address, with a card for every project and its pages', async () => {
    const { router } = renderAt('/')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Home' }, { timeout: LAZY }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(document.title).toBe('Home - Contour')

    const page = document.getElementById('page') as HTMLElement
    for (const app of MODULES) {
      const card = within(page).getByRole('region', { name: app.name })
      expect(within(card).getByText(app.description)).toBeInTheDocument()
      for (const item of app.pages) {
        expect(within(card).getByRole('link', { name: item.label })).toHaveAttribute(
          'href',
          item.to,
        )
      }
    }
  })

  it.each([
    ['/admin/rules', '/rules', 'Rules'],
    ['/admin/tests', '/test-set', 'Test set'],
  ])('sends the old Admin tab %s to its own page', async (old, now, title) => {
    const { router } = renderAt(old)
    expect(
      await screen.findByRole('heading', { level: 1, name: title }, { timeout: LAZY }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(now)
  })

  it('opens on Health, and every tab has its own address', async () => {
    const { router } = renderAt('/admin')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Admin' }, { timeout: LAZY }),
    ).toBeInTheDocument()
    await waitFor(
      () => {
        expect(router.state.location.pathname).toBe('/admin/health')
      },
      { timeout: LAZY },
    )

    const tabs = screen.getByRole('navigation', { name: 'Admin sections' })
    const links = within(tabs).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual(ADMIN_TABS.map((tab) => tab.to))
    expect(await within(tabs).findByRole('link', { current: 'page' })).toHaveTextContent('Health')
  })

  it.each(ADMIN_TABS.map((tab) => [tab.to, tab.label]))(
    'shows the Admin tab at %s',
    async (path, label) => {
      renderAt(path)
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Admin' }, { timeout: LAZY }),
      ).toBeInTheDocument()
      await waitFor(
        () => {
          expect(crumbs()).toEqual(['Admin', label])
        },
        { timeout: LAZY },
      )
      const tabs = screen.getByRole('navigation', { name: 'Admin sections' })
      expect(await within(tabs).findByRole('link', { current: 'page' })).toHaveTextContent(label)
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

  it('lists Home, each project with its own pages, and Admin, and marks the page you are on', async () => {
    renderAt('/runs/0f3c9a2e-1111-2222-3333-444444444444')
    await screen.findByRole('heading', { level: 1, name: 'Run 0f3c9a2e' })

    const menu = within(screen.getByRole('navigation', { name: 'Main menu' }))
    expect(menu.getByRole('link', { name: HOME.label })).toHaveAttribute('href', '/')
    for (const app of MODULES) {
      if (app.pages.length === 1) {
        // A project with one page is a plain link under Home, not a group (PLAN-V10 B1).
        const [only] = app.pages
        expect(menu.queryByRole('group', { name: app.name })).toBeNull()
        expect(menu.getByRole('link', { name: only?.label })).toHaveAttribute('href', only?.to)
        continue
      }
      const group = within(menu.getByRole('group', { name: app.name }))
      for (const item of app.pages) {
        expect(group.getByRole('link', { name: item.label })).toHaveAttribute('href', item.to)
      }
    }
    // The Companies page sits right under Home.
    const links = menu.getAllByRole('link').map((link) => link.getAttribute('href'))
    expect(links.slice(0, 2)).toEqual(['/', '/companies'])
    expect(menu.getByRole('link', { name: ADMIN.label })).toHaveAttribute('href', '/admin')
    // Rules and the Test set are the Lead Finder's own, not shared Admin tabs.
    const leadFinder = within(menu.getByRole('group', { name: LEAD_FINDER.name }))
    expect(leadFinder.getByRole('link', { name: 'Rules' })).toHaveAttribute('href', '/rules')
    expect(ADMIN_TABS.map((tab) => tab.label)).not.toContain('Rules')

    expect(menu.getByRole('link', { name: 'Runs' })).toHaveAttribute('aria-current', 'page')
    expect(menu.getByRole('link', { name: 'Results' })).not.toHaveAttribute('aria-current')
    expect(menu.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
  })

  it('marks Admin in the menu on every Admin tab', async () => {
    renderAt('/admin/searches')
    await screen.findByRole('heading', { level: 1, name: 'Admin' }, { timeout: LAZY })
    const menu = within(screen.getByRole('navigation', { name: 'Main menu' }))
    expect(menu.getByRole('link', { name: 'Admin' })).toHaveAttribute('aria-current', 'page')
  })

  it('lists the projects still to be developed in their own menu group', async () => {
    renderAt('/')
    await screen.findByRole('heading', { level: 1, name: 'Home' }, { timeout: LAZY })
    const menu = within(screen.getByRole('navigation', { name: 'Main menu' }))
    const planned = within(menu.getByRole('group', { name: 'To be developed' }))
    expect(planned.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(
      PLANNED.map((project) => project.to),
    )
  })

  it.each(PLANNED.map((project) => [project.to, project]))(
    'shows a "to be developed" page at %s',
    async (path, project) => {
      renderAt(path)
      expect(
        await screen.findByRole('heading', { level: 1, name: project.name }, { timeout: LAZY }),
      ).toBeInTheDocument()
      expect(crumbs()).toEqual([project.name])
      const page = document.getElementById('page') as HTMLElement
      expect(within(page).getByText('To be developed')).toBeInTheDocument()
      expect(within(page).getByText(project.description)).toBeInTheDocument()
      expect(within(page).getByText(project.status)).toBeInTheDocument()
      const menu = within(screen.getByRole('navigation', { name: 'Main menu' }))
      expect(menu.getByRole('link', { name: project.name })).toHaveAttribute('aria-current', 'page')
    },
  )

  it('lists the projects still to be developed on Home, each with its page', async () => {
    renderAt('/')
    await screen.findByRole('heading', { level: 1, name: 'Home' }, { timeout: LAZY })
    const section = within(screen.getByRole('region', { name: 'To be developed' }))
    for (const project of PLANNED) {
      expect(section.getByRole('link', { name: project.name })).toHaveAttribute('href', project.to)
      expect(section.getByText(project.status)).toBeInTheDocument()
    }
  })

  it('keeps Results marked while a lead card is open', async () => {
    renderAt('/leads/99999999-2222-3333-4444-555555555555')
    await screen.findByRole('heading', { level: 1, name: 'Lead' })
    const menu = within(screen.getByRole('navigation', { name: 'Main menu' }))
    expect(menu.getByRole('link', { name: 'Results' })).toHaveAttribute('aria-current', 'page')
  })

  it('has a skip link to the page content, before everything else', async () => {
    renderAt('/results')
    await screen.findByRole('heading', { level: 1, name: 'Results' }, { timeout: LAZY })
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
