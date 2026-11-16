/**
 * History (PLAN-V18 T3-6): every call the rep logged, newest first, grouped by day, with a search
 * and filters. It takes the place of Activity's "Logged".
 *
 * - **By day:** "Today", "Yesterday", "Mon 14 Nov". Each day's heading stays at the top while its
 *   calls scroll under it.
 * - **One row a call:** the time, the company, the person, how it went (a dot and a word, never
 *   colour alone), the summary's first line, and where it stands, with small marks for its
 *   follow-ups and field changes and how it was logged.
 * - **A row opens in place,** one at a time: the whole note, the changes (old to new), the
 *   follow-ups, each step's result, "Open in HubSpot", and "Log another call with" the company.
 *   The rows under it glide down (Motion's `layout`, as a transform), but not in a list of more
 *   than 50 rows, which never moves (DESIGN.md "Speed budget").
 * - **The search** (company, person, or words in the note) waits 250ms after the last key. The
 *   filters: how it went (chips), when (This week, This month, All) and where it stands. All of
 *   them live in the address, so Back and a link keep them.
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
  Search,
  SendHorizontal,
  TriangleAlert,
  Type,
  X,
  type LucideIcon,
} from 'lucide-react'
import { m } from 'motion/react'
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useSearchParams } from 'react-router'
import { useCallNoteHistory, type CallNoteOutcomeFilter } from '@/api/hooks/call-notes'
import type { CallNoteOptions, CallNoteOut } from '@/api/types'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { ChipGroup, Segmented } from '@/components/motion'
import { EASE, INSTANT, springs } from '@/components/motion/springs'
import { useStill } from '@/components/motion/use-still'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useDebounced } from '@/hooks/useDebounced'
import { dueDateText } from '@/lib/due-date'
import { formatTime, melbourneDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { LogTarget } from './log-call'
import { isCallNotesOff } from './notes'
import { OpenInHubSpot } from './open-in-hubspot'
import {
  filtered,
  historyQuery,
  NO_FILTERS,
  readHistory,
  SEARCH_MAX,
  writeHistory,
  type HistoryFilters,
  type HistoryWhen,
  type HistoryWhere,
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
  HOW_IT_WENT,
  isMeetingNotes,
  KIND_LABELS,
  logAnotherWords,
  marksWords,
  MEETING_NOTES,
  NO_MATCH,
  NO_OUTCOME,
  personLine,
  SEARCH_CALLS,
  SEARCH_PLACEHOLDER,
  SHOW_OLDER,
  SOURCE_WORDS,
  STANDING_WORDS,
  stepName,
  SUMMARY,
  THE_NOTE,
  WHAT_HAPPENED_TO_IT,
  WHEN_LABEL,
  WHEN_WORDS,
  WHERE_IT_STANDS,
  WHERE_WORDS,
} from './words'

const HISTORY_LIST_ID = 'history-list'

/** A list longer than this never moves (DESIGN.md "Speed budget"). */
const STILL_ABOVE = 50

/** How long the search waits after the last key. */
const SEARCH_WAIT_MS = 250

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

