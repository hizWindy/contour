import { onlineManager, useQuery, type QueryClient } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, unwrap } from '@/api/client'
import { meQueryOptions } from '@/api/hooks'
import { queryKeys } from '@/api/query'
import { LEAD_FINDER } from '@/apps/lead-finder/module'
import LoginPage from '@/auth/login-page'
import {
  loginOk,
  SAMPLE_USER,
  signedIn,
  signedOut,
  signInOff,
  stubAuthBackend,
} from '@/test/fake-auth'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { RequireSignIn } from './require-sign-in'
import { UserMenu } from './user-menu'
import { visibleModules } from './visible-modules'

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
function renderApp(start: string, queryClient?: QueryClient) {
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
  return renderWithProviders(<RouterProvider router={router} />, { withRouter: false, queryClient })
}

const address = () => screen.getByTestId('address')

describe('the app knows who is signed in', () => {
  it('asks once when main.tsx started the question before the first draw (PLAN-V7 C1)', async () => {
    const backend = stubAuthBackend({ me: signedIn() })
    const queryClient = createTestQueryClient()
    void queryClient.prefetchQuery(meQueryOptions())

    renderApp('/', queryClient)

    expect(await screen.findByText('Home')).toBeInTheDocument()
    expect(backend.calls.filter((call) => call.path === '/auth/me')).toHaveLength(1)
  })

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

  it('shows who is signed in, and Sign out in its menu ends the session and says so', async () => {
    const backend = stubAuthBackend({
      me: signedIn(),
      other: (url) =>
        url.pathname.endsWith('/lead-finder/leads')
          ? Response.json({ total: 0, items: [] })
          : undefined,
    })
    const { user } = renderApp('/results')

    expect(await screen.findByText('The results')).toBeInTheDocument()
    const account = screen.getByRole('button', { name: `Account menu, ${SAMPLE_USER.name}` })
    expect(account).toHaveTextContent(SAMPLE_USER.name)
    expect(screen.queryByRole('menuitem', { name: 'Sign out' })).toBeNull() // shut until opened

    backend.handlers.me = signedOut()
    await user.click(account)
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }))

    expect(await screen.findByRole('status')).toHaveTextContent('You signed out.')
    expect(address()).toHaveTextContent('/login?next=%2Fresults&reason=signed_out')
    expect(
      backend.calls.some((call) => call.method === 'POST' && call.path === '/auth/logout'),
    ).toBe(true)
    expect(screen.queryByRole('button', { name: /^Account menu/ })).toBeNull()
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

    // The app's shape (also a status) shows first, while the backend answers.
    expect(await screen.findByText('You were signed out after 2 hours idle.')).toBeInTheDocument()
    expect(address()).toHaveTextContent('/login?next=%2Fresults&reason=idle')
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })

  it('with sign-in off, the page shows with no account menu and no redirect', async () => {
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
    expect(screen.queryByRole('button', { name: /^Account menu/ })).toBeNull()
  })
})

describe('no app without a user (PLAN-V15 T2-5, the account menu that disappeared)', () => {
  afterEach(() => {
    onlineManager.setOnline(true)
  })

  const leadsOk = (url: URL) =>
    url.pathname.endsWith('/lead-finder/leads') ? Response.json({ total: 0, items: [] }) : undefined

  it('a /auth/me that fails once still ends with the account menu showing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let failures = 1
    stubAuthBackend({
      me: () => {
        if (failures > 0) {
          failures -= 1
          throw new TypeError('Failed to fetch')
        }
        return signedIn()
      },
      other: leadsOk,
    })
    renderApp('/results')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(await screen.findByText('The results')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: `Account menu, ${SAMPLE_USER.name}` }),
    ).toBeInTheDocument()
  })

  it('one that keeps failing shows Connection lost, not the app, and comes back by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let up = false
    const backend = stubAuthBackend({
      me: () => {
        if (!up) throw new TypeError('Failed to fetch')
        return signedIn()
      },
      other: (url) => {
        if (!up) throw new TypeError('Failed to fetch')
        return url.pathname.endsWith('/health') ? Response.json({ status: 'ok' }) : leadsOk(url)
      },
    })
    renderApp('/results')

    // Asked three times (two retries, 1 s then 2 s apart), then the page says why.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(
      await screen.findByRole('heading', { level: 1, name: "Contour can't reach its server" }),
    ).toBeInTheDocument()
    expect(backend.calls.filter((call) => call.path === '/auth/me')).toHaveLength(3)
    expect(screen.queryByText('The results')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Account menu/ })).toBeNull()

    up = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })

    expect(await screen.findByText('The results')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: `Account menu, ${SAMPLE_USER.name}` }),
    ).toBeInTheDocument()
  })

  it('a deploy shows Updating', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    stubAuthBackend({ me: () => new Response('upstream connect error', { status: 503 }) })
    renderApp('/results')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Contour is updating' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('The results')).toBeNull()
  })

  it("offline before the first answer says you're offline, and carries on when back", async () => {
    onlineManager.setOnline(false)
    stubAuthBackend({ me: signedIn(), other: leadsOk })
    renderApp('/results')

    expect(
      await screen.findByRole('heading', { level: 1, name: "You're offline" }),
    ).toBeInTheDocument()

    act(() => {
      onlineManager.setOnline(true)
    })

    expect(await screen.findByText('The results')).toBeInTheDocument()
  })

  it('a check that fails later keeps the app and its menu', async () => {
    const backend = stubAuthBackend({ me: signedIn(), other: leadsOk })
    const queryClient = createTestQueryClient()
    renderApp('/results', queryClient)
    expect(await screen.findByText('The results')).toBeInTheDocument()

    backend.handlers.me = () => {
      throw new TypeError('Failed to fetch')
    }
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: queryKeys.auth.me() }).catch(() => undefined)
    })

    expect(screen.getByText('The results')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: `Account menu, ${SAMPLE_USER.name}` }),
    ).toBeInTheDocument()
  })

  it('offers no project in the menu while access is not known', () => {
    expect(visibleModules(undefined, [LEAD_FINDER])).toEqual([])
    expect(
      visibleModules({ state: 'signed_out', reason: null, detail: null }, [LEAD_FINDER]),
    ).toEqual([])
    expect(visibleModules({ state: 'off' }, [LEAD_FINDER])).toEqual([LEAD_FINDER])
  })
})
