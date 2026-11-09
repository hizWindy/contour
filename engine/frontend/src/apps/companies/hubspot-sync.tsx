/**
 * "Sync with HubSpot" on the Companies page (PLAN-V10 F2, 9 Nov): copies everything from HubSpot
 * now, instead of waiting for the 6:00 sync. It is a full sync: companies, offices, deals and
 * owners, and people and calls once HubSpot allows them. Reading HubSpot is free. It takes about
 * 10 minutes, and runs in the background, so the page stays usable.
 *
 * - **Beside it:** when our copy was last updated, or, while a sync runs, how far it has got. The
 *   backend saves its counts as it reads, so the bar fills (and never loops).
 * - **When it finishes,** the list refreshes and a toast says what was copied.
 * - **One at a time,** for everyone. Pressing it while a sync runs follows that one.
 */
import { useQueryClient } from '@tanstack/react-query'
import { Database, RefreshCw } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { isApiProblem } from '@/api/client'
import { useHubSpotSyncs, useStartHubSpotSync } from '@/api/hooks'
import { queryKeys } from '@/api/query'
import type { HubSpotSync as Sync } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatNumber, formatRelative } from '@/lib/format'
import { toastProblem } from '@/lib/problems'

/** A full copy's usual length, until one has finished. */
const FULL_MINUTES = 10

function minutesOf(sync: Sync | undefined): number {
  if (!sync?.finished_at) return FULL_MINUTES
  const taken = new Date(sync.finished_at).getTime() - new Date(sync.started_at).getTime()
  return Math.max(1, Math.round(taken / 60_000))
}

interface Progressing {
  words: string
  /** 0 to 100 once the counts are known, else null (then no bar: nothing is made up). */
  value: number | null
}

/** How far a running sync has got. The last full copy gives the totals to expect. */
function progressOf(running: Sync, lastFull: Sync | undefined): Progressing {
  const full = running.mode === 'full' ? lastFull : undefined
  const companies = full?.companies_read ?? 0
  const deals = full?.deals_read ?? 0
  if (running.deals_read > 0) {
    if (deals > 0 && running.deals_read >= deals) {
      return { words: 'Saving to our copy.', value: 95 }
    }
    const share = deals > 0 ? Math.min(1, running.deals_read / deals) : 0.5
    return {
      words: `Reading deals: ${formatNumber(running.deals_read)}${deals ? ` of about ${formatNumber(deals)}` : ''}.`,
      value: 60 + share * 35,
    }
  }
  if (running.companies_read > 0) {
    const share = companies > 0 ? Math.min(1, running.companies_read / companies) : 0.5
    return {
      words: `Reading companies: ${formatNumber(running.companies_read)}${companies ? ` of about ${formatNumber(companies)}` : ''}.`,
      value: share * 60,
    }
  }
  return {
    words:
      running.mode === 'full'
        ? `Syncing with HubSpot. A full copy takes about ${String(minutesOf(lastFull))} minutes.`
        : 'Syncing with HubSpot.',
    value: null,
  }
}

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

/** The button, with the copy's age or the running sync's progress beside it. */
export function HubSpotSync() {
  const syncs = useHubSpotSyncs()
  const start = useStartHubSpotSync()
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
    } else {
      toast.error("The HubSpot sync didn't finish", {
        description: finished.error ?? 'Nothing in our copy was lost. Try again in a minute.',
      })
    }
  }, [running, syncs.data, queryClient])

  const progress = running ? progressOf(running, lastFull) : null
  const busy = Boolean(running) || start.isPending
  const status = progress
    ? progress.words
    : lastGood?.finished_at
      ? `HubSpot copy updated ${formatRelative(lastGood.finished_at)}.`
      : syncs.isPending || syncs.isError
        ? null
        : 'Not synced yet.'

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
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              start.mutate('full', {
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
          Copies everything from HubSpot now: companies, offices, deals and owners, and people and
          calls once HubSpot allows them. Free. About {minutesOf(lastFull)} minutes.
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
