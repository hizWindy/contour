/**
 * "New pre-read" (PLAN-V17 "The screens", part 5): a pre-read for a meeting that isn't in HubSpot,
 * so it works while meetings can't come from HubSpot yet. A dialog asks for the company (the
 * company picker Log call uses), the title, the day and the time, and Teams or in person. "Draft
 * the pre-read" starts the form, and its page opens.
 *
 * - **Fields forgive** (DESIGN.md): the day reads "thu", "26 nov" or "26/11", and the time "10am",
 *   "2:30" or "14:00". The day and the time it read show under each field as you type. A weekend
 *   stays a weekend: a meeting can be on a Saturday. Only what it truly can't read gets plain
 *   words, once the field is left or the form is sent.
 * - **Teams or in person** may be left unpicked: the pre-read then says nothing about where.
 * - **A double press is one form:** the button is greyed while the server answers, and the server
 *   gives back the first pre-read when the same person types the same meeting again (the same
 *   company, title and start), so a retry after a lost answer opens it and makes no second one.
 * - **AI drafts it** (PLAN-V18 T2-4): one line above the buttons says so, with an icon, what it
 *   reads, how long it takes and that the rep checks it before anyone gets it, then its cost in
 *   quiet text.
 * - The dialog's one Navy button is "Draft the pre-read". It closes when the form has started.
 * - **From the Assistant** (PLAN-V23 T4-2): "make a pre-read for Sample Logistics" with no meeting
 *   ahead, then the card's "New pre-read", opens this dialog by itself with the company filled in.
 */
import { ChevronsUpDown, Cpu, FilePlus, MapPin, Video } from 'lucide-react'
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { useNavigate } from 'react-router'
import { fieldErrorMap, toApiProblem } from '@/api/client'
import { useStartMeetingForm } from '@/api/hooks/meetings'
import type { MeetingWhere } from '@/api/types'
import { ChipGroup, type ChipOption } from '@/components/motion'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { dueDateText, readDueDate, type DueDate } from '@/lib/due-date'
import { melbourneDate } from '@/lib/format'
import { changeDetail } from '@/lib/problems'
import { clockText, melbourneIso, readTimeOfDay, type TimeOfDay } from '@/lib/time-of-day'
import { cn } from '@/lib/utils'
import { CompanySearch, type CompanyMatch } from '../company-search'
import { preReadHref, type NewPreReadAsk } from './params'
import {
  CANCEL,
  COMPANY,
  DAY,
  DAY_EMPTY,
  DAY_PAST,
  DAY_PLACEHOLDER,
  DAY_UNREADABLE,
  AI_DRAFT_COST,
  AI_DRAFTS_NOTE,
  DRAFT_THE_PRE_READ,
  NEW_DESCRIPTION,
  NEW_PRE_READ,
  PICK_COMPANY,
  PICK_THE_COMPANY,
  TIME,
  TIME_EMPTY,
  TIME_PLACEHOLDER,
  TIME_UNREADABLE,
  TITLE,
  TITLE_EMPTY,
  TITLE_PLACEHOLDER,
  WHERE,
  WHERE_WORDS,
  WHICH_MEETING_COMPANY,
} from './words'

type Place = Exclude<MeetingWhere, 'unknown'>

const PLACES: readonly ChipOption<Place>[] = [
  { value: 'online', label: WHERE_WORDS.online, icon: Video },
  { value: 'in_person', label: WHERE_WORDS.in_person, icon: MapPin },
]

function dayProblem(day: DueDate): string | null {
  switch (day.kind) {
    case 'empty':
      return DAY_EMPTY
    case 'unreadable':
      return DAY_UNREADABLE
    case 'past':
      return DAY_PAST
    case 'date':
      return null
  }
}

function timeProblem(time: TimeOfDay): string | null {
  switch (time.kind) {
    case 'empty':
      return TIME_EMPTY
    case 'unreadable':
      return TIME_UNREADABLE
    case 'time':
      return null
  }
}

/** A field's line under it: what it read (quiet), or what is wrong (Terracotta, announced). */
function FieldNote({ id, problem, read }: { id: string; problem: string | null; read: ReactNode }) {
  if (problem) {
    return (
      <p id={id} role="alert" className="min-h-5 text-caption text-destructive-ink">
        {problem}
      </p>
    )
  }
  return (
    <p id={id} className="min-h-5 text-caption text-muted-foreground">
      {read}
    </p>
  )
}

