/**
 * Which full error page a failure gets (PLAN-V15 T2-4). `RouteError` and the sign-in guard ask.
 */
import { onlineManager } from '@tanstack/react-query'
import { isRouteErrorResponse } from 'react-router'
import { isApiProblem } from '@/api/client'
import { problemKind } from '@/api/connection'
import { isCodeLoadError } from '@/lib/reload'

export type ErrorPageKind =
  'connection' | 'updating' | 'problem' | 'forbidden' | 'notFound' | 'newVersion' | 'page'

export function errorPageKind(error: unknown): ErrorPageKind {
  if (isRouteErrorResponse(error)) {
    return error.status === 404 ? 'notFound' : error.status === 403 ? 'forbidden' : 'page'
  }
  if (isCodeLoadError(error)) {
    // Offline, the code couldn't come; online, it is gone (a new version) and one reload was tried.
    return onlineManager.isOnline() ? 'newVersion' : 'connection'
  }
  if (!isApiProblem(error)) {
    return 'page'
  }
  switch (problemKind(error)) {
    case 'offline':
    case 'unreachable':
    case 'timeout':
      return 'connection'
    case 'updating':
      return 'updating'
    default:
      break
  }
  if (error.status === 403) return 'forbidden'
  if (error.status === 404) return 'notFound'
  return 'problem'
}
