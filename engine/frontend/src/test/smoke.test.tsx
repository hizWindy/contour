import { screen } from '@testing-library/react'
import { createMemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { App } from '@/App'
import { routes } from '@/router'
import { renderWithProviders } from './render'

describe('App', () => {
  it('starts on Start a run, inside the menu and the top bar', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/'] })
    renderWithProviders(<App router={router} />, { withRouter: false })

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Start a run' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Lead Finder')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show or hide the menu' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Go to a page/ })).toBeInTheDocument()
  })
})
