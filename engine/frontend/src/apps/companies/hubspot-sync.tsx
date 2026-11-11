/**
 * "Sync with HubSpot" on the Companies page (PLAN-V10 F2, PLAN-V15 T2-6): copies from HubSpot now,
 * instead of waiting for the 6:00 sync. It asks for an "auto" sync: what changed since the last one,
 * and everything once a week (a full copy stays on Admin, HubSpot). Reading HubSpot is free. It runs
 * in the background, so the page stays usable.
 *
 * - **Beside it:** when our copy was last updated, or, while a sync runs, its phase and how far it
 *   has got: reading HubSpot, saving to our copy, saving people, updating profiles
 *   (`components/hubspot/sync-progress.ts`). The bar fills, and never loops.
 * - **Stop:** beside the progress. After a press it says "Stopping…" with the button off, then what
 *   was kept, in the backend's words: "Stopped. Our copy didn't change." or "Stopped after saving
 *   companies. People and profiles update with the next sync."
 * - **When it finishes,** the list refreshes and a toast says what was copied.
 * - **One at a time,** for everyone. Pressing it while a sync runs follows that one.
 */
import { useQueryClient } from '@tanstack/react-query'
import { Database, RefreshCw, Square } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { isApiProblem } from '@/api/client'
import { useCancelHubSpotSync, useHubSpotSyncs, useStartHubSpotSync } from '@/api/hooks'
import { queryKeys } from '@/api/query'
import type { HubSpotSync as Sync } from '@/api/types'
import { isStopping, stoppedWords, syncProgress } from '@/components/hubspot/sync-progress'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatNumber, formatRelative } from '@/lib/format'
import { toastProblem } from '@/lib/problems'

function finishedWords(sync: Sync): string {
  const parts = [
    `${formatNumber(sync.companies_saved)} companies and ${formatNumber(sync.deals_saved)} deals copied.`,
    sync.companies_removed > 0
      ? `${formatNumber(sync.companies_removed)} companies are gone from HubSpot.`
      : null,
    sync.warnings[0] ?? null,
  ]
  return parts.filter(Boolean).join(' ')
}

/** The button, with the copy's age or the running sync's progress and Stop beside it. */
export function HubSpotSync() {
  const syncs = useHubSpotSyncs()
  const start = useStartHubSpotSync()
  const cancel = useCancelHubSpotSync()
  const queryClient = useQueryClient()
  const list = syncs.data ?? []
  const running = list.find((sync) => sync.status === 'running')
  const lastGood = list.find((sync) => sync.status === 'done')
  const lastFull = list.find((sync) => sync.status === 'done' && sync.mode === 'full')
  const watched = useRef<number | null>(null)

  // When the sync on screen finishes: refresh the companies, and say how it went.
  useEffect(() => {
    if (running) {
      watched.current = running.id
      return
    }
    const id = watched.current
    if (id === null) return
    const finished = syncs.data?.find((sync) => sync.id === id)
    if (!finished) return
    watched.current = null
    void queryClient.invalidateQueries({ queryKey: queryKeys.companies.all })
    if (finished.status === 'done') {
      toast.success('HubSpot copy updated', { description: finishedWords(finished) })
    } else if (finished.status === 'cancelled') {
      toast('HubSpot sync stopped', { description: stoppedWords(finished) })
    } else {
      toast.error("The HubSpot sync didn't finish", {
        description: finished.error ?? 'Nothing in our copy was lost. Try again in a minute.',
      })
    }
  }, [running, syncs.data, queryClient])

  const stopping = Boolean(running && (isStopping(running) || cancel.isPending))
  const progress = running ? syncProgress(running, lastFull) : null
  const busy = Boolean(running) || start.isPending
  const status = progress
    ? stopping
      ? 'Stopping…'
      : progress.words
    : lastGood?.finished_at
      ? `HubSpot copy updated ${formatRelative(lastGood.finished_at)}.`
      : syncs.isPending || syncs.isError
        ? null
        : 'Not synced yet.'

  const stop = (sync: Sync): void => {
    cancel.mutate(sync.id, {
      onError: (error) => {
        if (isApiProblem(error) && error.code === 'not_running') {
          toast('That sync had already finished', { description: 'Its result shows here.' })
          void syncs.refetch()
          return
        }
        toastProblem(error)
      },
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:justify-end">
      {status ? (
        <div className="flex min-w-0 flex-col gap-1.5 sm:items-end">
          <p
            role="status"
            className="flex items-center gap-1.5 text-caption text-muted-foreground tabular-nums"
          >
            <Database aria-hidden="true" className="size-3.5 shrink-0" />
            {status}
          </p>
          {progress?.value != null ? (
            <Progress value={progress.value} aria-label="HubSpot sync" className="h-1 w-48" />
          ) : null}
        </div>
      ) : null}
      {running ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={stopping}
          onClick={() => {
            stop(running)
          }}
        >
          <Square aria-hidden="true" />
          {stopping ? 'Stopping…' : 'Stop'}
        </Button>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              start.mutate('auto', {
                onSuccess: () => {
                  toast('Syncing with HubSpot', {
                    description: 'You can keep working. The list refreshes when it is done.',
                  })
                },
                onError: (error) => {
                  if (isApiProblem(error) && error.code === 'hubspot_sync_running') {
                    toast('A HubSpot sync is already running', {
                      description: 'Its progress shows here.',
                    })
                    void syncs.refetch()
                    return
                  }
                  toastProblem(error)
                },
              })
            }}
          >
            <RefreshCw aria-hidden="true" />
            {running ? 'Syncing' : 'Sync with HubSpot'}
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-72">
          Copies what changed in HubSpot since the last sync, and everything once a week: companies,
          offices, deals and owners. Free. A full copy is on Admin, HubSpot.
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
