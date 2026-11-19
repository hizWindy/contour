/**
 * Today's rows (PLAN-V22 T2-2): a task, a meeting, a kind of call waiting, and a deal that needs a
 * nudge. Each row is the same shell: its words on the left, its buttons on the right (under the
 * words on a phone), and one main button: Log a call, Draft the pre-read, or Open.
 *
 * - **The active row** (J and K, a click, or the focus) has the selected tint and the Navy edge,
 *   as Call logs' cards do. Enter on it does its main button. The rows are plain rows, never a list
 *   box or a menu, so V still opens the voice bar on Today.
 * - **Each button's name ends with its row** (a screen reader hears many such buttons), and "Done"
 *   and "Log a call" show their key (D, L) on a laptop.
 * - **Every status has an icon and a word:** overdue, a pre-read's state, why a deal needs a nudge.
 */
import {
  Clock,
  ExternalLink,
  ListTodo,
  Mail,
  Phone,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { useId, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { TodayDeal, TodayMeeting, TodayTask } from '@/api/types'
import { StatusLine } from '@/apps/companies/meetings/row-parts'
import { dayText } from '@/apps/companies/meetings/words'
import { needsLookTail, toConfirmTail } from '@/apps/companies/words'
import { useOpensHubSpot } from '@/auth/hubspot-user'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { formatTime } from '@/lib/format'
import { safeHref } from '@/lib/safe-href'
import { cn } from '@/lib/utils'
import type { CallsTab } from './rows'
import { DONE, dueWords, KIND_WORDS, NEW_TAB, OPEN_IN_HUBSPOT } from './words'

/** A row's main button: a page of the app, another site, or something done here. */
export type RowAct =
  | { label: string; to: string }
  | { label: string; href: string }
  | { label: string; run: () => void; busy?: boolean; shortcut?: string }

const KIND_ICONS: Readonly<Record<TodayTask['kind'], LucideIcon>> = {
  call: Phone,
  email: Mail,
  todo: ListTodo,
}

export interface ShellProps {
  id: string
  active: boolean
  onActivate: (id: string) => void
  /** Enter on the row: its main button. */
  onEnter: (() => void) | null
  /** The ids of the words that name the row, in order: "10:00 am Vitera Pty Ltd". */
  labelledBy: string
  words: ReactNode
  buttons: ReactNode
}

/** One row: its words, its buttons, the active mark, and Enter. */
export function RowShell({
  id,
  active,
  onActivate,
  onEnter,
  labelledBy,
  words,
  buttons,
}: ShellProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    // Enter on the row itself, not on one of its buttons (which keep their own Enter).
    if (event.key !== 'Enter' || event.target !== event.currentTarget || !onEnter) return
    event.preventDefault()
    onEnter()
  }
  return (
    <article
      data-row={id}
      tabIndex={-1}
      aria-labelledby={labelledBy}
      aria-current={active || undefined}
      onFocusCapture={() => {
        onActivate(id)
      }}
      onPointerDown={() => {
        onActivate(id)
      }}
      onKeyDown={onKeyDown}
      className={cn(
        'flex flex-col gap-3 px-4 py-3 text-ui focus-visible:-outline-offset-2 sm:flex-row sm:items-center sm:px-6',
        active && 'bg-selected shadow-[inset_3px_0_0_var(--primary)]',
      )}
    >
      <div className="min-w-0 flex-1">{words}</div>
      <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">{buttons}</div>
    </article>
  )
}

/** A row's main button, with what a screen reader hears after its word. */
export function ActButton({ act, context }: { act: RowAct; context: string }) {
  const heard = <span className="sr-only">{context}</span>
  if ('to' in act) {
    return (
      <Button asChild variant="outline" size="sm" className="touch:h-11">
        <Link to={act.to}>
          {act.label}
          {heard}
        </Link>
      </Button>
    )
  }
  if ('href' in act) return <HubSpotLink href={act.href} context={context} label={act.label} />
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="touch:h-11"
      disabled={act.busy}
      aria-keyshortcuts={act.shortcut}
      onClick={act.run}
    >
      {act.label}
      {heard}
      {act.shortcut ? (
        <Kbd aria-hidden="true" className="touch:hidden">
          {act.shortcut}
        </Kbd>
      ) : null}
    </Button>
  )
}

/**
 * A link to HubSpot: another site, so the arrow out of the box, and a new tab. Hidden for someone
 * with no HubSpot user, who has no HubSpot login (PLAN-V23 T3-4).
 */
export function HubSpotLink({
  href,
  context,
  label = OPEN_IN_HUBSPOT,
}: {
  href: string | null
  context: string
  label?: string
}) {
  const opens = useOpensHubSpot()
  const safe = safeHref(href)
  if (!safe || !opens) return null
  return (
    <Button asChild variant="ghost" size="sm" className="touch:h-11">
      <a href={safe} target="_blank" rel="noopener noreferrer nofollow">
        <ExternalLink aria-hidden="true" />
        {label}
        <span className="sr-only">
          {context} {NEW_TAB}
        </span>
      </a>
    </Button>
  )
}

