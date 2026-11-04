/**
 * The sign-in page, `/login` (PLAN-V6 C2), outside the app frame. It draws `LoginView` and wires
 * it to the backend:
 *
 * - It asks who is signed in first. Someone already signed in goes straight on; with sign-in off
 *   on this backend (the laptop's default) there is nothing to sign in to, so it goes home.
 * - "Sign in" sends `POST /auth/login`. The answer sets the cookie; the page never sees a token.
 *   A wrong login or password, too many tries, and no answer each show their own words, the
 *   backend's sentence where it sent one.
 * - Afterwards it goes back to `?next=` (the page the person was on, checked by `safeNext`) and
 *   remembers the email or username on this device (never the password).
 * - `?reason=` (or the session the backend says ended) shows why the person is here: signed out
 *   after idle time, after the longest session, elsewhere, or by their own click.
 */
import { useState } from 'react'
import { Navigate, useLocation, useSearchParams } from 'react-router'
import { useLogin, useMe } from '@/api/hooks'
import {
  noticeOf,
  rememberedLogin,
  rememberLogin,
  safeNext,
  statusOfProblem,
  type LoginStatus,
  type LoginValues,
} from './login-form'
import { LoginView } from './login-view'

/** The backend's own sentence, handed over by the page that sent the person here. */
function noticeFromState(state: unknown): string | null {
  if (typeof state === 'object' && state !== null && 'notice' in state) {
    const notice = state.notice
    return typeof notice === 'string' && notice.trim() !== '' ? notice : null
  }
  return null
}

export default function LoginPage() {
  const [params] = useSearchParams()
  const location = useLocation()
  const me = useMe()
  const login = useLogin()
  const [status, setStatus] = useState<LoginStatus>({ kind: 'ready' })
  const [remembered] = useState(rememberedLogin)
  const next = safeNext(params.get('next'))

  if (me.data?.state === 'signed_in') {
    return <Navigate to={next} replace />
  }
  if (me.data?.state === 'off') {
    return <Navigate to={next} replace />
  }
  if (me.isPending) {
    // A moment while the backend says who is signed in: the page's own colour, no flash of a form.
    return <div className="min-h-dvh bg-background" aria-busy="true" />
  }

  const ended = me.data?.state === 'signed_out' ? me.data : null
  const notice = noticeOf(params.get('reason')) ?? noticeOf(ended?.reason)
  const noticeText =
    noticeFromState(location.state) ?? (notice && notice === ended?.reason ? ended.detail : null)

  const submit = (values: LoginValues): void => {
    setStatus({ kind: 'signing_in' })
    login.mutate(
      { login: values.identifier, password: values.password, keep_signed_in: values.keepSignedIn },
      {
        // The page then moves on by itself: "who is signed in" now says signed in.
        onSuccess: () => {
          rememberLogin(values.identifier)
        },
        onError: (error) => {
          setStatus(statusOfProblem(error))
        },
      },
    )
  }

  return (
    <LoginView
      status={status}
      onSubmit={submit}
      notice={notice}
      noticeText={noticeText}
      rememberedIdentifier={remembered}
    />
  )
}
