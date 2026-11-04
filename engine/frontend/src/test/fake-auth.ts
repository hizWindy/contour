/**
 * A stand-in for the backend's sign-in routes (`/auth/me`, `/auth/login`, `/auth/logout`), for
 * the login page and sign-in guard tests. Each answer has the backend's own shape and words.
 *
 *     const backend = stubAuthBackend({ me: signedOut() })
 *     ... after the test: backend.calls lists every request, with its JSON body.
 *
 * `me` and `login` can be a Response, or a function of the request for answers that change.
 */
import { vi } from 'vitest'

export const SAMPLE_USER = {
  id: '11111111-2222-3333-4444-555555555555',
  email: 'admin@example.test',
  username: 'admin',
  name: 'Sample Admin',
  role: 'admin' as const,
}

export const INVALID_LOGIN = "That email or password isn't right."

export function signedOut(reason: string | null = null, detail?: string): Response {
  return Response.json(
    {
      title: 'Sign in needed',
      status: 401,
      detail: detail ?? 'Sign in to use Contour HQ.',
      code: 'auth_required',
      reason,
    },
    { status: 401 },
  )
}

export function signedIn(user = SAMPLE_USER): Response {
  return Response.json({ auth_required: true, user, session: null })
}

export function signInOff(): Response {
  return Response.json({ auth_required: false, user: null, session: null })
}

export function loginOk(user = SAMPLE_USER): Response {
  return Response.json({ user, session: { id: 'session-1', current: true } })
}

export function wrongLogin(waitSeconds: number | null = null): Response {
  return Response.json(
    {
      title: 'Sign-in failed',
      status: 401,
      detail: INVALID_LOGIN,
      code: 'invalid_credentials',
      retry_after_seconds: waitSeconds,
    },
    { status: 401 },
  )
}

export function tooManyTries(seconds: number): Response {
  return Response.json(
    {
      title: 'Too many tries',
      status: 429,
      detail: 'Too many tries. Try again in 12 minutes.',
      code: 'too_many_attempts',
      retry_after_seconds: seconds,
    },
    { status: 429, headers: { 'Retry-After': String(seconds) } },
  )
}

type Answer = Response | ((request: Request) => Response | Promise<Response>)

export interface AuthHandlers {
  me: Answer
  login?: Answer
  logout?: Answer
  /** Any other path. Return undefined for a 404. */
  other?: (url: URL, request: Request) => Response | Promise<Response> | undefined
}

export interface AuthCall {
  method: string
  path: string
  body: unknown
}

export interface AuthBackend {
  calls: AuthCall[]
  /** Change an answer mid-test, like "me" after a sign-in. */
  handlers: AuthHandlers
}

async function answer(value: Answer, request: Request): Promise<Response> {
  // A Response can be read once, so each call gets its own copy.
  return typeof value === 'function' ? value(request) : value.clone()
}

export function stubAuthBackend(handlers: AuthHandlers): AuthBackend {
  const backend: AuthBackend = { calls: [], handlers }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const url = new URL(request.url)
      const path = url.pathname.replace(/^\/api\/v1/, '')
      const text = request.method === 'GET' ? '' : await request.clone().text()
      backend.calls.push({
        method: request.method,
        path,
        body: text ? (JSON.parse(text) as unknown) : null,
      })
      const now = backend.handlers
      if (path === '/auth/me') return answer(now.me, request)
      if (path === '/auth/login' && now.login) return answer(now.login, request)
      if (path === '/auth/logout')
        return answer(now.logout ?? new Response(null, { status: 204 }), request)
      const other = await now.other?.(url, request)
      return other ?? Response.json({ title: 'Not found', status: 404 }, { status: 404 })
    }),
  )
  return backend
}