/** A button with its key, shown on a laptop: "Done D". */
export function KeyButton({
  label,
  shortcut,
  context,
  onPress,
}: {
  label: string
  shortcut: string
  context: string
  onPress: () => void
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="touch:h-11"
      aria-keyshortcuts={shortcut}
      onClick={onPress}
    >
      {label}
      <span className="sr-only">{context}</span>
      <Kbd aria-hidden="true" className="touch:hidden">
        {shortcut}
      </Kbd>
    </Button>
  )
}

// --- The four kinds of row ---------------------------------------------------------------------

export interface RowBase {
  id: string
  active: boolean
  onActivate: (id: string) => void
  /** The main button, or none. */
  main: RowAct | null
  /** Enter: the main button. */
  onEnter: (() => void) | null
}

export function TaskRow({
  task,
  today,
  onDone,
  ...base
}: RowBase & {
  task: TodayTask
  today: string
  /** Done (D), or null for a Viewer, who can't change HubSpot. */
  onDone: (() => void) | null
}) {
  const labelId = useId()
  const Icon = KIND_ICONS[task.kind]
  const due = dueWords(task, dayText(task.due, today))
  const context = `: ${task.subject}`
  return (
    <RowShell
      {...base}
      labelledBy={labelId}
      words={
        <div className="flex items-start gap-3">
          <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p id={labelId} className="font-semibold break-words text-foreground">
              <span className="sr-only">{`${KIND_WORDS[task.kind]}:`}</span> {task.subject}
            </p>
            <p className="flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
              {task.company ? <span className="break-words">{task.company.name}</span> : null}
              <span
                className={cn('inline-flex items-center gap-1', task.overdue && 'text-review-ink')}
              >
                {task.overdue ? <Clock aria-hidden="true" className="size-3.5 shrink-0" /> : null}
                {due}
              </span>
            </p>
          </div>
        </div>
      }
      buttons={
        <>
          {onDone ? (
            <KeyButton label={DONE} shortcut="D" context={context} onPress={onDone} />
          ) : null}
          {base.main ? <ActButton act={base.main} context={context} /> : null}
          {base.main && 'href' in base.main ? null : (
            <HubSpotLink href={task.hubspot_url} context={context} />
          )}
        </>
      }
    />
  )
}

export function MeetingRow({
  meeting,
  drafting,
  ...base
}: RowBase & { meeting: TodayMeeting; drafting: boolean }) {
  const labelId = useId()
  const timeId = useId()
  const time = formatTime(meeting.starts_at)
  const status = drafting ? 'drafting' : (meeting.form?.status ?? 'needs')
  const context = `: ${meeting.company.name}, ${time}`
  return (
    <RowShell
      {...base}
      labelledBy={`${timeId} ${labelId}`}
      words={
        <div className="flex min-w-0 flex-col gap-0.5">
          <p id={timeId} className="text-caption text-muted-foreground tabular-nums">
            {time}
          </p>
          <p id={labelId} className="font-semibold break-words text-foreground">
            {meeting.company.name}
          </p>
          {meeting.title.trim() ? (
            <p className="line-clamp-1 break-words text-foreground">{meeting.title}</p>
          ) : null}
          <StatusLine status={status} form={meeting.form} />
        </div>
      }
      buttons={base.main ? <ActButton act={base.main} context={context} /> : null}
    />
  )
}

export function CallsRow({ tab, count, ...base }: RowBase & { tab: CallsTab; count: number }) {
  const labelId = useId()
  const words = `${String(count)} ${tab === 'to_confirm' ? toConfirmTail(count) : needsLookTail(count)}`
  return (
    <RowShell
      {...base}
      labelledBy={labelId}
      words={
        <p id={labelId} className="flex items-center gap-2 font-semibold text-foreground">
          {tab === 'needs_look' ? (
            <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-review-ink" />
          ) : null}
          {words}
        </p>
      }
      buttons={base.main ? <ActButton act={base.main} context={`: ${words}`} /> : null}
    />
  )
}

export function DealRow({ deal, ...base }: RowBase & { deal: TodayDeal }) {
  const labelId = useId()
  const dealId = useId()
  const context = `: ${deal.company.name}, ${deal.name}`
  return (
    <RowShell
      {...base}
      labelledBy={`${labelId} ${dealId}`}
      words={
        <div className="flex min-w-0 flex-col gap-0.5">
          <p id={labelId} className="font-semibold break-words text-foreground">
            {deal.company.name}
          </p>
          <p className="break-words text-foreground">
            <span id={dealId}>{deal.name}</span>
            {deal.stage ? <span className="text-muted-foreground"> · {deal.stage}</span> : null}
          </p>
          <p className="flex items-center gap-1 text-caption text-review-ink">
            <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
            {deal.why}
          </p>
        </div>
      }
      buttons={
        <>
          {base.main ? <ActButton act={base.main} context={context} /> : null}
          {base.main && 'href' in base.main ? null : (
            <HubSpotLink href={deal.hubspot_url} context={context} />
          )}
        </>
      }
    />
  )
}
