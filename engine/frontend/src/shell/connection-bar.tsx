import { CloudOff, RefreshCw, WifiOff } from 'lucide-react'
import { useConnectionWatch } from '@/api/connection'
import { WORDS } from '@/api/words'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { checkingWords, useSecondsLeft } from './error-pages/use-seconds-left'

/**
 * The connection bar (PLAN-V15 T2-4): one thin line at the top of the app while the connection
 * isn't fine, instead of a red box in every card.
 *
 * - Offline: "You're offline." It waits for the browser to be back online.
 * - Can't reach the server, or updating: it checks every 10 seconds, with a countdown and "Try
 *   now".
 * - Back: the bar goes, and the reads that failed run again by themselves.
 *
 * It runs the automatic checks for the whole app frame (`useConnectionWatch`), even while hidden
 * behind a full error page that says the same thing.
 */
export function ConnectionBar() {
  const { state, nextCheckAt, fullPage, checkNow } = useConnectionWatch()
  const seconds = useSecondsLeft(nextCheckAt)
  if (state === 'online' || fullPage) {
    return null
  }
  const words =
    state === 'offline' ? WORDS.offline : state === 'updating' ? WORDS.updating : WORDS.unreachable
  const Icon = state === 'offline' ? WifiOff : state === 'updating' ? RefreshCw : CloudOff
  return (
    <div
      data-slot="connection-bar"
      data-state={state}
      className={cn(
        'flex min-h-10 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 text-ui sm:px-4',
        state === 'updating' ? 'bg-accent-soft text-accent-ink' : 'bg-review-soft text-review-ink',
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <p role="status" className="min-w-0 flex-1">
        <span className="font-semibold">{words.title}.</span>{' '}
        {state === 'offline' ? words.detail : null}
        {state === 'updating' ? "It'll be back in about a minute." : null}
        {state === 'unreachable' ? 'Nothing you typed is lost.' : null}
      </p>
      {state === 'offline' ? null : (
        <>
          <span aria-hidden="true" className="text-caption tabular-nums">
            {checkingWords(seconds)}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="bg-transparent"
            onClick={checkNow}
          >
            Try now
          </Button>
        </>
      )}
    </div>
  )
}