function Marks({ note }: { note: CallNoteOut }) {
  const SourceIcon = SOURCE_ICON[note.source]
  const tasks = note.tasks.length
  const changes = note.changes.length
  const words = [...marksWords(tasks, changes), SOURCE_WORDS[note.source]]
  return (
    <span className="flex items-center gap-2 text-caption text-muted-foreground">
      <span className="sr-only">{words.join(', ')}</span>
      {tasks > 0 ? (
        <span
          aria-hidden="true"
          title={marksWords(tasks, 0).join('')}
          className="flex items-center gap-0.5 tabular-nums"
        >
          <ListTodo className="size-3.5" />
          {tasks}
        </span>
      ) : null}
      {changes > 0 ? (
        <span
          aria-hidden="true"
          title={marksWords(0, changes).join('')}
          className="flex items-center gap-0.5 tabular-nums"
        >
          <PencilLine className="size-3.5" />
          {changes}
        </span>
      ) : null}
      <span aria-hidden="true" title={SOURCE_WORDS[note.source]}>
        <SourceIcon className="size-3.5" />
      </span>
    </span>
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
      className="flex flex-col gap-4 border-t bg-card px-4 pt-3 pb-4 sm:pl-24"
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
          className="touch:h-11"
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
        className="grid w-full grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-3 text-left transition-colors outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:grid-cols-[5rem_minmax(0,1fr)_auto] touch:py-3.5"
      >
        <span className="pt-px text-caption text-muted-foreground tabular-nums">
          {formatTime(note.called_at)}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate font-semibold text-foreground">{note.company_name}</span>
            {person ? (
              <span className="truncate text-caption text-muted-foreground">{person}</span>
            ) : null}
          </span>
          {summary ? <span className="truncate text-foreground">{summary}</span> : null}
        </span>
        <span className="col-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 sm:col-start-3 sm:row-start-1 sm:justify-end">
          <Outcome note={note} />
          <StandingMark note={note} />
          <Marks note={note} />
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-4 text-muted-foreground transition-transform duration-150',
              open && 'rotate-180',
            )}
          />
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

function Toolbar({
  filters,
  options,
  onChange,
  searchRef,
}: {
  filters: HistoryFilters
  options: CallNoteOptions
  onChange: (filters: HistoryFilters) => void
  searchRef: RefObject<HTMLInputElement | null>
}) {
  const outcomeId = useId()
  const whereId = useId()
  // The box answers each key at once; the address (and the server) hear it 250ms after the last.
  const [text, setText] = useState(filters.q)
  const waited = useDebounced(text, SEARCH_WAIT_MS)
  const [shownQ, setShownQ] = useState(filters.q)
  if (filters.q !== shownQ) {
    setShownQ(filters.q)
    // The filters were cleared, or Back changed them: the box follows. A change that came from the
    // box itself leaves it alone, so a key typed meanwhile is never lost.
    if (filters.q.trim() !== waited.trim()) setText(filters.q)
  }
  useEffect(() => {
    if (waited.trim() !== filters.q.trim()) onChange({ ...filters, q: waited })
    // `onChange` changes with the address; the search only follows the waited text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waited])

  const outcomes = [
    ...options.outcomes.map((value) => ({ value, label: value })),
    { value: 'none' as const, label: NO_OUTCOME },
  ]
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={searchRef}
            type="search"
            aria-label={SEARCH_CALLS}
            aria-keyshortcuts="/"
            placeholder={SEARCH_PLACEHOLDER}
            maxLength={SEARCH_MAX}
            value={text}
            className="pl-9 touch:text-body"
            onChange={(event) => {
              setText(event.target.value)
            }}
          />
        </div>
        <span id={whereId} className="sr-only">
          {WHERE_IT_STANDS}
        </span>
        <Select
          value={filters.where}
          onValueChange={(value) => {
            onChange({ ...filters, where: value as HistoryWhere })
          }}
        >
          <SelectTrigger aria-labelledby={whereId} className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(WHERE_WORDS) as HistoryWhere[]).map((value) => (
              <SelectItem key={value} value={value}>
                {value === 'all' ? `${WHERE_IT_STANDS}: ${WHERE_WORDS.all}` : WHERE_WORDS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Segmented<HistoryWhen>
          aria-label={WHEN_LABEL}
          size="sm"
          value={filters.when}
          onChange={(when) => {
            onChange({ ...filters, when })
          }}
          options={(['week', 'month', 'all'] as const).map((value) => ({
            value,
            label: WHEN_WORDS[value],
          }))}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span id={outcomeId} className="text-caption text-muted-foreground">
          {HOW_IT_WENT}
        </span>
        <ChipGroup<CallNoteOutcomeFilter>
          mode="one-or-none"
          aria-labelledby={outcomeId}
          options={outcomes}
          value={filters.outcome ? [filters.outcome] : []}
          onChange={([picked]) => {
            onChange({ ...filters, outcome: picked ?? null })
          }}
        />
      </div>
    </div>
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
    <Toolbar filters={filters} options={options} onChange={change} searchRef={searchRef} />
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
                <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card text-ui">
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
