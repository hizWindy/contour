/**
 * What Call logs shows while a tab loads, when it is empty, and when call notes are off (PLAN-V17
 * "Every state is drawn"). Loading shows the still shape of what is coming, at its real size, only
 * after 200ms (`Pending`), so a quick answer never flashes grey blocks.
 */
import { CirclePause } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { Pending } from '@/components/skeletons'
import { Skeleton } from '@/components/ui/skeleton'
import type { CallLogsTab } from './params'
import { EMPTY, LOADING, OFF_DESCRIPTION, OFF_TITLE } from './words'

/** Cards, as tall as a call with a summary and one change. */
export function CardsPending({ cards = 3 }: { cards?: number }) {
  return (
    <Pending label={LOADING}>
      <div className="flex flex-col gap-3">
        {Array.from({ length: cards }, (_, index) => (
          <div key={index} className="flex flex-col gap-4 rounded-lg border bg-card p-4 sm:p-5">
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
            </div>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-11/12" />
              <Skeleton className="h-5 w-3/4" />
            </div>
            <Skeleton className="h-9 w-48" />
          </div>
        ))}
      </div>
    </Pending>
  )
}

/** Rows of a list of calls. */
export function RowsPending({ rows = 5, label = LOADING }: { rows?: number; label?: string }) {
  return (
    <Pending label={label}>
      <div className="flex flex-col divide-y rounded-lg border bg-card">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex flex-col gap-1.5 px-4 py-3">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ))}
      </div>
    </Pending>
  )
}

export function TabEmpty({ tab }: { tab: CallLogsTab }) {
  const { title, description } = EMPTY[tab]
  return <EmptyState title={title} description={description} headingLevel={2} />
}

/** Call notes switched off: the page says so, with no setting's name. */
export function CallNotesOff() {
  return (
    <EmptyState
      icon={CirclePause}
      title={OFF_TITLE}
      description={OFF_DESCRIPTION}
      headingLevel={2}
    />
  )
}
