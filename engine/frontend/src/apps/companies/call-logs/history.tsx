/**
 * History (PLAN-V18 T3-6): every call the rep logged, newest first, grouped by day, with a search
 * and filters. It takes the place of Activity's "Logged".
 *
 * - **By day:** "Today", "Yesterday", "Mon 14 Nov". Each day's heading stays at the top while its
 *   calls scroll under it.
 * - **One row a call.** Wide (the list is 42rem or more across, a container query, so a narrow
 *   window with the menu open counts too): the time in a column of its own, the company, the
 *   person, the summary's first line, and at the right how it went (a dot and a word, never colour
 *   alone), where it stands, and small marks for its follow-ups and field changes and how it was
 *   logged. Narrow (a phone, 17 Nov 2026): four short lines, with nothing cut off at the right and
 *   no icon without its words: the company and the chevron; the time and the person; the summary,
 *   up to two lines; then how it went, where it stands, and "1 follow-up".
 * - **A row opens in place,** one at a time: the whole note, the changes (old to new), the
 *   follow-ups, each step's result, how it was logged, "Open in HubSpot", and "Log another call
 *   with" the company. The rows under it glide down (Motion's `layout`, as a transform), but not
 *   in a list of more than 50 rows, which never moves (DESIGN.md "Speed budget").
 * - **The search and the filters** are in `history-filters.tsx`: all in the open, or behind one
 *   Filters button on a phone. All of them live in the address, so Back and a link keep them.
 * - **"Show older"** brings 50 more; the older days rise 4px and fade in.
 * - **Keys:** J and K move, Enter opens, and / goes to the search.
 *
 * A list used all day barely moves: rows never fade in on their own, and nothing moves on hover.
 */
