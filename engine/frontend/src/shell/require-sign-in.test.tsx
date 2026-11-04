import { useQuery } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { api, unwrap } from '@/api/client'
import LoginPage from '@/auth/login-page'
import {
  loginOk,
  SAMPLE_USER,
  signedIn,
  signedOut,
  signInOff,
  stubAuthBackend,
} from '@/test/fake-auth'
import { renderWithProviders } from '@/test/render'
import { RequireSignIn } from './require-sign-in'
import { UserMenu } from './user-menu'

function Here() {
  const location = useLocation()
  return <span data-testid="address">{`${location.pathname}${location.search}`}</span>
}

/** A page that reads the leads, like Results does. */
function Results() {
  const leads = useQuery({
    queryKey: ['leads', 'test'],
    queryFn: async ({ signal }) => unwrap(await api.GET('/lead-finder/leads', { signal })),
  })
  return <p>{leads.isError ? 'The leads failed' : 'The results'}</p>
}

/** The app as the guard sees it: the login page, and pages inside the guard with the top bar's menu. */
function renderApp(start: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/login',
        element: (
          <>
            <LoginPage />
            <Here />
          </>
        ),
      },
      {
        path: '/',
        element: (
          <RequireSignIn>
            <UserMenu />
            <Outlet />
            <Here />
          </RequireSignIn>
        ),
        children: [
          { index: true, element: <p>Home</p> },
          { path: 'results', element: <Results /> },
        ],
      },
    ],
    { initialEntries: [start] },
  )
  return renderWithProviders(<RouterProvider router={router} />, { withRouter: false })
}

const address = () => screen.getByTestId('address')

describe('the app knows who is signed in', () => {
  it('sends a signed-out visit to the login page, then back to where the person was', async () => {
    const backend = stubAuthBackend({ me: signedOut(), login: loginOk() })
    const { user } = renderApp('/results?city=Perth')

    await waitFor(() => {
      expect(address()).toHaveTextContent('/login?next=%2Fresults%3Fcity%3DPerth')
    })
    expect(screen.queryByText('The results')).toBeNull() // no flash of the page
    backend.handlers.me = signedIn()

    await user.type(await screen.findByLabelText('Email or username'), 'admin')
    await user.type(screen.getByLabelText('Password'), 'a long phrase of words{Enter}')

    expect(await screen.findByText('The results')).toBeInTheDocument()
    expect(address()).toHaveTextContent('/results?city=Perth')
  })

  it('shows who is signed in, and Sign out ends the session and says so', async () => {
    const backend = stubAuthBackend({
      me: signedIn(),
      other: (url) =>
        url.pathname.endsWith('/lead-finder/leads')
          ? Response.json({ total: 0, items: [] })
          : undefined,
    })
    const { user } = renderApp('/results')

    expect(await screen.findByText('The results')).toBeInTheDocument()
    expect(screen.getByText(SAMPLE_USER.name)).toBeInTheDocument()
    expect(screen.getByText('Signed in as')).toHaveClass('sr-only')

    backend.handlers.me = signedOut()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('status')).toHaveTextContent('You signed out.')
    expect(address()).toHaveTextContent('/login?next=%2Fresults&reason=signed_out')
    expect(
      backend.calls.some((call) => call.method === 'POST' && call.path === '/auth/logout'),
    ).toBe(true)
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
  })

  it('a session that ends while a page is open goes to the login page and says why', async () => {
    stubAuthBackend({
      me: signedIn(),
      other: (url) =>
        url.pathname.endsWith('/lead-finder/leads')
          ? signedOut('idle', 'You were signed out after 2 hours idle.')
          : undefined,
    })
    renderApp('/results')

    expect(await screen.findByRole('status')).toHaveTextContent(
      'You were signed out after 2 hours idle.',
    )
    expect(address()).toHaveTextContent('/login?next=%2Fresults&reason=idle')
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })

  it('with sign-in off, the page shows with no Sign out and no redirect', async () => {
    stubAuthBackend({
      me: signInOff(),
      other: (url) =>
        url.pathname.endsWith('/lead-finder/leads')
          ? Response.json({ total: 0, items: [] })
          : undefined,
    })
    renderApp('/results')

    expect(await screen.findByText('The results')).toBeInTheDocument()
    expect(address()).toHaveTextContent('/results')
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
  })

  it("if the backend can't be reached, the page shows and its own errors say so", async () => {
    const backend = stubAuthBackend({
      me: () => {
        throw new TypeError('Failed to fetch')
      },
      other: () => {
        throw new TypeError('Failed to fetch')
      },
    })
    renderApp('/results')

    expect(await screen.findByText('The leads failed')).toBeInTheDocument()
    expect(address()).toHaveTextContent('/results')
    // Asked once, not again and again: a failed answer doesn't hide the page and ask once more.
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(backend.calls.filter((call) => call.path === '/auth/me')).toHaveLength(1)
    expect(screen.getByText('The leads failed')).toBeInTheDocument()
  })
})
