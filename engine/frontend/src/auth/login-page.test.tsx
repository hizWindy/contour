import { screen, waitFor } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import {
  INVALID_LOGIN,
  loginOk,
  signedIn,
  signedOut,
  signInOff,
  stubAuthBackend,
  tooManyTries,
  wrongLogin,
} from '@/test/fake-auth'
import { renderWithProviders } from '@/test/render'
import { FAILED_TEXT, REMEMBER_KEY, safeNext } from './login-form'
import LoginPage from './login-page'

function Here() {
  const location = useLocation()
  return <output aria-label="Address">{`${location.pathname}${location.search}`}</output>
}

/** Opens `route` (with `state`, what a redirect hands over) in a memory router. */
function renderPage(route = '/login', state?: unknown) {
  const [pathname = '/login', search = ''] = route.split('?')
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="*"
        element={
          <>
            <p>The app</p>
            <Here />
          </>
        }
      />
    </Routes>,
    { initialEntries: [{ pathname, search: search ? `?${search}` : '', state }] },
  )
}

const identifier = () => screen.getByLabelText('Email or username')
const password = () => screen.getByLabelText('Password')

afterEach(() => {
  window.localStorage.clear()
})

describe('the login page', () => {
  it('signs in, goes back to the page the person was on, and remembers only the login', async () => {
    const backend = stubAuthBackend({ me: signedOut(), login: loginOk() })
    const { user } = renderPage('/login?next=%2Fresults%3Fcity%3DPerth')

    await user.type(await screen.findByLabelText('Email or username'), 'alkhair')
    await user.click(screen.getByRole('checkbox', { name: /Keep me signed in/ }))
    await user.type(password(), 'a long phrase of words{Enter}')

    expect(await screen.findByText('The app')).toBeInTheDocument()
    expect(screen.getByLabelText('Address')).toHaveTextContent('/results?city=Perth')
    const sent = backend.calls.find((call) => call.path === '/auth/login')
    expect(sent).toEqual({
      method: 'POST',
      path: '/auth/login',
      body: { login: 'alkhair', password: 'a long phrase of words', keep_signed_in: true },
    })
    expect(window.localStorage.getItem(REMEMBER_KEY)).toBe('alkhair')
    expect(JSON.stringify({ ...window.localStorage })).not.toContain('a long phrase')
  })

  it('signs in by keyboard alone, in the order a person reads the page', async () => {
    stubAuthBackend({ me: signedOut(), login: loginOk() })
    const { user } = renderPage()

    expect(await screen.findByLabelText('Email or username')).toHaveFocus()
    await user.keyboard('alkhair')
    await user.tab()
    expect(password()).toHaveFocus()
    await user.keyboard('a long phrase of words')
    await user.tab()
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('checkbox', { name: /Keep me signed in/ })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(await screen.findByText('The app')).toBeInTheDocument()
    expect(screen.getByLabelText('Address')).toHaveTextContent(/^\/$/)
  })

  it('a wrong login or password: the same words for both, and the person stays here', async () => {
    stubAuthBackend({ me: signedOut(), login: wrongLogin() })
    const { user } = renderPage()

    await user.type(await screen.findByLabelText('Email or username'), 'alkhair')
    await user.type(password(), 'not the right one{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent(INVALID_LOGIN)
    expect(password()).toHaveValue('')
    expect(password()).toHaveFocus()
    expect(identifier()).toHaveValue('alkhair')
    expect(screen.queryByText('The app')).toBeNull()
  })

  it('a wrong try that makes the next one wait says how long', async () => {
    stubAuthBackend({ me: signedOut(), login: wrongLogin(4) })
    const { user } = renderPage()

    await user.type(await screen.findByLabelText('Email or username'), 'alkhair')
    await user.type(password(), 'not the right one{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      `${INVALID_LOGIN} Wait 4 seconds before you try again.`,
    )
  })

  it('too many tries: says how long to wait', async () => {
    stubAuthBackend({ me: signedOut(), login: tooManyTries(720) })
    const { user } = renderPage()

    await user.type(await screen.findByLabelText('Email or username'), 'alkhair')
    await user.type(password(), 'a long phrase of words{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many tries. Try again in 12 minutes.',
    )
  })

  it('no answer: says nothing changed', async () => {
    const backend = stubAuthBackend({
      me: signedOut(),
      login: () => {
        throw new TypeError('Failed to fetch')
      },
    })
    const { user } = renderPage()

    await user.type(await screen.findByLabelText('Email or username'), 'alkhair')
    await user.type(password(), 'a long phrase of words{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent(FAILED_TEXT)
    expect(backend.calls.some((call) => call.path === '/auth/login')).toBe(true)
  })

  it("says why the person is here, in the backend's own words", async () => {
    stubAuthBackend({ me: signedOut() })
    renderPage('/login?reason=idle', { notice: 'You were signed out after 3 hours idle.' })

    expect(await screen.findByRole('status')).toHaveTextContent(
      'You were signed out after 3 hours idle.',
    )
  })

  it('says why when the backend says the session ended, with no reason in the address', async () => {
    stubAuthBackend({
      me: signedOut('expired', 'Your session ended after 12 hours. Sign in again.'),
    })
    renderPage()

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Your session ended after 12 hours. Sign in again.',
    )
  })

  it('starts in the password field with the login remembered on this device', async () => {
    window.localStorage.setItem(REMEMBER_KEY, 'alkhair')
    stubAuthBackend({ me: signedOut() })
    renderPage()

    expect(await screen.findByLabelText('Email or username')).toHaveValue('alkhair')
    expect(password()).toHaveFocus()
  })

  it('someone already signed in goes straight on', async () => {
    stubAuthBackend({ me: signedIn() })
    renderPage('/login?next=%2Fruns')

    expect(await screen.findByText('The app')).toBeInTheDocument()
    expect(screen.getByLabelText('Address')).toHaveTextContent('/runs')
  })

  it('with sign-in off on this backend, there is no sign-in page', async () => {
    stubAuthBackend({ me: signInOff() })
    renderPage()

    expect(await screen.findByText('The app')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByLabelText('Password')).toBeNull()
    })
  })
})

describe('where to go after signing in', () => {
  it.each([
    ['/results?city=Perth', '/results?city=Perth'],
    ['/leads/1#facts', '/leads/1#facts'],
    [null, '/'],
    ['', '/'],
    ['https://evil.example', '/'],
    ['//evil.example/path', '/'],
    ['/\\evil.example', '/'],
    ['javascript:alert(1)', '/'],
    ['/login', '/'],
    ['/login?next=%2F', '/'],
  ])('%s goes to %s', (next, expected) => {
    expect(safeNext(next)).toBe(expected)
  })
})