function NewPreReadForm({
  start: given,
  onStarted,
  onCancel,
}: {
  /** The company it opens with: from the Assistant's card (PLAN-V23 T4-2), or none. */
  start: CompanyMatch | null
  onStarted: (formId: string) => void
  onCancel: () => void
}) {
  const ids = {
    company: useId(),
    companyNote: useId(),
    title: useId(),
    titleNote: useId(),
    day: useId(),
    dayNote: useId(),
    time: useId(),
    timeNote: useId(),
    where: useId(),
  }
  const companyRef = useRef<HTMLButtonElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const dayRef = useRef<HTMLInputElement>(null)
  const timeRef = useRef<HTMLInputElement>(null)
  // A company was just picked: the title takes the focus, not the picker's button.
  const picked = useRef(false)
  const [picking, setPicking] = useState(false)
  const [company, setCompany] = useState<CompanyMatch | null>(given)
  const [title, setTitle] = useState('')
  const [dayText, setDayText] = useState('')
  const [timeText, setTimeText] = useState('')
  const [place, setPlace] = useState<Place[]>([])
  const [left, setLeft] = useState({ day: false, time: false })
  const [tried, setTried] = useState(false)
  const start = useStartMeetingForm()

  const today = melbourneDate()
  const day = readDueDate(dayText, today, { weekends: 'keep' })
  const time = readTimeOfDay(timeText)
  const problem = start.error ? toApiProblem(start.error) : null
  const server = problem ? fieldErrorMap(problem, ['body.']) : {}
  // A refusal no field explains shows under the fields, in the server's words. What was typed
  // stays, so Draft the pre-read can be pressed again.
  const general =
    problem && Object.keys(server).length === 0
      ? { title: problem.title, detail: changeDetail(problem) }
      : null

  const companyProblem = server.company_key ?? (tried && !company ? PICK_THE_COMPANY : null)
  const titleProblem = server.title ?? (tried && title.trim() === '' ? TITLE_EMPTY : null)
  // An empty field is only wrong once the form is sent; text it can't read, once it is left.
  const dayWrong = dayProblem(day)
  const dayNote =
    server.starts_at ??
    (dayWrong && (tried || (left.day && day.kind !== 'empty')) ? dayWrong : null)
  const timeWrong = timeProblem(time)
  const timeNote = timeWrong && (tried || (left.time && time.kind !== 'empty')) ? timeWrong : null
  const placeProblem = server.where ?? null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (start.isPending) return
    setTried(true)
    start.reset()
    const firstWrong: RefObject<HTMLElement | null> | null = !company
      ? companyRef
      : title.trim() === ''
        ? titleRef
        : day.kind !== 'date'
          ? dayRef
          : time.kind !== 'time'
            ? timeRef
            : null
    if (firstWrong || !company || day.kind !== 'date' || time.kind !== 'time') {
      firstWrong?.current?.focus()
      return
    }
    start.mutate(
      {
        company_key: company.key,
        title: title.trim(),
        starts_at: melbourneIso(day.date, time),
        where: place[0] ?? 'unknown',
      },
      {
        onSuccess: (form) => {
          onStarted(form.id)
        },
      },
    )
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5">
      <Field>
        <FieldLabel htmlFor={ids.company}>{COMPANY}</FieldLabel>
        <Popover open={picking} onOpenChange={setPicking} modal>
          <PopoverTrigger asChild>
            <Button
              ref={companyRef}
              id={ids.company}
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={picking}
              aria-invalid={companyProblem ? true : undefined}
              aria-describedby={companyProblem ? ids.companyNote : undefined}
              className="w-full justify-between font-normal"
            >
              <span
                className={cn('truncate', company ? 'text-foreground' : 'text-muted-foreground')}
              >
                {company?.name ?? PICK_COMPANY}
              </span>
              <ChevronsUpDown aria-hidden="true" className="text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-(--radix-popover-trigger-width) min-w-72 gap-0 p-0"
            onCloseAutoFocus={(event) => {
              if (picked.current) {
                picked.current = false
                event.preventDefault()
                titleRef.current?.focus()
              }
            }}
          >
            <CompanySearch
              label={WHICH_MEETING_COMPANY}
              onPick={(match) => {
                picked.current = true
                setCompany(match)
                setPicking(false)
              }}
            />
          </PopoverContent>
        </Popover>
        {companyProblem ? (
          <p id={ids.companyNote} role="alert" className="text-caption text-destructive-ink">
            {companyProblem}
          </p>
        ) : null}
      </Field>

      <Field>
        <FieldLabel htmlFor={ids.title}>{TITLE}</FieldLabel>
        <Input
          ref={titleRef}
          id={ids.title}
          value={title}
          maxLength={200}
          placeholder={TITLE_PLACEHOLDER}
          autoComplete="off"
          // Opened with its company filled in: the title is the next thing to type.
          autoFocus={given !== null}
          aria-invalid={titleProblem ? true : undefined}
          aria-describedby={titleProblem ? ids.titleNote : undefined}
          className="touch:text-body"
          onChange={(event) => {
            setTitle(event.target.value)
          }}
        />
        {titleProblem ? (
          <p id={ids.titleNote} role="alert" className="text-caption text-destructive-ink">
            {titleProblem}
          </p>
        ) : null}
      </Field>

      <div className="grid gap-5 sm:grid-cols-2 sm:gap-4">
        <Field>
          <FieldLabel htmlFor={ids.day}>{DAY}</FieldLabel>
          <Input
            ref={dayRef}
            id={ids.day}
            value={dayText}
            maxLength={60}
            placeholder={DAY_PLACEHOLDER}
            autoComplete="off"
            aria-invalid={dayNote ? true : undefined}
            aria-describedby={ids.dayNote}
            className="touch:text-body"
            onChange={(event) => {
              setLeft((before) => ({ ...before, day: false }))
              setDayText(event.target.value)
            }}
            onBlur={() => {
              setLeft((before) => ({ ...before, day: true }))
            }}
          />
          <FieldNote
            id={ids.dayNote}
            problem={dayNote}
            read={day.kind === 'date' ? dueDateText(day.date) : null}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={ids.time}>{TIME}</FieldLabel>
          <Input
            ref={timeRef}
            id={ids.time}
            value={timeText}
            maxLength={20}
            placeholder={TIME_PLACEHOLDER}
            autoComplete="off"
            aria-invalid={timeNote ? true : undefined}
            aria-describedby={ids.timeNote}
            className="touch:text-body"
            onChange={(event) => {
              setLeft((before) => ({ ...before, time: false }))
              setTimeText(event.target.value)
            }}
            onBlur={() => {
              setLeft((before) => ({ ...before, time: true }))
            }}
          />
          <FieldNote
            id={ids.timeNote}
            problem={timeNote}
            read={time.kind === 'time' ? clockText(time) : null}
          />
        </Field>
      </div>

      <Field>
        <FieldLabel id={ids.where}>{WHERE}</FieldLabel>
        <ChipGroup
          aria-labelledby={ids.where}
          mode="one-or-none"
          options={PLACES}
          value={place}
          onChange={setPlace}
        />
        {placeProblem ? (
          <p role="alert" className="text-caption text-destructive-ink">
            {placeProblem}
          </p>
        ) : null}
      </Field>

      {general ? (
        <div role="alert" className="flex flex-col gap-0.5 text-ui text-destructive-ink">
          <p className="font-semibold">{general.title}</p>
          {general.detail ? <p>{general.detail}</p> : null}
        </div>
      ) : null}

      <div data-slot="ai-note" className="flex items-start gap-2 text-ui">
        <Cpu aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="flex flex-col gap-0.5 text-pretty">
          <span className="text-foreground">{AI_DRAFTS_NOTE}</span>
          <span className="text-caption text-muted-foreground">{AI_DRAFT_COST}</span>
        </p>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {CANCEL}
        </Button>
        <Button type="submit" disabled={start.isPending}>
          {DRAFT_THE_PRE_READ}
        </Button>
      </DialogFooter>
    </form>
  )
}

