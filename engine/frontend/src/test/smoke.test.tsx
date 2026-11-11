import { screen } from '@testing-library/react'
import { createMemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '@/App'
import { routes } from '@/router'
import { renderWithProviders } from './render'

// No backend here: every call answers 404. "Who is signed in" then means no sign-in, so the app
// shows (with no answer at all, it would say it can't reach the server, PLAN-V15 T2-5).
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(Response.json({ title: 'Not found', status: 404 }, { status: 404 })),
    ),
  )
})

describe('App', () => {
  it('starts on Home, inside the menu and the top bar', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/'] })
    renderWithProviders(<App router={router} />, { withRouter: false })

    // The page loads its code on first use; a busy test run can take more than the default second.
    expect(
      await screen.findByRole(
        'heading',
        // Home's title is the greeting, which follows the clock.
        { level: 1, name: /^Good (morning|afternoon|evening)/ },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Contour')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Lead Finder' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show or hide the menu' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Go to a page/ })).toBeInTheDocument()
  })
})
