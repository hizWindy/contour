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
import { api, isApiProblem, isSignInNeeded, unwrap, type ApiProblem } from '../client'
import { queryKeys, retryDelay, shouldRetry } from '../query'
import type { Schemas } from '../types'

export type SignedInUser = Schemas['UserOut']

export type SignIn =
  /** Sign-in is off on this backend: everyone may use it, and there is nothing to sign out of. */
  | { state: 'off'; liveVoice?: boolean }
  | {
      state: 'signed_in'
      user: SignedInUser
      platformAdminName?: string | null
      firstSignIn?: boolean
      /**
       * Live voice may start for me now (PLAN-V28, `MeOut.live_voice`). Left out: not known, as
       * just after signing in (the sign-in's answer doesn't carry it), so the free mic.
       */
      liveVoice?: boolean
    }
  /** No session. `reason` and `detail` say why one ended, when one did. */
  | { state: 'signed_out'; reason: string | null; detail: string | null }

/** Live voice may start for this person now (PLAN-V28 T2-3). Not known: no. */
export function liveVoiceOf(signIn: SignIn | undefined): boolean {
  return signIn?.state === 'off' || signIn?.state === 'signed_in'
    ? signIn.liveVoice === true
    : false
}

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
        // Live voice (PLAN-V28): kept only when it is on, so every other answer reads as before.
        const live = me.live_voice === true ? { liveVoice: true } : {}
        if (!me.auth_required) return { state: 'off', ...live }
        return me.user
          ? {
              state: 'signed_in',
              user: me.user,
              ...(me.platform_admin_name ? { platformAdminName: me.platform_admin_name } : {}),
              ...(me.first_sign_in ? { firstSignIn: me.first_sign_in } : {}),
              ...live,
            }
          : { state: 'signed_out', reason: null, detail: null }
      } catch (error) {
        if (isSignInNeeded(error)) return signedOutBy(error)
        // A backend with no sign-in routes at all (before PLAN-V6) has no sign-in.
        if (isApiProblem(error) && error.status === 404) return { state: 'off' }
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

/** What a page keeps for a person outside the query cache, forgotten when they sign out. */
const signOutSteps = new Set<(userId: string) => void>()

/**
 * Runs `step` with the person's id when they sign out of this browser ("Sign out"). A page's own
 * code adds its step when it loads, like the call note drafts (PLAN-V17 T3-8). Returns a function
 * that takes the step away again.
 */
export function onSignOut(step: (userId: string) => void): () => void {
  signOutSteps.add(step)
  return () => {
    signOutSteps.delete(step)
  }
}

function runSignOutSteps(userId: string): void {
  for (const step of signOutSteps) {
    try {
      step(userId)
    } catch {
      // A step that fails never stops the sign-out.
    }
  }
}

/**
 * Signs in (`POST /auth/login`). The cookie is set by the answer; the page never sees it. The
 * answer says whether live voice may start (PLAN-V28, `LoginOut.live_voice`, as who-am-I does), so
 * the first V after signing in knows it at once.
 */
export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation<SignedInUser, ApiProblem, LoginBody>({
    mutationFn: async (body) => {
      const answer = unwrap(await api.POST('/auth/login', { body }))
      startOver(queryClient, {
        state: 'signed_in',
        user: answer.user,
        ...(answer.platform_admin_name ? { platformAdminName: answer.platform_admin_name } : {}),
        ...(answer.first_sign_in ? { firstSignIn: answer.first_sign_in } : {}),
        ...(answer.live_voice === true ? { liveVoice: true } : {}),
      })
      return answer.user
    },
  })
}

export type ChangePasswordBody = Schemas['ChangePasswordIn']

/**
 * Changes the signed-in person's password (`POST /auth/password`). The backend ends all other
 * sessions and clears any first-sign-in prompt.
 */
export function useChangePassword() {
  const queryClient = useQueryClient()
  return useMutation<undefined, ApiProblem, ChangePasswordBody>({
    mutationFn: async (body) => {
      unwrap(await api.POST('/auth/password', { body }))
      return undefined
    },
    onSuccess: () => {
      const current = queryClient.getQueryData<SignIn>(queryKeys.auth.me())
      if (current?.state === 'signed_in') {
        const next: SignIn = { state: 'signed_in', user: current.user }
        if (current.platformAdminName !== undefined) {
          next.platformAdminName = current.platformAdminName
        }
        queryClient.setQueryData(queryKeys.auth.me(), next)
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me() })
    },
  })
}

/**
 * Signs this browser out (`POST /auth/logout`). Whatever the answer, the page forgets the user,
 * and each `onSignOut` step runs for the person who pressed it.
 */
export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation<undefined, ApiProblem, undefined, { userId: string | null }>({
    mutationFn: async () => {
      unwrap(await api.POST('/auth/logout'))
      return undefined
    },
    // Who is signing out, read as they press it, before anything changes "who is signed in".
    onMutate: () => {
      const signIn = queryClient.getQueryData<SignIn>(queryKeys.auth.me())
      return { userId: signIn?.state === 'signed_in' ? signIn.user.id : null }
    },
    onSettled: (_data, _error, _variables, started) => {
      if (started?.userId) runSignOutSteps(started.userId)
      startOver(queryClient, { state: 'signed_out', reason: 'signed_out', detail: null })
    },
  })
}
