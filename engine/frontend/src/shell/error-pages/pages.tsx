/**
 * The full error pages (PLAN-V15 T2-4), for when a page has nothing to show. Each says what
 * happened, what it means, and what to do, in the words of "Words for errors" (`api/words.ts`).
 *
 * 1. Connection lost: offline or the server out of reach. Try again, and it comes back by itself.
 * 2. Updating: a deploy. It checks every 10 seconds and comes back by itself.
 * 3. A failed answer (a 500 and the like): the words, Try again, and the request id to copy.
 * 4. No access (403) and Not found (404): a way back to Home.
 * 5. New version: a page's code is gone after a deploy. It reloads once by itself
 *    (`page-route.tsx`); if that didn't help, a Reload button.
 *
 * Inside the app frame the connection bar runs the automatic checks; a page shown without the
 * frame (`standalone`) runs them itself. Either way the bar keeps quiet while a full page shows.
 */
import { useQueryClient } from '@tanstack/react-query'
import {
  CloudOff,
  House,
  Lock,
  RefreshCw,
  SearchX,
  ServerCrash,
  TriangleAlert,
  WifiOff,
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import type { ApiProblem } from '@/api/client'
import {
  connectionOf,
  problemKind,
  runFailedReadsAgain,
  useConnectionWatch,
  type ConnectionState,
} from '@/api/connection'
import { WORDS } from '@/api/words'
import { Button } from '@/components/ui/button'
import { browser } from '@/lib/reload'
import { ErrorPage } from './error-page'
import { checkingWords, useSecondsLeft } from './use-seconds-left'

export interface ConnectionPageProps {
  /** The failure that brought the page, if any. */
  problem?: ApiProblem
  /** Shown without the app frame, so the page runs the automatic checks itself. */
  standalone?: boolean
  /** The page's own code failed to load, so coming back needs a reload, not a new read. */
  reloadWhenBack?: boolean
}

/**
 * What both connection pages share: the shared state matches the page, the bar keeps quiet, and
 * once the server is back the page either reloads (its code failed) or lets the failed reads run
 * again (`Connection.set` does that).
 */
function useConnectionPage(
  want: Exclude<ConnectionState, 'online'>,
  { standalone = false, reloadWhenBack = false }: ConnectionPageProps,
) {
  const client = useQueryClient()
  const connection = connectionOf(client)
  const watch = useConnectionWatch(standalone)

  useEffect(() => connection.claimPage(), [connection])
  useEffect(() => {
    if (connection.get().state === 'online') {
      connection.set(want)
    }
  }, [connection, want])

  const wasDown = useRef(false)
  useEffect(() => {
    if (watch.state !== 'online') {
      wasDown.current = true
    } else if (wasDown.current && reloadWhenBack) {
      browser.reload()
    }
  }, [watch.state, reloadWhenBack])

  const tryAgain = (): void => {
    if (reloadWhenBack) {
      browser.reload()
      return
    }
    watch.checkNow()
    runFailedReadsAgain(client)
  }
  return { watch, tryAgain }
}

/** 1. Offline, or the server can't be reached (or didn't answer in time). */
export function ConnectionLostPage(props: ConnectionPageProps) {
  const startedOffline = problemKind(props.problem) === 'offline'
  const { watch, tryAgain } = useConnectionPage(startedOffline ? 'offline' : 'unreachable', props)
  const seconds = useSecondsLeft(watch.nextCheckAt)
  const offline = watch.state === 'offline' || (watch.state === 'online' && startedOffline)
  return (
    <ErrorPage
      icon={offline ? WifiOff : CloudOff}
      title={offline ? WORDS.offline.title : WORDS.unreachable.title}
      description={
        offline
          ? WORDS.offline.detail
          : "Nothing you typed is lost. We'll try again every 10 seconds."
      }
      live={offline ? null : checkingWords(seconds)}
      standalone={props.standalone}
      actions={
        <Button type="button" variant="outline" onClick={tryAgain}>
          Try again
        </Button>
      }
    />
  )
}

/** 2. A deploy: the proxy's own page, or the backend still starting. */
export function UpdatingPage(props: ConnectionPageProps) {
  const { watch, tryAgain } = useConnectionPage('updating', props)
  const seconds = useSecondsLeft(watch.nextCheckAt)
  return (
    <ErrorPage
      icon={RefreshCw}
      role="status"
      title={WORDS.updating.title}
      description={WORDS.updating.detail}
      live={checkingWords(seconds)}
      standalone={props.standalone}
      actions={
        <Button type="button" variant="outline" onClick={tryAgain}>
          Try now
        </Button>
      }
    />
  )
}

/** 3. A failed answer the page can't do without: its own words, Try again, and the details. */
export function ProblemPage({
  problem,
  standalone = false,
  onTryAgain,
}: {
  problem: ApiProblem
  standalone?: boolean
  onTryAgain?: () => void
}) {
  const client = useQueryClient()
  return (
    <ErrorPage
      icon={ServerCrash}
      title={problem.title}
      description={problem.detail ?? 'Try again.'}
      problem={problem}
      standalone={standalone}
      actions={
        <Button
          type="button"
          variant="outline"
          onClick={
            onTryAgain ??
            (() => {
              runFailedReadsAgain(client)
            })
          }
        >
          Try again
        </Button>
      }
    />
  )
}

function HomeButton() {
  return (
    <Button asChild variant="outline">
      <Link to="/">
        <House aria-hidden="true" />
        Go to Home
      </Link>
    </Button>
  )
}

/** 4a. No access (403). */
export function NoAccessPage({ problem }: { problem?: ApiProblem }) {
  return (
    <ErrorPage
      icon={Lock}
      title={WORDS.forbidden.title}
      description={WORDS.forbidden.detail}
      problem={problem}
      actions={<HomeButton />}
    />
  )
}

/** 4b. Not found (404): a wrong address, or something removed. */
export function NotFoundPage({ problem }: { problem?: ApiProblem }) {
  return (
    <ErrorPage
      icon={SearchX}
      title={WORDS.notFound.title}
      description={WORDS.notFound.detail}
      problem={problem}
      actions={<HomeButton />}
    />
  )
}

/** 5a. While the page reloads itself for a new version. */
export function ReloadingPage() {
  return (
    <ErrorPage
      icon={RefreshCw}
      role="status"
      title={WORDS.newVersion.title}
      description={WORDS.newVersion.detail}
    />
  )
}

/** 5b. The reload didn't help: the button does it again. */
export function NewVersionPage() {
  return (
    <ErrorPage
      icon={RefreshCw}
      title={WORDS.newVersion.title}
      description="Reload the page to get the new version."
      actions={
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            browser.reload()
          }}
        >
          Reload
        </Button>
      }
    />
  )
}

/** The page's own code broke while it drew. No call failed, so there is nothing to copy. */
export function PageBrokePage() {
  return (
    <ErrorPage
      icon={TriangleAlert}
      title={WORDS.page.title}
      description={WORDS.page.detail}
      actions={
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            browser.reload()
          }}
        >
          Reload the page
        </Button>
      }
    />
  )
}
