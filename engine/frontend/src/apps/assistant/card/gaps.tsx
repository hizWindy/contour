/**
 * The gaps the card fills (PLAN-V25 Part 3, choices 12 to 14; the plan's "Words on screen", TBC at
 * Al-khair's look and with Levi):
 *
 * - **The call type** (T3-1): HubSpot's three, side by side, preset to the type heard. A tap or
 *   "make it a follow-up call" changes it.
 * - **A day not said** (T3-2): "Due Monday?", the next working day, with "In a week" and "Pick a
 *   day" beside it. The day suggested goes if the rep sends as it is: the question never holds a
 *   send up (TBC).
 * - **A task with no subject:** "Follow up with Jo Sample?", with "Use it" and "Type it".
 * - **A Connected call with no follow-up:** "No follow-up yet. Add one for Friday?", with "Add it"
 *   and "No". Not for No answer, Busy and the rest.
 *
 * Each question looks like the suggestion part's (`suggest.tsx`): the question in normal text, an
 * outline button and a ghost one, the 10px corner, and Send stays the card's one Navy button. A
 * question with a yes and a no (`data-slot="ask"`) takes "yes" and "no" by voice too (`card.tsx`).
 */
import { CalendarDays } from 'lucide-react'
import { lazy, Suspense, useId, useState, type ReactNode } from 'react'
import { CALL_TYPE, CALL_TYPE_LABELS, type CallType } from '@/apps/companies/call-logs/words'
import { Segmented } from '@/components/motion'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { ADD_IT, IN_A_WEEK, NO, nudgeWords, PICK_A_DAY, TYPE_IT, USE_IT } from './words'

/** The calendar (react-day-picker) loads only when "Pick a day" is near: never with the card. */
const loadCalendar = () =>
  import('@/components/ui/calendar').then((module) => ({ default: module.Calendar }))
const Calendar = lazy(loadCalendar)

/** A `YYYY-MM-DD` as a local `Date` at midnight, for the calendar. */
function dateOf(value: string): Date {
  const [year = 1970, month = 1, day = 1] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** A local `Date` as the `YYYY-MM-DD` the API takes. */
function dayOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(date.getFullYear())}-${month}-${day}`
}

// --- One question ----------------------------------------------------------------------------------

interface AskProps {
  /** The quiet label over it, like "What to do". None: the question says it all. */
  label?: string
  line: ReactNode
  /** The outline button first, the ghost one after. */
  children: ReactNode
  /** A yes and a no (`data-ask`): voice can answer it. */
  yesNo?: boolean
  slot?: string
}

function Ask({ label, line, children, yesNo = false, slot }: AskProps) {
  const lineId = useId()
  return (
    <div
      role="group"
      aria-labelledby={lineId}
      data-slot={yesNo ? 'ask' : slot}
      data-part={slot}
      className="flex flex-col gap-2"
    >
      {label ? <span className="text-caption text-muted-foreground">{label}</span> : null}
      <p id={lineId} className="text-ui text-pretty text-foreground">
        {line}
      </p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

// --- The call type (T3-1) --------------------------------------------------------------------------

export function CallTypePart({
  value,
  types,
  onChange,
}: {
  value: CallType
  /** HubSpot's types, the default first (the server's list). */
  types: readonly CallType[]
  onChange: (type: CallType) => void
}) {
  const labelId = useId()
  return (
    <div data-slot="call-type" className="flex flex-col gap-1.5">
      <span id={labelId} className="text-caption text-muted-foreground">
        {CALL_TYPE}
      </span>
      <Segmented
        aria-labelledby={labelId}
        options={types.map((type) => ({ value: type, label: CALL_TYPE_LABELS[type] }))}
        value={value}
        onChange={onChange}
      />
    </div>
  )
}

// --- A day not said (T3-2) -------------------------------------------------------------------------

/**
 * "In a week" and "Pick a day", beside a suggested day. The calendar offers working days from
 * today, as a follow-up's day is never on a weekend.
 */
export function DueChoices({
  due,
  inAWeek,
  today,
  onPick,
}: {
  /** The day suggested now. */
  due: string
  /** A week after it, from the server. None: no "In a week". */
  inAWeek: string | null
  today: string
  onPick: (date: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div data-slot="due-choices" className="flex flex-wrap items-center gap-2">
      {inAWeek ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-slot="due-week"
          className="touch:h-11"
          onClick={() => {
            onPick(inAWeek)
          }}
        >
          {IN_A_WEEK}
        </Button>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-slot="due-pick"
            className="touch:h-11"
            onPointerEnter={() => void loadCalendar()}
            onFocus={() => void loadCalendar()}
          >
            <CalendarDays aria-hidden="true" />
            {PICK_A_DAY}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Suspense fallback={<Skeleton className="m-3 h-64 w-64" />}>
            <Calendar
              mode="single"
              selected={dateOf(due)}
              defaultMonth={dateOf(due)}
              weekStartsOn={1}
              disabled={[{ before: dateOf(today) }, { dayOfWeek: [0, 6] }]}
              onSelect={(picked) => {
                if (!picked) return
                setOpen(false)
                onPick(dayOf(picked))
              }}
            />
          </Suspense>
        </PopoverContent>
      </Popover>
    </div>
  )
}

// --- A task with no subject (T3-2) -----------------------------------------------------------------

export function SubjectAsk({
  label,
  subject,
  onUse,
  onType,
}: {
  label: string
  subject: string
  onUse: () => void
  /** The subject's box takes the focus, with the words selected to type over. */
  onType: () => void
}) {
  return (
    <Ask label={label} line={`${subject}?`} yesNo slot="subject-ask">
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-ask="yes"
        className="touch:h-11"
        onClick={onUse}
      >
        {USE_IT}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-ask="no"
        className="touch:h-11"
        onClick={onType}
      >
        {TYPE_IT}
      </Button>
    </Ask>
  )
}

// --- A Connected call with no follow-up (T3-2, choice 14) ------------------------------------------

export function FollowUpNudge({
  day,
  onAdd,
  onNo,
}: {
  /** The day it offers, the next working day. */
  day: string
  onAdd: () => void
  onNo: () => void
}) {
  return (
    <Ask line={nudgeWords(day)} yesNo slot="nudge">
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-ask="yes"
        className="touch:h-11"
        onClick={onAdd}
      >
        {ADD_IT}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-ask="no"
        className="touch:h-11"
        onClick={onNo}
      >
        {NO}
      </Button>
    </Ask>
  )
}
