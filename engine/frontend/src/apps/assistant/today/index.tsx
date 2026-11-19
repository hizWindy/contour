/**
 * Today (PLAN-V22 T2-2, choices 6 to 9), at /assistant: the Assistant's first page. The rep's day,
 * the most urgent first, in four parts: their open HubSpot tasks (overdue, today's, then the next
 * 7 days', folded), their meetings today and tomorrow with each pre-read's state, their calls to
 * confirm, and their open deals that need a nudge. It makes no Claude request, so it is free.
 *
 * - **The tasks** come from HubSpot, kept by the server for 5 minutes. Sync reads them again (at
 *   most once a minute), and the line under the header says when ("Checked 8:12 am"). When they
 *   can't show, the server's sentence says why (`tasks_sentence`, which names the Platform admin
 *   where one is needed), and the other parts still show. "Done" ticks a task in HubSpot at once,
 *   with Undo (`use-done.ts`).
 * - **Each row's main button:** Log a call (a call task), Draft the pre-read or Open (a meeting),
 *   or Open (the company, or Call logs' tab). "Open in HubSpot" shows only where HubSpot gave a
 *   link (TBC: whether it gives tasks one, at the live check).
 * - **Keys** (choice 8): J and K move, Enter does the row's main button, D ticks a task done, and
 *   L logs a call with the row's company. V on a row that names no company uses the row's company:
 *   the page tells the voice bar (`voice/on-screen.ts`). The rows are plain rows, never a list box
 *   or a menu, so V works here.
 * - **Rows don't move** when the list updates (a list used all day barely moves). A task ticked
 *   done fades out in 150ms, and Undo brings it back.
 * - **Every state:** a still skeleton at the real size after 200ms, "Nothing due today." in the
 *   serif voice, and the errors in plain words.
 * - **The layout:** two columns on a laptop, the tasks first; one column on a phone, with "Speak"
 *   pinned at the bottom (choice 13).
 * - **"Add task" and "Email the team"** (PLAN-V23 T4-3) open the review card empty. No AI reads
 *   anything, so they work while the AI is off or busy; Ctrl+K has them too.
 * - **After L** (or a row's "Log a call"), as the Log call panel closes, the focus goes back to the
 *   row it came from (PLAN-V23 T4-3), so J and K carry on from there by keyboard.
 */
import { ChevronRight, ListPlus, ListTodo, Mail, RotateCcw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { todayKey, useToday } from '@/api/hooks/assistant'
import { useCallNoteOptions } from '@/api/hooks/call-note-counts'
import { useStartMeetingForm } from '@/api/hooks/meetings'
import type { Today, TodayCompany, TodayMeeting, TodayTask } from '@/api/types'
import type { LogTarget } from '@/apps/companies/call-logs/log-call'
import { callLogsHref } from '@/apps/companies/call-logs/params'
import { preReadHref } from '@/apps/companies/meetings/params'
import { SyncButton, SyncLine } from '@/apps/companies/meetings/sync'
import { CHECK_AND_SEND } from '@/apps/companies/meetings/words'
import { LOG_A_CALL } from '@/apps/companies/words'
import { useCan, useCanWrite, useIsViewer } from '@/auth/can'
import { FeatureGuard } from '@/auth/guard'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { ListExit, ListExitItem } from '@/components/motion'
import { PageHeader } from '@/components/page-header'
import { Pending, SkeletonLines } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useListKeyboard } from '@/hooks/useListKeyboard'
import { melbourneDate } from '@/lib/format'
import { toastProblem } from '@/lib/problems'
import { safeHref } from '@/lib/safe-href'
import { cn } from '@/lib/utils'
import { openCard } from '../card/store'
import { showOnScreen } from '../voice/on-screen'
import { useVKeyOn } from '../voice/v-switch'
import { ADD_TASK, EMAIL_THE_TEAM, TODAY, TODAY_PURPOSE } from '../words'
import {
  callsRows,
  companyOf,
  dealRowId,
  meetingRowId,
  nextRowId,
  nothingToday,
  onPageOfRow,
  rowsOf,
  sees,
  taskGroups,
  taskRowId,
  type TodayRow,
} from './rows'
import { CallsRow, DealRow, MeetingRow, TaskRow, type RowAct, type RowBase } from './rows-view'
import { SpeakBar } from './speak-bar'
import { useTaskDone } from './use-done'
import { useTodaySync } from './use-sync'
import {
  CALLS,
  DEALS,
  dealsMoreWords,
  DRAFT_PRE_READ,
  LOADING_TODAY,
  MEETINGS,
  NO_CALLS,
  NO_DEALS,
  NO_MEETINGS,
  NO_TASKS,
  NOTHING_DUE,
  NOTHING_DUE_NEXT,
  NOTHING_DUE_NEXT_TOUCH,
  OPEN,
  OPEN_IN_HUBSPOT,
  soonWords,
  SYNC_TASKS_NOTE,
  TASK_GROUPS,
  TASKS,
  tasksMoreWords,
  TODAY_FAILED,
  TODAY_LABEL,
  TOMORROW_LABEL,
  TRY_AGAIN,
} from './words'

