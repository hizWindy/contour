import { screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/router'
import { renderWithProviders } from '@/test/render'

// Pages load lazily. A busy test run can take more than the default second to load one.
const LAZY = 5000

// The website can be installed as an app (Improvements 1, #9). The real thing waits for the
// browser's say-so, which a test can't give, so the menu is tested against a stand-in. The real one
// has its own tests: src/pwa/install.test.tsx.
const app = vi.hoisted(() => ({
  way: null as 'prompt' | 'steps' | null,
  install: vi.fn(),
}))
vi.mock('@/pwa/install', async () => ({
  ...(await vi.importActual('@/pwa/install')),
  useInstallWay: () => app.way,
  install: app.install,
}))

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const result = renderWithProviders(<RouterProvider router={router} />, { withRouter: false })
  return { ...result, router }
}

// The pages call the API; these tests are about the menu, so every call answers 404. That also
// answers "who is signed in" (a 404 there means no sign-in), so the app frame shows.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(Response.json({ title: 'Not found', status: 404 }, { status: 404 })),
    ),
  )
})

afterEach(() => {
  window.localStorage.clear()
  app.way = null
})

describe('the command menu', () => {
  it('opens with Ctrl+K and goes to a page typed into it', async () => {
    const { user, router } = renderAt('/start')
    await screen.findByRole('heading', { level: 1, name: 'Start a run' }, { timeout: LAZY })

    await user.keyboard('{Control>}k{/Control}')
    const input = await screen.findByPlaceholderText('Type a page or an action')
    await user.type(input, 'search log')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin/searches')
    })
    expect(screen.queryByPlaceholderText('Type a page or an action')).not.toBeInTheDocument()
  })

  it('opens with Cmd+K too, and from its button, and Esc closes it', async () => {
    const { user } = renderAt('/results')
    await screen.findByRole('heading', { level: 1, name: 'Results' }, { timeout: LAZY })

    await user.keyboard('{Meta>}k{/Meta}')
    expect(await screen.findByRole('dialog', { name: 'Go to a page' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /Go to a page/ }))
    expect(await screen.findByRole('dialog', { name: 'Go to a page' })).toBeInTheDocument()
  })

  it('finds a page by one of its other words', async () => {
    const { user, router } = renderAt('/start')
    await screen.findByRole('heading', { level: 1, name: 'Start a run' }, { timeout: LAZY })
    await user.keyboard('{Control>}k{/Control}')
    await user.type(await screen.findByPlaceholderText('Type a page or an action'), 'csv')
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/results')
    })
  })

  it('switches to dark colours and back to the computer setting, and keeps the choice', async () => {
    const { user } = renderAt('/start')
    await screen.findByRole('heading', { level: 1, name: 'Start a run' }, { timeout: LAZY })

    await user.keyboard('{Control>}k{/Control}')
    await user.click(await screen.findByRole('option', { name: 'Use dark colours' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(window.localStorage.getItem('lead-finder-theme')).toBe('dark')

    await user.keyboard('{Control>}k{/Control}')
    await user.click(await screen.findByRole('option', { name: "Follow the computer's colours" }))
    expect(document.documentElement).not.toHaveAttribute('data-theme')
    expect(window.localStorage.getItem('lead-finder-theme')).toBe('system')
  })

  it('says so when nothing matches', async () => {
    const { user } = renderAt('/start')
    await screen.findByRole('heading', { level: 1, name: 'Start a run' }, { timeout: LAZY })
    await user.keyboard('{Control>}k{/Control}')
    await user.type(await screen.findByPlaceholderText('Type a page or an action'), 'qqqzzz')
    expect(await screen.findByText('Nothing matches. Try another word.')).toBeInTheDocument()
  })
})

describe('installing the website as an app (Improvements 1, #9)', () => {
  async function openMenu() {
    const result = renderAt('/start')
    await screen.findByRole('heading', { level: 1, name: 'Start a run' }, { timeout: LAZY })
    await result.user.keyboard('{Control>}k{/Control}')
    await screen.findByPlaceholderText('Type a page or an action')
    return result
  }

  it('offers nothing to install when the browser has not said it can, or it is installed', async () => {
    await openMenu()
    expect(screen.queryByRole('option', { name: /Install|home screen/ })).not.toBeInTheDocument()
  })

  it("installs with the browser's own dialog when the browser has offered it, and closes the menu", async () => {
    app.way = 'prompt'
    const { user } = await openMenu()
    await user.click(await screen.findByRole('option', { name: 'Install Contour on this device' }))
    expect(app.install).toHaveBeenCalledTimes(1)
    expect(screen.queryByPlaceholderText('Type a page or an action')).not.toBeInTheDocument()
  })

  it('is found by the words people think of: app, phone, home screen', async () => {
    app.way = 'prompt'
    const { user } = await openMenu()
    const input = screen.getByPlaceholderText('Type a page or an action')
    for (const word of ['home screen', 'phone']) {
      await user.clear(input)
      await user.type(input, word)
      expect(
        await screen.findByRole('option', { name: 'Install Contour on this device' }),
      ).toBeInTheDocument()
    }
  })

  it('says how to add it to the home screen where the browser has no install dialog (iPhone)', async () => {
    app.way = 'steps'
    const { user } = await openMenu()
    await user.click(await screen.findByRole('option', { name: 'Add Contour to your home screen' }))
    expect(app.install).toHaveBeenCalledTimes(1)
  })
})
