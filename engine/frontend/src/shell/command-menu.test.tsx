import { screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { routes } from '@/router'
import { renderWithProviders } from '@/test/render'

// Pages load lazily. A busy test run can take more than the default second to load one.
const LAZY = 5000

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const result = renderWithProviders(<RouterProvider router={router} />, { withRouter: false })
  return { ...result, router }
}

afterEach(() => {
  window.localStorage.clear()
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
