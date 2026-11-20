/**
 * "Needs a company" (PLAN-V24 T3-3, choice 20): the calls saved before their company was found,
 * at the top of Call logs, above the tabs, with their count from the counts (`/summary`). None,
 * and the group isn't there. A call here can't go to HubSpot until its company is picked.
 *
 * - **One row a call,** newest first, in one box with lines between: the name as heard in quotes
 *   ("North Wind", "as heard"), when the call was and how it went, and its words folded to two
 *   lines (`CardText`). The newest three show; "Show all 5 calls" opens the rest (TBC).
 * - **Remove** takes it away at once, with Undo in a toast, as on To confirm (`remove.ts`). The
 *   focus moves to the next call, or to the tabs when it was the last.
 * - **Loading** keeps the room of the rows it knows of (the count says how many). A list that
 *   can't be read says so in the group, with Try again; the tabs under it still work.
 * - Viewers see the calls and no buttons, as on To confirm.
 */
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { useCallNotes } from '@/api/hooks/call-notes'
import type { CallNoteOut } from '@/api/types'
import { useCanWrite } from '@/auth/can'
import { ErrorState } from '@/components/error-state'
import { ListExit, ListExitItem, RollingNumber } from '@/components/motion'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CardText } from './note-parts'
import { callLogsQuery, NEEDS_COMPANY_SHOWN } from './params'
import { removeCallNote, useRemoving } from './remove'
import { RowsPending } from './states'
import {
  AS_HEARD,
  callCompany,
  firstOfWords,
  NEEDS_COMPANY_FAILED,
  NEEDS_COMPANY_LIST,
  NEEDS_COMPANY_LOADING,
  NEEDS_COMPANY_TITLE,
  needsCompanyLead,
  noteLine,
  REMOVE,
  SHOW_FEWER,
  showAllCallsWords,
} from './words'

/** The attribute on each row, with the call's id. */
const ROW = 'data-needs-company'
/** On a row's first button: it takes the focus when the row next to it leaves. */
const FIRST_ACTION = 'data-row-action'

/** The focus goes to a call's first button, or to the tab on show when no call is left. */
function focusAfter(id: string | null): void {
  const target = id
    ? document.querySelector<HTMLElement>(`[${ROW}="${CSS.escape(id)}"] [${FIRST_ACTION}]`)
    : document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
  target?.focus()
}