/**
 * The button in Meetings' header, and its dialog. An `ask` opens it by itself with its company
 * filled in, and the title takes the focus; `onAsked` then clears the ask from the address, so
 * Back or a reload doesn't open it again.
 */
export function NewPreRead({
  ask = null,
  onAsked,
}: {
  ask?: NewPreReadAsk | null
  onAsked?: () => void
}) {
  const [open, setOpen] = useState(false)
  // The company the form opens with: the ask's, or none when the button opens it.
  const [start, setStart] = useState<CompanyMatch | null>(null)
  const [taken, setTaken] = useState<string | null>(null)
  if (ask && ask.key !== taken) {
    setTaken(ask.key)
    setStart(ask.company)
    setOpen(true)
  }
  const used = useEffectEvent(() => {
    onAsked?.()
  })
  useEffect(() => {
    if (taken !== null) used()
  }, [taken])
  const navigate = useNavigate()
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setStart(null)
        setOpen(next)
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <FilePlus aria-hidden="true" />
          {NEW_PRE_READ}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{NEW_PRE_READ}</DialogTitle>
          <DialogDescription>{NEW_DESCRIPTION}</DialogDescription>
        </DialogHeader>
        <NewPreReadForm
          start={start}
          onCancel={() => {
            setOpen(false)
          }}
          onStarted={(formId) => {
            setOpen(false)
            void navigate(preReadHref(formId))
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
