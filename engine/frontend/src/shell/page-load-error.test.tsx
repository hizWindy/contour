/**
 * A page whose code fails to load (the dev server's "Outdated Optimize Dep", or a new build
 * replacing the old files) shows the error page with a reload button inside the app frame, never a
 * blank area. The Results page's module is made to fail here; the rest of the app is real.
 */
import { screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/router'
import { renderWithProviders } from '@/test/render'

vi.mock('@/apps/lead-finder/results', () => {
  throw new TypeError(
    'Failed to fetch dynamically imported module: http://localhost:5173/src/apps/lead-finder/results/index.tsx',
  )
})

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(Response.json({ title: 'Not found', status: 404 }, { status: 404 })),
    ),
  )
})

describe('a page whose code fails to load', () => {
  it('shows the error page with a reload button, and keeps the menu', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/results'] })
    renderWithProviders(<RouterProvider router={router} />, { withRouter: false })

    const alert = await screen.findByRole('alert', {}, { timeout: 5000 })
    expect(alert).toHaveTextContent("This page couldn't be shown")
    expect(within(alert).getByRole('button', { name: 'Reload the page' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main menu' })).toBeInTheDocument()
  })
})
