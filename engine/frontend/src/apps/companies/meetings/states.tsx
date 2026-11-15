/**
 * What Meetings shows while it loads, when a list is empty, while meetings can't come from HubSpot
 * yet, and when pre-meeting forms are off (PLAN-V17 "Every state is drawn"). Loading shows the
 * still shape of what is coming, at its real size, only after 200ms (`Pending`), so a quick answer
 * never flashes grey blocks.
 */
import { CirclePause, Hourglass } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { Pending } from '@/components/skeletons'
import { Skeleton } from '@/components/ui/skeleton'
import { LOADING, OFF_DESCRIPTION, OFF_TITLE, waitingLine } from './words'

/** One group of rows, as tall as a row with the company, the title and where. */
export function MeetingsPending({ rows = 4 }: { rows?: number }) {
  return (
    <Pending label={LOADING}>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-24" />
        <div className="flex flex-col divide-y rounded-lg border bg-card">
          {Array.from({ length: rows }, (_, index) => (
            <div
              key={index}
              className="flex flex-col gap-2 px-4 py-3 sm:grid sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4"
            >
              <Skeleton className="h-5 w-20" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-1/5" />
              </div>
              <div className="flex items-center justify-between gap-3 sm:w-72">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-8 w-28" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Pending>
  )
}

/** Pre-meeting forms switched off: the page says so, with no setting's name. */
export function MeetingFormsOff() {
  return (
    <EmptyState
      icon={CirclePause}
      title={OFF_TITLE}
      description={OFF_DESCRIPTION}
      headingLevel={2}
    />
  )
}

/**
 * One quiet line while the list can't show what was asked, in the server's words: HubSpot's
 * meetings waiting for a permission, HubSpot not connected, or the rep's own not known yet. New
 * pre-read still works, so the line says so. It is never the switch-off page: the rows the server
 * has still show under it.
 */
export function WaitingLine({ sentence }: { sentence: string | null }) {
  return (
    <p
      role="status"
      data-slot="waiting-line"
      className="flex items-start gap-2 text-ui text-muted-foreground"
    >
      <Hourglass aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {waitingLine(sentence)}
    </p>
  )
}