const TodayLogCall = lazy(() => import('./log-call'))

function companyHref(key: string): string {
  return `/companies/${encodeURIComponent(key)}`
}

function rowSelector(id: string): string {
  return `[data-row="${CSS.escape(id)}"]`
}

function focusRow(id: string): void {
  const row = document.querySelector<HTMLElement>(rowSelector(id))
  row?.focus({ preventScroll: true })
  row?.scrollIntoView({ block: 'nearest' })
}

/** One part of the day: a card with its title, and its rows or its one line. */
function Part({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId()
  return (
    <section
      aria-labelledby={titleId}
      data-slot="today-part"
      className="flex flex-col overflow-hidden rounded-lg border bg-card"
    >
      <h2
        id={titleId}
        className="px-4 pt-4 pb-3 text-section font-semibold text-foreground sm:px-6"
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

/** A part's one quiet line: empty (in the serif voice), or how many more there are. */
function PartLine({ children, serif = false }: { children: ReactNode; serif?: boolean }) {
  return (
    <p
      className={cn(
        'border-t px-4 py-3 text-ui text-muted-foreground sm:px-6',
        serif && 'font-serif',
      )}
    >
      {children}
    </p>
  )
}

/** A group's title inside a part: "Overdue", "Today". */
function GroupTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="border-t px-4 pt-3 pb-1 text-caption font-semibold text-muted-foreground sm:px-6">
      {children}
    </h3>
  )
}

/** The page's shape while Today loads: four parts with their rows, still, after 200ms. */
function TodayPending() {
  return (
    <Pending label={LOADING_TODAY}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="rounded-lg border bg-card p-6">
          <SkeletonLines count={6} />
        </div>
        <div className="flex flex-col gap-6">
          {[3, 2, 3].map((count, index) => (
            <div key={index} className="rounded-lg border bg-card p-6">
              <SkeletonLines count={count} />
            </div>
          ))}
        </div>
      </div>
    </Pending>
  )
}

/** What the tasks part says when its tasks can't show, or show from an earlier read. */
function TasksSentence({ today, onRetry }: { today: Today; onRetry: () => void }) {
  const sentence = today.tasks_sentence?.trim()
  if (!sentence) return null
  // A read that failed, or a key that can't read tasks: one more try may help. The rest can't.
  const retry = today.tasks_state === 'failed' || today.tasks_state === 'no_access'
  return (
    <div className="flex flex-col items-start gap-3 border-t px-4 py-3 sm:px-6">
      <p role="status" data-slot="tasks-sentence" className="text-ui text-foreground">
        {sentence}
      </p>
      {retry ? (
        <Button type="button" variant="outline" size="sm" className="touch:h-11" onClick={onRetry}>
          <RotateCcw aria-hidden="true" />
          {TRY_AGAIN}
        </Button>
      ) : null}
    </div>
  )
}

function TodayParts({
  today,
  day,
  onRetryTasks,
}: {
  today: Today
  day: string
  onRetryTasks: () => void
}) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const viewer = useIsViewer()
  const vOn = useVKeyOn()
  const canCompanies = useCan('companies.companies')
  const canDraft = useCanWrite('companies.meetings')
  const canLogCalls = useCanWrite('companies.call_logs')
  const callsOn = useCallNoteOptions(canLogCalls).data?.enabled === true
  const logOn = canLogCalls && callsOn
  const done = useTaskDone()
  const startForm = useStartMeetingForm()
  const draftingId = startForm.isPending ? (startForm.variables.meeting_id ?? null) : null

  const [soonOpen, setSoonOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [logging, setLogging] = useState<LogTarget | null>(null)
  const [logAsked, setLogAsked] = useState(false)
  // The row Log call was opened from: the focus goes back to it as the panel closes.
  const logRow = useRef<string | null>(null)

  const rows = rowsOf(today, { soonOpen })
  const ids = rows.map((row) => row.id)
  const active = rows.find((row) => row.id === activeId)

  // V on the active row, naming no company, uses its company (choice 8).
  const shownPage = onPageOfRow(active)
  const shownName = companyOf(active)?.name ?? null
  const companyKey = shownPage?.company_key ?? null
  const meetingId = shownPage?.meeting_id ?? null
  const formId = shownPage?.form_id ?? null
  useEffect(() => {
    if (!companyKey) return undefined
    showOnScreen({
      onPage: {
        company_key: companyKey,
        ...(meetingId ? { meeting_id: meetingId } : {}),
        ...(formId ? { form_id: formId } : {}),
      },
      names: shownName ? [shownName] : [],
    })
    return () => {
      showOnScreen(null)
    }
  }, [companyKey, meetingId, formId, shownName])

  const logWith = (company: TodayCompany, rowId: string): void => {
    logRow.current = rowId
    setLogAsked(true)
    setLogging({ companyKey: company.key, companyName: company.name })
  }

  /** As Log call closes: back to its row, if the row is still there (PLAN-V23 T4-3). */
  const backToRow = (): boolean => {
    const id = logRow.current
    logRow.current = null
    if (!id || !document.querySelector(rowSelector(id))) return false
    setActiveId(id)
    focusRow(id)
    return true
  }

  const draft = (meeting: TodayMeeting): void => {
    if (!meeting.id) return
    startForm.mutate(
      { meeting_id: meeting.id, where: 'unknown' },
      {
        onSuccess: (form) => {
          // The meeting has its pre-read now: Today shows it so on the way back.
          void client.invalidateQueries({ queryKey: todayKey() })
          void navigate(preReadHref(form.id))
        },
        onError: toastProblem,
      },
    )
  }

  const tickDone = (task: TodayTask): void => {
    const id = taskRowId(task)
    // The focus doesn't leave with the row: it moves on to the next one.
    const next = nextRowId(ids, id)
    const focused = document.activeElement?.closest(rowSelector(id))
    if (activeId === id || focused) {
      setActiveId(next)
      if (next) focusRow(next)
    }
    done(task)
  }

  /** A row's main button. */
  const mainOf = (row: TodayRow): RowAct | null => {
    switch (row.kind) {
      case 'task': {
        const { task } = row
        const company = task.company
        if (task.kind === 'call' && company && logOn) {
          return {
            label: LOG_A_CALL,
            run: () => {
              logWith(company, row.id)
            },
            shortcut: 'L',
          }
        }
        if (company && canCompanies) return { label: OPEN, to: companyHref(company.key) }
        return task.hubspot_url ? { label: OPEN_IN_HUBSPOT, href: task.hubspot_url } : null
      }
      case 'meeting': {
        const { meeting } = row
        if (meeting.form) {
          return {
            label: canDraft && meeting.form.status === 'draft' ? CHECK_AND_SEND : OPEN,
            to: preReadHref(meeting.form.id),
          }
        }
        if (meeting.id && canDraft) {
          return {
            label: DRAFT_PRE_READ,
            run: () => {
              draft(meeting)
            },
            busy: draftingId === meeting.id,
          }
        }
        return null
      }
      case 'calls':
        return { label: OPEN, to: callLogsHref(row.tab) }
      case 'deal': {
        const { deal } = row
        if (canCompanies) return { label: OPEN, to: companyHref(deal.company.key) }
        return deal.hubspot_url ? { label: OPEN_IN_HUBSPOT, href: deal.hubspot_url } : null
      }
    }
  }

  const enter = (row: TodayRow): void => {
    const main = mainOf(row)
    if (!main) return
    if ('to' in main) void navigate(main.to)
    else if ('href' in main) {
      // The same guard as the link button: only a plain web address opens.
      const safe = safeHref(main.href)
      if (safe) window.open(safe, '_blank', 'noopener,noreferrer')
    } else if (!main.busy) main.run()
  }

  const rowById = (id: string): TodayRow | undefined => rows.find((row) => row.id === id)

  useListKeyboard({
    enabled: ids.length > 0,
    ids,
    activeId,
    onActiveChange: (id) => {
      setActiveId(id)
      focusRow(id)
    },
    onOpen: (id) => {
      const row = rowById(id)
      if (row) enter(row)
    },
    letters: {
      d: (id) => {
        const row = rowById(id)
        if (row?.kind === 'task' && !viewer) tickDone(row.task)
      },
      l: (id) => {
        const company = companyOf(rowById(id))
        if (company && logOn) logWith(company, id)
      },
    },
  })

  const base = (row: TodayRow): RowBase => ({
    id: row.id,
    active: row.id === activeId,
    onActivate: (id: string) => {
      if (activeId !== id) setActiveId(id)
    },
    main: mainOf(row),
    onEnter: () => {
      enter(row)
    },
  })

  const taskRow = (task: TodayTask) => {
    const row: TodayRow = { kind: 'task', id: taskRowId(task), task }
    return (
      <ListExitItem key={row.id}>
        <TaskRow
          {...base(row)}
          task={task}
          today={day}
          onDone={
            viewer
              ? null
              : () => {
                  tickDone(task)
                }
          }
        />
      </ListExitItem>
    )
  }

  const soon = taskGroups(today.tasks).find((one) => one.group === 'soon')
  // Overdue and today's stay drawn while empty, so the last task ticked done in one still fades
  // out: only the group's title goes at once.
  const near = (['overdue', 'today'] as const).map((group) => ({
    group,
    tasks: today.tasks.filter((task) => task.group === group),
  }))
  const meetingDays: [string, TodayMeeting[]][] = [
    [TODAY_LABEL, today.meetings.filter((meeting) => meeting.day === 'today')],
    [TOMORROW_LABEL, today.meetings.filter((meeting) => meeting.day === 'tomorrow')],
  ]
  const calls = callsRows(today)

  const tasksPart = sees(today, 'tasks') ? (
    <Part title={TASKS}>
      <TasksSentence today={today} onRetry={onRetryTasks} />
      {near.map(({ group, tasks }) => (
        <div key={group}>
          {tasks.length > 0 ? <GroupTitle>{TASK_GROUPS[group]}</GroupTitle> : null}
          <ListExit className="divide-y">{tasks.map(taskRow)}</ListExit>
        </div>
      ))}
      {soon ? (
        <Collapsible open={soonOpen} onOpenChange={setSoonOpen} className="border-t">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mx-2 my-2 touch:h-11 sm:mx-4"
            >
              <ChevronRight
                aria-hidden="true"
                className={cn('transition-transform duration-150', soonOpen && 'rotate-90')}
              />
              {soonWords(soon.tasks.length)}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ListExit className="divide-y border-t">{soon.tasks.map(taskRow)}</ListExit>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      {today.tasks_more > 0 ? <PartLine>{tasksMoreWords(today.tasks_more)}</PartLine> : null}
      {today.tasks_state === 'ok' && today.tasks.length === 0 ? (
        <PartLine serif>{NO_TASKS}</PartLine>
      ) : null}
    </Part>
  ) : null

  const otherParts = (
    <>
      {sees(today, 'meetings') ? (
        <Part title={MEETINGS}>
          {today.meetings.length === 0 ? <PartLine serif>{NO_MEETINGS}</PartLine> : null}
          {meetingDays.map(([label, meetings]) =>
            meetings.length > 0 ? (
              <div key={label}>
                <GroupTitle>{label}</GroupTitle>
                <ul className="divide-y">
                  {meetings.map((meeting) => {
                    const row: TodayRow = { kind: 'meeting', id: meetingRowId(meeting), meeting }
                    return (
                      <li key={row.id}>
                        <MeetingRow
                          {...base(row)}
                          meeting={meeting}
                          drafting={meeting.id !== null && draftingId === meeting.id}
                        />
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : null,
          )}
        </Part>
      ) : null}
      {sees(today, 'calls') ? (
        <Part title={CALLS}>
          {calls.length === 0 ? (
            <PartLine serif>{NO_CALLS}</PartLine>
          ) : (
            <ul className="divide-y border-t">
              {calls.map((row) => (
                <li key={row.id}>
                  <CallsRow {...base(row)} tab={row.tab} count={row.count} />
                </li>
              ))}
            </ul>
          )}
        </Part>
      ) : null}
      {sees(today, 'deals') ? (
        <Part title={DEALS}>
          {today.deals.length === 0 ? (
            <PartLine serif>{NO_DEALS}</PartLine>
          ) : (
            <ul className="divide-y border-t">
              {today.deals.map((deal) => {
                const row: TodayRow = { kind: 'deal', id: dealRowId(deal), deal }
                return (
                  <li key={row.id}>
                    <DealRow {...base(row)} deal={deal} />
                  </li>
                )
              })}
            </ul>
          )}
          {today.deals_more > 0 ? <PartLine>{dealsMoreWords(today.deals_more)}</PartLine> : null}
        </Part>
      ) : null}
    </>
  )

  return (
    <>
      {nothingToday(today) ? (
        <EmptyState
          title={NOTHING_DUE}
          description={
            viewer ? undefined : vOn ? (
              <>
                <span className="touch:hidden">{NOTHING_DUE_NEXT}</span>
                <span className="hidden touch:inline">{NOTHING_DUE_NEXT_TOUCH}</span>
              </>
            ) : (
              // "Use V to speak" off (PLAN-V23 T4-1): the words name the Speak button instead.
              NOTHING_DUE_NEXT_TOUCH
            )
          }
        />
      ) : tasksPart ? (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {tasksPart}
          <div className="flex flex-col gap-6">{otherParts}</div>
        </div>
      ) : (
        <div className="flex max-w-3xl flex-col gap-6">{otherParts}</div>
      )}
      {logAsked ? (
        <Suspense fallback={null}>
          <TodayLogCall
            target={logging}
            onClose={() => {
              setLogging(null)
            }}
            focusBack={backToRow}
          />
        </Suspense>
      ) : null}
      <SpeakBar />
    </>
  )
}

/**
 * "Add task" and "Email the team" (PLAN-V23 T4-3): the review card, empty, for the rep to fill in.
 * Not for a Viewer, who sends nothing.
 */
function CardButtons() {
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="touch:h-11"
        onClick={() => {
          openCard({ kind: 'empty', action: 'task' })
        }}
      >
        <ListPlus aria-hidden="true" />
        {ADD_TASK}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="touch:h-11"
        onClick={() => {
          openCard({ kind: 'empty', action: 'email' })
        }}
      >
        <Mail aria-hidden="true" />
        {EMAIL_THE_TEAM}
      </Button>
    </>
  )
}

function TodayContent() {
  const today = useToday()
  const day = melbourneDate()
  const sync = useTodaySync(today.data, day)
  // Whoever may send from the Assistant: the Call logs or Meetings tick, and not a Viewer.
  const canSend = useCanWrite('companies.call_logs', 'companies.meetings')
  const header = (
    <PageHeader
      icon={ListTodo}
      tone="companies"
      title={TODAY}
      description={TODAY_PURPOSE}
      actions={
        canSend || today.data ? (
          <>
            {canSend ? <CardButtons /> : null}
            {today.data ? <SyncButton sync={sync} note={SYNC_TASKS_NOTE} /> : null}
          </>
        ) : null
      }
    />
  )
  if (!today.data) {
    return (
      <>
        {header}
        {today.error ? (
          <ErrorState
            error={today.error}
            context={TODAY_FAILED}
            onRetry={() => void today.refetch()}
          />
        ) : (
          <>
            {/* The Checked line's room, so the parts don't move when it comes. */}
            <div aria-hidden="true" className="min-h-5" />
            <TodayPending />
          </>
        )}
      </>
    )
  }
  return (
    <>
      {header}
      <SyncLine line={sync.line} />
      <TodayParts today={today.data} day={day} onRetryTasks={sync.press} />
    </>
  )
}

export default function TodayPage() {
  return (
    <FeatureGuard feature={['companies.call_logs', 'companies.meetings']} page={TODAY}>
      <TodayContent />
    </FeatureGuard>
  )
}
