/**
 * The app knows who is signed in (PLAN-V6 C3, PLAN-V15 T2-5). Around the app frame:
 *
 * - It asks the backend who is signed in (`useMe`). With sign-in off (the laptop's default) or a
 *   good session, the page shows as before.
 * - Signed out, it goes to `/login?next=<this page>`, so signing in brings the person back. When a
 *   session ended, `reason` and the backend's own sentence go along ("You were signed out after
 *   2 hours idle.").
 * - A session can end while a page is open (idle time, the longest session, "sign out
 *   everywhere"). Any request that then answers 401 `auth_required` marks the person signed out,
 *   and the same redirect happens. It watches every query and every change, so no page has to.
 * - While the backend answers, the page area shows only the shape of the app (a still skeleton,
 *   after 200 ms), so a signed-out person never sees a flash of the app.
 * - **No app without a user** (PLAN-V15 T2-5): when the question still fails after its retries,
 *   the screen says why instead of showing the app with no account menu and every module in the
 *   menu: Connection lost (offline, out of reach, no answer in time), Updating (a deploy), or the
 *   failed answer with its request id. Each comes back by itself, or with Try again.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { isSignInNeeded } from '@/api/client'
import { problemKind, runFailedReadsAgain } from '@/api/connection'
import { signedOutBy, useMe } from '@/api/hooks'
import { queryKeys } from '@/api/query'
import { loginAddress } from '@/auth/login-form'
import { ConnectionLostPage, ProblemPage, UpdatingPage } from './error-pages/pages'
import { ShellSkeleton } from './shell-skeleton'

/** Marks the person signed out as soon as any request says sign-in is needed. */
function useSignedOutWatch(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    const signedOut = (error: unknown): void => {
      if (isSignInNeeded(error)) {
        queryClient.setQueryData(queryKeys.auth.me(), signedOutBy(error))
      }
    }
    const stopQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') {
        signedOut(event.action.error)
      }
    })
    const stopChanges = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') {
        signedOut(event.action.error)
      }
    })
    return () => {
      stopQueries()
      stopChanges()
    }
  }, [queryClient])
}

export function RequireSignIn({ children }: { children: ReactNode }) {
  const me = useMe()
  const location = useLocation()
  const queryClient = useQueryClient()
  useSignedOutWatch()

  // A later check that fails keeps the answer it had: the app stays, and the bar says the rest.
  if (me.data === undefined) {
    if (!me.isError) {
      // Offline before the first answer: TanStack Query waits for the network, so say so.
      return me.fetchStatus === 'paused' ? <ConnectionLostPage standalone /> : <ShellSkeleton />
    }
    switch (problemKind(me.error)) {
      case 'offline':
      case 'unreachable':
      case 'timeout':
        return <ConnectionLostPage problem={me.error} standalone />
      case 'updating':
        return <UpdatingPage problem={me.error} standalone />
      default:
        return (
          <ProblemPage
            problem={me.error}
            standalone
            onTryAgain={() => {
              runFailedReadsAgain(queryClient)
            }}
          />
        )
    }
  }
  if (me.data.state === 'signed_out') {
    const here = `${location.pathname}${location.search}${location.hash}`
    return (
      <Navigate
        to={loginAddress(here, me.data.reason)}
        replace
        state={me.data.detail ? { notice: me.data.detail } : null}
      />
    )
  }
  return children
}
