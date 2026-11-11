/**
 * A page whose code fails to load (a new build replaced the old files, or the dev server's
 * "Outdated Optimize Dep") never leaves a blank area (PLAN-V15 T2-4):
 * - online, it reloads once by itself to get the new version;
 * - if its code still fails within a minute, it says "Contour was updated" with a Reload button;
 * - offline, it says so, and reloads once the connection is back.
 * The Results page's module is made to fail here; the rest of the app is real.
 */
import { onlineManager } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browser } from '@/lib/reload'
import { routes } from '@/router'
import { loadCode } from '@/shell/preload'
import { renderWithProviders } from '@/test/render'

vi.mock('@/apps/lead-finder/results', () => {
  throw new TypeError(
    'Failed to fetch dynamically imported module: http://localhost:5173/src/apps/lead-finder/results/index.tsx',
  )
})

const LAZY = 5000

beforeEach(() => {
  window.sessionStorage.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(Response.json({ title: 'Not found', status: 404 }, { status: 404 })),
    ),
  )
})

afterEach(() => {
  onlineManager.setOnline(true)
})

function renderResults() {
  const router = createMemoryRouter(routes, { initialEntries: ['/results'] })
  return renderWithProviders(<RouterProvider router={router} />, { withRouter: false })
}

describe('a page whose code fails to load', () => {
  it('never reloads from a quiet preload: only when the page is opened', async () => {
    const reload = vi.spyOn(browser, 'reload').mockImplementation(() => undefined)

    await loadCode(routes, ['/results'])

    expect(reload).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem('contour.reloaded-for-new-code')).toBeNull()
  })

  it('reloads once by itself to get the new version, and keeps the menu', async () => {
    const reload = vi.spyOn(browser, 'reload').mockImplementation(() => undefined)
    renderResults()

    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Contour was updated' },
        { timeout: LAZY },
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Reloading…')).toBeInTheDocument()
    expect(reload).toHaveBeenCalledOnce()
    expect(screen.getByRole('navigation', { name: 'Main menu' })).toBeInTheDocument()
  })

  it('says "Contour was updated" with a Reload button when the reload did not help', async () => {
    window.sessionStorage.setItem('contour.reloaded-for-new-code', String(Date.now()))
    const reload = vi.spyOn(browser, 'reload').mockImplementation(() => undefined)
    const { user } = renderResults()

    const alert = await screen.findByRole('alert', {}, { timeout: LAZY })
    expect(within(alert).getByRole('heading', { level: 1 })).toHaveTextContent(
      'Contour was updated',
    )
    expect(reload).not.toHaveBeenCalled()
    await user.click(within(alert).getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledOnce()
    expect(screen.getByRole('navigation', { name: 'Main menu' })).toBeInTheDocument()
  })

  it('says "offline" when the code could not come, and reloads when the connection is back', async () => {
    const reload = vi.spyOn(browser, 'reload').mockImplementation(() => undefined)
    const router = createMemoryRouter(routes, { initialEntries: ['/rules'] })
    renderWithProviders(<RouterProvider router={router} />, { withRouter: false })
    await screen.findByRole('heading', { level: 1, name: 'Rules' }, { timeout: LAZY })

    act(() => {
      onlineManager.setOnline(false)
    })
    await act(async () => {
      await router.navigate('/results')
    })

    expect(
      await screen.findByRole('heading', { level: 1, name: "You're offline" }, { timeout: LAZY }),
    ).toBeInTheDocument()
    expect(reload).not.toHaveBeenCalled()

    act(() => {
      onlineManager.setOnline(true)
    })

    await waitFor(() => {
      expect(reload).toHaveBeenCalledOnce()
    })
  })
})
