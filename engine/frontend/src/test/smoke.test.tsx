import { screen } from '@testing-library/react'
import { createMemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { App } from '@/App'
import { routes } from '@/router'
import { renderWithProviders } from './render'

describe('App', () => {
  it('starts on Home, inside the menu and the top bar', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/'] })
    renderWithProviders(<App router={router} />, { withRouter: false })

    // The page loads its code on first use; a busy test run can take more than the default second.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Home' }, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(screen.getByText('Contour')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Lead Finder' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show or hide the menu' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Go to a page/ })).toBeInTheDocument()
  })
})