function NeedsCompanyRow({
  note,
  today,
  canWrite,
  onRemove,
}: {
  note: CallNoteOut
  today: string
  canWrite: boolean
  onRemove: () => void
}) {
  const titleId = useId()
  // Not sorted yet, so there is no summary: the rep's own words.
  const words = note.call.summary.trim() || note.text.trim()
  return (
    <article
      aria-labelledby={titleId}
      {...{ [ROW]: note.id }}
      className="@container px-4 py-3 text-ui text-foreground sm:px-5"
    >
      {/* Wide: the buttons sit at the right of the words. Narrow (a phone): under them. */}
      <div className="grid grid-cols-1 gap-2 @xl:grid-cols-[minmax(0,1fr)_auto] @xl:gap-x-4">
        <header className="flex min-w-0 flex-col gap-0.5">
          <h3 id={titleId} className="font-semibold break-words text-foreground">
            {callCompany(note)}{' '}
            <span className="text-caption font-normal text-muted-foreground">{AS_HEARD}</span>
          </h3>
          <p className="text-caption text-muted-foreground">{noteLine(note, today)}</p>
        </header>
        {words ? (
          <div className="min-w-0 @xl:col-start-1">
            <CardText text={words} />
          </div>
        ) : null}
        {canWrite ? (
          <div className="flex flex-wrap items-center gap-2 @xl:col-start-2 @xl:row-span-2 @xl:row-start-1 @xl:self-start">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto text-muted-foreground touch:h-11 @xl:ml-0"
              {...{ [FIRST_ACTION]: '' }}
              onClick={onRemove}
            >
              <Trash2 aria-hidden="true" />
              {REMOVE}
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  )
}

export interface NeedsCompanyProps {
  /** How many calls need a company, from the counts. With none, the group isn't drawn. */
  count: number
  /** Melbourne's day, for "Today". */
  today: string
}

export function NeedsCompany({ count, today }: NeedsCompanyProps) {
  const client = useQueryClient()
  const canWrite = useCanWrite('companies.call_logs')
  const removing = useRemoving()
  const list = useCallNotes(callLogsQuery('needs_company'), { enabled: count > 0 })
  const [open, setOpen] = useState(false)
  const headingId = useId()
  const listId = useId()

  if (count <= 0) return null
  const items = (list.data?.items ?? []).filter((note) => !removing.has(note.id))
  // The counts were older than the list: nothing is waiting after all.
  if (list.data && items.length === 0) return null

  const folded = !open && items.length > NEEDS_COMPANY_SHOWN
  const shown = folded ? items.slice(0, NEEDS_COMPANY_SHOWN) : items

  /**
   * The call after this one, or the one before it: its row takes the focus when this one leaves.
   * Null when it is the last.
   */
  const neighbour = (id: string): string | null => {
    const order = items.map((note) => note.id)
    const index = order.indexOf(id)
    return order[index + 1] ?? order[index - 1] ?? null
  }
  /** The browser drops the focus with a row, so it moves on at once (or once a folded row shows). */
  const moveFocus = (next: string | null): void => {
    if (next !== null && shown.some((note) => note.id === next)) {
      focusAfter(next)
    } else {
      requestAnimationFrame(() => {
        focusAfter(next)
      })
    }
  }
  const remove = (note: CallNoteOut): void => {
    const next = neighbour(note.id)
    removeCallNote(client, note)
    moveFocus(next)
  }

  let body
  if (list.error && !list.data) {
    body = (
      <ErrorState
        error={list.error}
        context={NEEDS_COMPANY_FAILED}
        onRetry={() => void list.refetch()}
      />
    )
  } else if (!list.data) {
    body = <RowsPending rows={Math.min(count, NEEDS_COMPANY_SHOWN)} label={NEEDS_COMPANY_LOADING} />
  } else {
    body = (
      <>
        <ListExit
          id={listId}
          aria-label={NEEDS_COMPANY_LIST}
          className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card"
        >
          {shown.map((note) => (
            <ListExitItem key={note.id}>
              <NeedsCompanyRow
                note={note}
                today={today}
                canWrite={canWrite}
                onRemove={() => {
                  remove(note)
                }}
              />
            </ListExitItem>
          ))}
        </ListExit>
        {items.length > NEEDS_COMPANY_SHOWN ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start touch:h-11"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => {
              setOpen(!open)
            }}
          >
            <ChevronDown
              aria-hidden="true"
              className={cn(
                'transition-transform duration-150 ease-standard',
                open && 'rotate-180',
              )}
            />
            {open ? SHOW_FEWER : showAllCallsWords(items.length)}
          </Button>
        ) : null}
        {open && list.data.total > list.data.items.length ? (
          <p className="text-ui text-muted-foreground">
            {firstOfWords(list.data.items.length, list.data.total)}
          </p>
        ) : null}
      </>
    )
  }

  return (
    <section aria-labelledby={headingId} data-slot="needs-company" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2
          id={headingId}
          className="flex items-baseline gap-2 text-section font-semibold text-foreground"
        >
          {NEEDS_COMPANY_TITLE}{' '}
          <span className="text-ui font-normal text-muted-foreground">
            <RollingNumber value={count} />
          </span>
        </h2>
        <p className="max-w-prose text-ui text-pretty text-muted-foreground">
          {needsCompanyLead(count)}
        </p>
      </div>
      {body}
    </section>
  )
}
