/**
 * The meetings of one view (PLAN-V17 "The screens", part 5).
 *
 * - **Upcoming** is grouped by its Melbourne day, as the server says: Today, Tomorrow, This week
 *   and Later, each a list under its heading, in the server's order. One page holds them; if more
 *   come, a line says so.
 * - **Past** is one list, newest first, 25 at a time with the pager.
 *
 * A new search or another page keeps the list on screen, dimmed, until the next one comes, as the
 * tables do. The rows themselves never fade in, slide or glide (principles 02 #20).
 */
import { useId } from 'react'
import type { MeetingPage } from '@/api/v17'
import { Pager } from '@/components/pager'
import { cn } from '@/lib/utils'
import { MeetingRow } from './meeting-row'
import { PAST_PAGE_SIZE, type MeetingsView } from './params'
import { groupUpcoming, rowKey } from './rows'
import { firstOfWords, GROUP_LABELS, PAST_LIST, pastWhen, upcomingWhen } from './words'

export interface MeetingListProps {
  page: MeetingPage
  view: MeetingsView
  today: string
  /** The list is the one before, while the next one loads. */
  dimmed: boolean
  onPage: (page: number) => void
}

export function MeetingList({ page, view, today, dimmed, onPage }: MeetingListProps) {
  const id = useId()
  const dim = cn('transition-opacity', dimmed && 'opacity-60')

  if (view.when === 'past') {
    return (
      <div className="flex flex-col gap-3">
        <ul
          aria-label={PAST_LIST}
          aria-busy={dimmed || undefined}
          className={cn('flex flex-col divide-y rounded-lg border bg-card text-ui', dim)}
        >
          {page.items.map((item) => (
            <MeetingRow
              key={rowKey(item)}
              item={item}
              when={pastWhen(item.meeting.starts_at, today)}
              past
            />
          ))}
        </ul>
        {page.total > PAST_PAGE_SIZE ? (
          <Pager
            page={{ pageIndex: view.page, pageSize: PAST_PAGE_SIZE, total: page.total }}
            onPageChange={onPage}
          />
        ) : null}
      </div>
    )
  }

  return (
    <div aria-busy={dimmed || undefined} className={cn('flex flex-col gap-6', dim)}>
      {groupUpcoming(page.items).map(({ group, items }) => {
        const headingId = `${id}-${group}`
        // A heading and its list, not a landmark each: four regions would crowd a screen reader's
        // list of landmarks. The list takes the heading as its name.
        return (
          <div key={group} className="flex flex-col gap-2">
            <h2 id={headingId} className="text-ui font-semibold text-foreground">
              {GROUP_LABELS[group]}
            </h2>
            <ul
              aria-labelledby={headingId}
              className="flex flex-col divide-y rounded-lg border bg-card text-ui"
            >
              {items.map((item) => (
                <MeetingRow
                  key={rowKey(item)}
                  item={item}
                  when={upcomingWhen(item.meeting.starts_at, group, today)}
                  past={false}
                />
              ))}
            </ul>
          </div>
        )
      })}
      {page.total > page.items.length ? (
        <p className="text-caption text-muted-foreground">
          {firstOfWords(page.items.length, page.total)}
        </p>
      ) : null}
    </div>
  )
}
