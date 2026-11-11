/**
 * Who is signed in, signing in and signing out (PLAN-V6 C2, C3). The contract is the backend's
 * `/auth/*` routes (B3):
 *
 * - `GET /auth/me`: `auth_required: false` means sign-in is off on this backend (the laptop's
 *   default), so there is no sign-in page and no "Sign out". With sign-in on, no session is a 401
 *   `auth_required`, whose `reason` says why a session ended (`idle`, `expired`, `ended`).
 * - `POST /auth/login` sets the session cookie. A wrong login or password is a 401
 *   `invalid_credentials`; too many tries is a 429 `too_many_attempts`. Both may say how long to
 *   wait (`retry_after_seconds`).
 * - `POST /auth/logout` ends this browser's session.
 *
 * `useMe` turns the answer into one of three states, so the app never has to read a 401 itself.
 */
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { api, isSignInNeeded, unwrap, type ApiProblem } from '../client'
import { queryKeys, retryDelay, shouldRetry } from '../query'
import type { Schemas } from '../types'

export type SignedInUser = Schemas['UserOut']

export type SignIn =
  /** Sign-in is off on this backend: everyone may use it, and there is nothing to sign out of. */
  | { state: 'off' }
  | { state: 'signed_in'; user: SignedInUser }
  /** No session. `reason` and `detail` say why one ended, when one did. */
  | { state: 'signed_out'; reason: string | null; detail: string | null }

/** The state for a 401 `auth_required` from any route. */
export function signedOutBy(problem: ApiProblem): SignIn {
  return { state: 'signed_out', reason: problem.reason, detail: problem.detail }
}

/**
 * Who is signed in. A 401 is an answer, not a failure (`signed_out`). A network error, a time
 * limit or a 5xx is retried like any read (PLAN-V15 T2-2): one failed answer during a deploy used
 * to leave the app with no account menu until a reload. It is also asked again when the connection
 * comes back (`connection.ts` runs the failed reads again).
 *
 * A failed answer is not asked again when another part mounts (`retryOnMount: false`): the
 * sign-in guard and the account menu both read it, and asking again would hide the page, show it,
 * and ask again, forever.
 */
export function meQueryOptions() {
  return queryOptions<SignIn, ApiProblem>({
    queryKey: queryKeys.auth.me(),
    queryFn: async ({ signal }) => {
      try {
        const me = unwrap(await api.GET('/auth/me', { signal }))
        if (!me.auth_required) return { state: 'off' }
        return me.user
          ? { state: 'signed_in', user: me.user }
          : { state: 'signed_out', reason: null, detail: null }
      } catch (error) {
        if (isSignInNeeded(error)) return signedOutBy(error)
        throw error
      }
    },
    retry: shouldRetry,
    retryDelay,
    retryOnMount: false,
    staleTime: 60_000,
  })
}

export function useMe() {
  return useQuery(meQueryOptions())
}

export interface LoginBody {
  login: string
  password: string
  keep_signed_in: boolean
}

/**
 * Starts afresh after a sign-in or a sign-out: every saved answer was for someone else (or for
 * no one), so nothing of it is kept. Only "who is signed in" is set straight away.
 */
function startOver(queryClient: QueryClient, signIn: SignIn): void {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' })
  queryClient.setQueryData(queryKeys.auth.me(), signIn)
}

/** Signs in (`POST /auth/login`). The cookie is set by the answer; the page never sees it. */
export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation<SignedInUser, ApiProblem, LoginBody>({
    mutationFn: async (body) => unwrap(await api.POST('/auth/login', { body })).user,
    onSuccess: (user) => {
      startOver(queryClient, { state: 'signed_in', user })
    },
  })
}

/** Signs this browser out (`POST /auth/logout`). Whatever the answer, the page forgets the user. */
export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation<undefined, ApiProblem, undefined>({
    mutationFn: async () => {
      unwrap(await api.POST('/auth/logout'))
      return undefined
    },
    onSettled: () => {
      startOver(queryClient, { state: 'signed_out', reason: 'signed_out', detail: null })
    },
  })
}