import {
  ChevronDown,
  CircleCheck,
  FileText,
  Hourglass,
  ListTodo,
  Mic,
  NotebookPen,
  PencilLine,
  SendHorizontal,
  TriangleAlert,
  Type,
  X,
  type LucideIcon,
} from 'lucide-react'
import { m } from 'motion/react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { useCallNoteHistory } from '@/api/hooks/call-notes'
import type { CallNoteOptions, CallNoteOut } from '@/api/types'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { EASE, INSTANT, springs } from '@/components/motion/springs'
import { useStill } from '@/components/motion/use-still'
import { Button } from '@/components/ui/button'
import { dueDateText } from '@/lib/due-date'
import { formatTime, melbourneDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { HistoryToolbar } from './history-filters'
import type { LogTarget } from './log-call'
import { isCallNotesOff } from './notes'
import { OpenInHubSpot } from './open-in-hubspot'
import {
  filtered,
  historyQuery,
  NO_FILTERS,
  readHistory,
  writeHistory,
  type HistoryFilters,
} from './params'
import { CallNotesOff, RowsPending } from './states'
import {
  CHANGES,
  changeLabel,
  changeWords,
  CLEAR_FILTERS,
  dayHeading,
  EMPTY,
  fieldValue,
  FOLLOW_UPS,
  forWhom,
  HISTORY_FAILED,
  HISTORY_KEYS,
  HISTORY_LIST,
  HOW_LOGGED,
  isMeetingNotes,
  KIND_LABELS,
  logAnotherWords,
  marksWords,
  MEETING_NOTES,
  NO_MATCH,
  NO_OUTCOME,
  personLine,
  SHOW_OLDER,
  SOURCE_WORDS,
  STANDING_WORDS,
  stepName,
  SUMMARY,
  THE_NOTE,
  WHAT_HAPPENED_TO_IT,
} from './words'

const HISTORY_LIST_ID = 'history-list'

/** A list longer than this never moves (DESIGN.md "Speed budget"). */
const STILL_ABOVE = 50

/** The opened part fades in (150ms, the one curve). */
const OPEN_IN = { duration: 0.15, ease: EASE } as const

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'
const ROW = 'data-history-row'

type Standing = keyof typeof STANDING_WORDS

/** Where a call stands, from its status. */
function standingOf(note: Pick<CallNoteOut, 'status'>): Standing {
  switch (note.status) {
    case 'logged':
      return 'logged'
    case 'sending':
      return 'sending'
    case 'partial':
    case 'failed':
    case 'uncertain':
      return 'needs_look'
    default:
      return 'to_confirm'
  }
}

const STANDING_LOOK: Readonly<Record<Standing, { icon: LucideIcon; tone: string }>> = {
  logged: { icon: CircleCheck, tone: 'text-pass-ink' },
  to_confirm: { icon: Hourglass, tone: 'text-muted-foreground' },
  sending: { icon: SendHorizontal, tone: 'text-muted-foreground' },
  needs_look: { icon: TriangleAlert, tone: 'text-destructive-ink' },
}

/** How it went, as a dot's colour (TBC at the look). The word always goes with it. */
const OUTCOME_TONE: Readonly<Record<string, string>> = {
  Connected: 'text-pass',
  'Left voicemail': 'text-review',
  'Left live message': 'text-review',
  'Wrong number': 'text-destructive',
}

const SOURCE_ICON: Readonly<Record<CallNoteOut['source'], LucideIcon>> = {
  mic: Mic,
  typed: Type,
  transcript: FileText,
}

/** The calls, in days, newest first, as the server sends them. */
function byDay(
  notes: readonly CallNoteOut[],
  today: string,
): { day: string; heading: string; notes: CallNoteOut[] }[] {
  const days: { day: string; heading: string; notes: CallNoteOut[] }[] = []
  for (const note of notes) {
    const day = melbourneDate(note.called_at)
    const last = days.at(-1)
    if (last?.day === day) last.notes.push(note)
    else days.push({ day, heading: dayHeading(day, today), notes: [note] })
  }
  return days
}

function Dot({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 8 8" className={cn('size-2 shrink-0', className)}>
      <circle cx="4" cy="4" r="4" fill="currentColor" />
    </svg>
  )
}

function Outcome({ note }: { note: CallNoteOut }) {
  if (isMeetingNotes(note)) {
    // A meeting has no call outcome: it says what it is instead.
    return (
      <span className="flex items-center gap-1.5 text-caption text-foreground">
        <Dot className="text-muted-foreground" />
        {MEETING_NOTES}
      </span>
    )
  }
  const outcome = note.call.outcome
  return (
    <span className="flex items-center gap-1.5 text-caption text-foreground">
      <Dot
        className={outcome ? (OUTCOME_TONE[outcome] ?? 'text-muted-foreground') : 'text-border'}
      />
      {outcome ?? NO_OUTCOME}
    </span>
  )
}

function StandingMark({ note }: { note: CallNoteOut }) {
  const standing = standingOf(note)
  const { icon: Icon, tone } = STANDING_LOOK[standing]
  return (
    <span className={cn('flex items-center gap-1.5 text-caption', tone)}>
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {STANDING_WORDS[standing]}
    </span>
  )
}

/**
 * The follow-ups and field changes of a call, and how it was logged. A screen reader hears them
 * once, in words (the `sr-only` span). To the eye: a wide row has small icons with counts (a
 * tooltip names each), and a narrow one has the counts in words, because a touch screen has no
 * tooltip and an icon alone says nothing (17 Nov 2026). How it was logged shows in words under
 * the opened call, so no row has a bare microphone.
 */
function Marks({ note }: { note: CallNoteOut }) {
  const SourceIcon = SOURCE_ICON[note.source]
  const tasks = note.tasks.length
  const changes = note.changes.length
  const counts = marksWords(tasks, changes)
  const words = [...counts, SOURCE_WORDS[note.source]]
  return (
    <>
      <span className="sr-only">{words.join(', ')}</span>
      {counts.length > 0 ? (
        <span aria-hidden="true" className="text-caption text-muted-foreground @2xl:hidden">
          {counts.join(' · ')}
        </span>
      ) : null}
      <span
        aria-hidden="true"
        className="hidden items-center gap-2 text-caption text-muted-foreground @2xl:flex"
      >
        {tasks > 0 ? (
          <span
            title={marksWords(tasks, 0).join('')}
            className="flex items-center gap-0.5 tabular-nums"
          >
            <ListTodo className="size-3.5" />
            {tasks}
          </span>
        ) : null}
        {changes > 0 ? (
          <span
            title={marksWords(0, changes).join('')}
            className="flex items-center gap-0.5 tabular-nums"
          >
            <PencilLine className="size-3.5" />
            {changes}
          </span>
        ) : null}
        <span title={SOURCE_WORDS[note.source]}>
          <SourceIcon className="size-3.5" />
        </span>
      </span>
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1.5">
      <h4 id={id} className="text-caption font-semibold text-muted-foreground">
        {title}
      </h4>
      {children}
    </section>
  )
}

/** A call opened in place: everything about it, and what to do next. */
function Opened({
  note,
  options,
  onLogCall,
}: {
  note: CallNoteOut
  options: CallNoteOptions
  onLogCall: (target: LogTarget) => void
}) {
  const still = useStill()
  const kinds = new Map(options.fields.map((field) => [field.id, field.kind]))
  const summary = note.call.summary.trim()
  return (
    <m.div
      data-slot="history-opened"
      className="flex flex-col gap-4 border-t bg-card px-4 pt-3 pb-4 @2xl:pl-24"
      initial={still ? false : { opacity: 0 }}
      animate={{ opacity: 1, transition: still ? INSTANT : OPEN_IN }}
    >
      {summary ? (
        <Section title={SUMMARY}>
          <p className="max-w-prose text-pretty text-foreground">{summary}</p>
        </Section>
      ) : null}
      {note.text.trim() ? (
        <Section title={THE_NOTE}>
          <p className="max-w-prose whitespace-pre-wrap text-pretty text-foreground">{note.text}</p>
        </Section>
      ) : null}
      {note.changes.length > 0 ? (
        <Section title={CHANGES}>
          <ul className="flex flex-col gap-1">
            {note.changes.map((change) => {
              const kind = kinds.get(change.field)
              return (
                <li key={change.id} className="text-foreground">
                  <span className="font-semibold">
                    {changeLabel(change.label, change.office)}:{' '}
                  </span>
                  {changeWords(fieldValue(change.current, kind), fieldValue(change.value, kind))}
                </li>
              )
            })}
          </ul>
        </Section>
      ) : null}
      {note.tasks.length > 0 ? (
        <Section title={FOLLOW_UPS}>
          <ul className="flex flex-col gap-1">
            {note.tasks.map((task) => (
              <li key={task.id} className="text-foreground">
                {task.subject}
                <span className="text-muted-foreground">
                  {' '}
                  · {KIND_LABELS[task.kind]} · {dueDateText(task.due)} · {forWhom(task.owner)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {note.steps.length > 0 ? (
        <Section title={WHAT_HAPPENED_TO_IT}>
          <ul className="flex flex-col gap-1">
            {note.steps.map((step) => (
              <li key={step.step} className="text-foreground">
                <span className="font-semibold">{stepName(step.step, isMeetingNotes(note))}: </span>
                {step.words}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <p className="text-caption text-muted-foreground">
        <span className="font-semibold">{HOW_LOGGED}:</span> {SOURCE_WORDS[note.source]}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <OpenInHubSpot
          href={note.hubspot_url}
          company={note.company_name}
          meeting={isMeetingNotes(note)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="touch:h-11 max-sm:w-full"
          onClick={() => {
            onLogCall({ companyKey: note.company_key, companyName: note.company_name })
          }}
        >
          <NotebookPen aria-hidden="true" />
          {logAnotherWords(note.company_name)}
        </Button>
      </div>
    </m.div>
  )
}

function Row({
  note,
  open,
  moves,
  fresh,
  options,
  onToggle,
  onLogCall,
}: {
  note: CallNoteOut
  open: boolean
  /** The rows glide when one opens; a long list never moves. */
  moves: boolean
  /** Brought by "Show older": it rises 4px and fades in, once. */
  fresh: boolean
  options: CallNoteOptions
  onToggle: () => void
  onLogCall: (target: LogTarget) => void
}) {
  const still = useStill()
  const openedId = useId()
  const summary = (note.call.summary.trim() || note.text.trim()).split('\n')[0] ?? ''
  const person = note.person ? personLine(note.person) : null
  const time = formatTime(note.called_at)
  const chevron = (
    <ChevronDown
      aria-hidden="true"
      className={cn(
        'size-4 shrink-0 text-muted-foreground transition-transform duration-150',
        open && 'rotate-180',
      )}
    />
  )
  return (
    <m.li
      layout={moves ? 'position' : false}
      transition={springs.smooth}
      initial={fresh && !still ? { opacity: 0, y: 4 } : false}
      animate={{ opacity: 1, y: 0 }}
      data-slot="history-row"
      data-open={open || undefined}
      className="bg-card"
    >
      <button
        type="button"
        {...{ [ROW]: note.id }}
        aria-expanded={open}
        aria-controls={open ? openedId : undefined}
        onClick={onToggle}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 py-3 text-left transition-colors outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset @2xl:grid-cols-[5rem_minmax(0,1fr)_auto] touch:py-3.5"
      >
        {/* Wide: the time has a column of its own. */}
        <span className="hidden pt-px text-caption text-muted-foreground tabular-nums @2xl:col-start-1 @2xl:row-start-1 @2xl:block">
          {time}
        </span>
        <span className="col-start-1 row-start-1 flex min-w-0 items-baseline gap-1.5 @2xl:col-start-2">
          <span className="truncate font-semibold text-foreground">{note.company_name}</span>
          {person ? (
            <span className="hidden truncate text-caption text-muted-foreground @2xl:inline">
              {person}
            </span>
          ) : null}
        </span>
        {/* Narrow: the chevron beside the company, so it never drops to a line of its own. */}
        <span className="col-start-2 row-start-1 flex items-center @2xl:hidden">{chevron}</span>
        {/* Narrow: the time and the person on one line. */}
        <span className="col-span-2 row-start-2 min-w-0 truncate text-caption text-muted-foreground @2xl:hidden">
          <span className="tabular-nums">{time}</span>
          {person ? ` · ${person}` : null}
        </span>
        {summary ? (
          <span className="col-span-2 row-start-3 min-w-0 line-clamp-2 text-foreground @2xl:col-span-1 @2xl:col-start-2 @2xl:row-start-2 @2xl:line-clamp-1">
            {summary}
          </span>
        ) : null}
        <span className="col-span-2 row-start-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 @2xl:col-span-1 @2xl:col-start-3 @2xl:row-start-1 @2xl:justify-end">
          <Outcome note={note} />
          <StandingMark note={note} />
          <Marks note={note} />
          <span className="hidden items-center @2xl:flex">{chevron}</span>
        </span>
      </button>
      {open ? (
        <div id={openedId}>
          <Opened note={note} options={options} onLogCall={onLogCall} />
        </div>
      ) : null}
    </m.li>
  )
}

export interface HistoryProps {
  options: CallNoteOptions
  today: string
  /** "Log another call with" a company: the page opens Log call for it. */
  onLogCall: (target: LogTarget) => void
}

export function History({ options, today, onLogCall }: HistoryProps) {
  const [params, setParams] = useSearchParams()
  const filters = readHistory(params)
  const query = historyQuery(filters, today)
  const list = useCallNoteHistory(query)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  // Rows from here on came with "Show older": they rise and fade in, once.
  const [revealFrom, setRevealFrom] = useState<number | null>(null)
  const queryKey = JSON.stringify(query)
  const [shownKey, setShownKey] = useState(queryKey)
  if (queryKey !== shownKey) {
    setShownKey(queryKey)
    setRevealFrom(null)
    setOpenId(null)
  }

  const change = (next: HistoryFilters): void => {
    setParams((current) => writeHistory(current, next), { replace: true, preventScrollReset: true })
  }

  // The keys, from anywhere on the page but a field, a dialog or a menu: / goes to the search, and
  // J and K move between the calls (Enter, the row's own button, opens one).
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest(`${EDITABLE}, [role=dialog], [role=menu], [role=listbox]`)) return
      if (event.key === '/') {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }
      const key = event.key.toLowerCase()
      if (key !== 'j' && key !== 'k') return
      const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>(`[${ROW}]`) ?? [])
      if (rows.length === 0) return
      event.preventDefault()
      const here = rows.findIndex((row) => row === document.activeElement)
      const next =
        here === -1 ? 0 : Math.max(0, Math.min(rows.length - 1, here + (key === 'j' ? 1 : -1)))
      rows[next]?.focus()
      rows[next]?.scrollIntoView({ block: 'nearest' })
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const toolbar = (
    <HistoryToolbar
      filters={filters}
      options={options}
      onChange={change}
      searchRef={searchRef}
      total={list.data?.pages[0]?.total}
    />
  )

  if (isCallNotesOff(list.error)) return <CallNotesOff />
  let body: ReactNode
  if (list.error && !list.data) {
    body = (
      <ErrorState error={list.error} context={HISTORY_FAILED} onRetry={() => void list.refetch()} />
    )
  } else if (!list.data) {
    body = <RowsPending />
  } else {
    const notes = list.data.pages.flatMap((page) => page.items)
    if (notes.length === 0) {
      body = filtered(filters) ? (
        <EmptyState
          title={NO_MATCH.title}
          description={NO_MATCH.description}
          headingLevel={2}
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="touch:h-11"
              onClick={() => {
                change(NO_FILTERS)
              }}
            >
              <X aria-hidden="true" />
              {CLEAR_FILTERS}
            </Button>
          }
        />
      ) : (
        <EmptyState
          title={EMPTY.history.title}
          description={EMPTY.history.description}
          headingLevel={2}
        />
      )
    } else {
      const moves = notes.length <= STILL_ABOVE
      // Each call's place in the whole list, so the ones "Show older" brought can rise in.
      const places = new Map(notes.map((note, place) => [note.id, place]))
      body = (
        <div className="flex flex-col gap-3">
          <div
            ref={listRef}
            role="group"
            aria-label={HISTORY_LIST}
            aria-describedby={`${HISTORY_LIST_ID}-keys`}
            aria-busy={list.isPlaceholderData || undefined}
            className={cn(
              'flex flex-col gap-4 transition-opacity',
              // The old list dims while the new one loads, as the tables do.
              list.isPlaceholderData && 'opacity-60',
            )}
          >
            <p id={`${HISTORY_LIST_ID}-keys`} className="sr-only">
              {HISTORY_KEYS}
            </p>
            {byDay(notes, today).map((day) => (
              <m.section
                key={day.day}
                layout={moves ? 'position' : false}
                transition={springs.smooth}
                aria-labelledby={`history-${day.day}`}
                className="flex flex-col"
              >
                <h3
                  id={`history-${day.day}`}
                  className="sticky top-0 z-10 bg-background py-2 text-ui font-semibold text-foreground max-md:top-14"
                >
                  {day.heading}
                </h3>
                {/* The rows read this list's width, not the screen's (a container query). */}
                <ul className="@container flex flex-col divide-y overflow-hidden rounded-lg border bg-card text-ui">
                  {day.notes.map((note) => {
                    const place = places.get(note.id) ?? 0
                    return (
                      <Row
                        key={note.id}
                        note={note}
                        open={openId === note.id}
                        moves={moves}
                        fresh={revealFrom !== null && place >= revealFrom}
                        options={options}
                        onToggle={() => {
                          setOpenId((current) => (current === note.id ? null : note.id))
                        }}
                        onLogCall={onLogCall}
                      />
                    )
                  })}
                </ul>
              </m.section>
            ))}
          </div>
          {list.hasNextPage ? (
            <Button
              type="button"
              variant="outline"
              className="self-start touch:h-11"
              disabled={list.isFetchingNextPage}
              onClick={() => {
                setRevealFrom(notes.length)
                void list.fetchNextPage()
              }}
            >
              {SHOW_OLDER}
            </Button>
          ) : null}
        </div>
      )
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {toolbar}
      {body}
    </div>
  )
}
