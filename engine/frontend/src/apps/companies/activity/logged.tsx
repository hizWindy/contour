/**
 * "Logged" (PLAN-V17 T3-6, "The screens" part 3): the rep's calls that are in HubSpot, newest
 * first, each with "Open in HubSpot". A list used all day barely moves (principles 02 #20), so
 * these rows never fade in or glide: no Reveal and no ListExit. It is paged, 25 at a time, and a
 * page keeps showing while the next one loads.
 */
import { CircleCheck } from 'lucide-react'
import { useState } from 'react'
import { useCallNotes } from '@/api/hooks/call-notes'
import type { CallNoteOut } from '@/api/v17'
import { ErrorState } from '@/components/error-state'
import { Pager } from '@/components/pager'
import { cn } from '@/lib/utils'
import { isCallNotesOff } from './notes'
import { OpenInHubSpot } from './open-in-hubspot'
import { activityQuery, LOGGED_PAGE_SIZE } from './params'
import { CallNotesOff, RowsPending, TabEmpty } from './states'
import { callWhen, LOAD_FAILED, loggedWhen, NO_OUTCOME, personLine } from './words'

const LIST_LABEL = 'Logged calls'

function LoggedRow({ note, today }: { note: CallNoteOut; today: string }) {
  const summary = note.call.summary.trim() || note.text
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="font-semibold text-foreground">{note.company_name}</p>
        <p className="text-caption text-muted-foreground">
          {[
            personLine(note.person),
            callWhen(note.called_at, today),
            note.call.outcome ?? NO_OUTCOME,
          ].join(' · ')}
        </p>
        <p className="line-clamp-1 max-w-prose break-words text-foreground">{summary}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 text-caption text-pass-ink">
          <CircleCheck aria-hidden="true" className="size-3.5 shrink-0" />
          {loggedWhen(note.confirmed_at, today)}
        </span>
        <OpenInHubSpot href={note.hubspot_url} company={note.company_name} />
      </div>
    </li>
  )
}

export function Logged({ today }: { today: string }) {
  const [pageIndex, setPageIndex] = useState(0)
  const list = useCallNotes(activityQuery('logged', pageIndex), { keepPrevious: true })

  if (isCallNotesOff(list.error)) return <CallNotesOff />
  if (list.error && !list.data) {
    return (
      <ErrorState error={list.error} context={LOAD_FAILED} onRetry={() => void list.refetch()} />
    )
  }
  if (!list.data) return <RowsPending />
  if (list.data.items.length === 0 && pageIndex === 0) return <TabEmpty tab="logged" />

  return (
    <div className="flex flex-col gap-3">
      <ul
        aria-label={LIST_LABEL}
        aria-busy={list.isPlaceholderData || undefined}
        className={cn(
          'flex flex-col divide-y rounded-lg border bg-card text-ui transition-opacity',
          // The old page dims while the next one loads, as the tables do.
          list.isPlaceholderData && 'opacity-60',
        )}
      >
        {list.data.items.map((note) => (
          <LoggedRow key={note.id} note={note} today={today} />
        ))}
      </ul>
      {list.data.total > LOGGED_PAGE_SIZE ? (
        <Pager
          page={{ pageIndex, pageSize: LOGGED_PAGE_SIZE, total: list.data.total }}
          onPageChange={setPageIndex}
        />
      ) : null}
    </div>
  )
}
