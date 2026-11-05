/**
 * The app knows who is signed in (PLAN-V6 C3). Around the app frame:
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
 *   after 200 ms), so a signed-out person never sees a flash of the app. If the backend can't be
 *   reached, the page shows as before and its own errors say so.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { isSignInNeeded } from '@/api/client'
import { signedOutBy, useMe } from '@/api/hooks'
import { queryKeys } from '@/api/query'
import { loginAddress } from '@/auth/login-form'
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
  useSignedOutWatch()

  if (me.isPending) {
    return <ShellSkeleton />
  }
  if (me.data?.state === 'signed_out') {
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
