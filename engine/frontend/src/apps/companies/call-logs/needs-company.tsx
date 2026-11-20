/**
 * "Needs a company" (PLAN-V24 T3-3, choice 20): the calls saved before their company was found,
 * at the top of Call logs, above the tabs, with their count from the counts (`/summary`). None,
 * and the group isn't there. A call here can't go to HubSpot until its company is picked.
 *
 * - **One row a call,** newest first, in one box with lines between: the name as heard in quotes
 *   ("North Wind", "as heard"), when the call was and how it went, and its words folded to two
 *   lines (`CardText`). The newest three show; "Show all 5 calls" opens the rest (TBC).
 * - **Pick company** opens Log call's company search, with the name as heard already in it
 *   (`pick-company.tsx`). A pick leaves the group at once; the call is sorted as a new call is,
 *   then waits in To confirm (choice 21, `use-pick.ts`). The focus moves to the next call, or to
 *   the tabs when it was the last; after Esc it goes back to the call's own Pick company.
 * - **Remove** takes it away at once, with Undo in a toast, as on To confirm (`remove.ts`). The
 *   focus moves on the same way.
 * - **Loading** keeps the room of the rows it knows of (the count says how many). A list that
 *   can't be read says so in the group, with Try again; the tabs under it still work.
 * - Viewers see the calls and no buttons, as on To confirm.
 */
import { useQueryClient } from '@tanstack/react-query'
import { Building2, ChevronDown, Trash2 } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { useCallNotes } from '@/api/hooks/call-notes'
import type { CallNoteOut } from '@/api/types'
import { useCanWrite } from '@/auth/can'
import { ErrorState } from '@/components/error-state'
import { ListExit, ListExitItem, RollingNumber } from '@/components/motion'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { CompanyPick } from './company-list'
import { CardText } from './note-parts'
import { callLogsQuery, NEEDS_COMPANY_SHOWN } from './params'
import { PickCompanySheet } from './pick-company'
import { removeCallNote, useRemoving } from './remove'
import { RowsPending } from './states'
import { usePickCompany } from './use-pick'
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
  PICK_COMPANY,
  REMOVE,
  SHOW_FEWER,
  showAllCallsWords,
} from './words'

/** The attribute on each row, with the call's id. */
const ROW = 'data-needs-company'
/** On a row's first button: it takes the focus when the row next to it leaves. */
const FIRST_ACTION = 'data-row-action'

/** The focus goes to a call's first button, or to the tab on show when that call isn't there. */
function focusAfter(id: string | null): void {
  const row = id
    ? document.querySelector<HTMLElement>(`[${ROW}="${CSS.escape(id)}"] [${FIRST_ACTION}]`)
    : null
  const tab = document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
  ;(row ?? tab)?.focus()
}

function NeedsCompanyRow({
  note,
  today,
  canWrite,
  onPick,
  onRemove,
}: {
  note: CallNoteOut
  today: string
  canWrite: boolean
  onPick: () => void
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
              variant="outline"
              size="sm"
              className="touch:h-11"
              {...{ [FIRST_ACTION]: '' }}
              onClick={onPick}
            >
              <Building2 aria-hidden="true" />
              {PICK_COMPANY}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto text-muted-foreground touch:h-11 @xl:ml-0"
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
  /** Pick company's panel is the whole screen on a phone. */
  onPhone: boolean
}

export function NeedsCompany({ count, today, onPhone }: NeedsCompanyProps) {
  const client = useQueryClient()
  const canWrite = useCanWrite('companies.call_logs')
  const removing = useRemoving()
  const list = useCallNotes(callLogsQuery('needs_company'), { enabled: count > 0 })
  const pick = usePickCompany()
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState<CallNoteOut | null>(null)
  // Where the focus goes as Pick company's panel closes: back to the call it opened for, or, after
  // a pick, to the call next to it (null: the tabs).
  const openedFor = useRef<string | null>(null)
  const afterPick = useRef<{ next: string | null } | null>(null)
  const headingId = useId()
  const listId = useId()

  const items = count > 0 ? (list.data?.items ?? []).filter((note) => !removing.has(note.id)) : []
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
  const startPick = (note: CallNoteOut): void => {
    openedFor.current = note.id
    afterPick.current = null
    setPicking(note)
  }
  const finishPick = (note: CallNoteOut, company: CompanyPick): void => {
    afterPick.current = { next: neighbour(note.id) }
    setPicking(null)
    pick.mutate({ id: note.id, companyKey: company.key })
  }
  const focusBack = (): void => {
    const picked = afterPick.current
    afterPick.current = null
    if (picked) {
      moveFocus(picked.next)
    } else {
      focusAfter(openedFor.current)
    }
  }

  // The panel stays on the page when the group goes (its last call picked), so it can close.
  const sheet = (
    <PickCompanySheet
      note={picking}
      onPhone={onPhone}
      onPick={finishPick}
      onClose={() => {
        setPicking(null)
      }}
      focusBack={focusBack}
    />
  )
  // None, or the counts were older than the list: nothing is waiting after all.
  if (count <= 0 || (list.data && items.length === 0)) return sheet

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
                onPick={() => {
                  startPick(note)
                }}
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
    <>
      <section
        aria-labelledby={headingId}
        data-slot="needs-company"
        className="flex flex-col gap-3"
      >
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
      {sheet}
    </>
  )
}
