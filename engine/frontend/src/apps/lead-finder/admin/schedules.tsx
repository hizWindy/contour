/**
 * Admin, Schedules (PLAN-V6 D3): the jobs that start on their own. For each one: on or off, when it
 * runs ("Every 2 weeks on Monday at 7:00 am", in Melbourne time), what it looks for, the next and
 * the last run with a link, what one run costs, and a "Run now" button.
 *
 * Money is asked about first. Switching on a job that costs money, and starting one by hand, each
 * show what a run costs (and a month of them) in a confirm. A job that is free needs no confirm.
 * What the backend says about a start that could not happen, like a run that is above the limit,
 * is shown as it is: it is already in plain words.
 */
import { CalendarClock, CircleCheck, CircleX, Play, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { fieldErrorMap, toApiProblem } from '@/api/client'
import { useRunScheduleNow, useSchedules, useUpdateSchedule } from '@/api/hooks'
import type { Schedule, ScheduleEdit } from '@/api/types'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Money } from '@/components/money'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { formatDateTime } from '@/lib/format'
import { toastProblem } from '@/lib/problems'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const EVERY_MAX = { days: 365, weeks: 52 } as const

/** True when one run costs money, so switching on or starting by hand asks first. */
function costsMoney(schedule: Schedule): boolean {
  const estimate = schedule.estimate
  return estimate !== null && estimate.valid && Number(estimate.typical_usd) > 0
}

/** What a run of this job costs, and what it would come to in a month. */
function Cost({ schedule }: { schedule: Schedule }) {
  const estimate = schedule.estimate
  if (estimate === null) {
    return <span>Not estimated.</span>
  }
  if (!estimate.valid) {
    return <span>Not known: the saved choices can't be used.</span>
  }
  if (!costsMoney(schedule)) {
    return (
      <span>
        <span className="font-semibold">Free.</span>{' '}
        <span className="text-muted-foreground">{estimate.basis}</span>
      </span>
    )
  }
  // A run that costs more than its limit is stopped at the limit, so "never more than" and a
  // month of them would say what can't happen. The box about why it would not start says the rest.
  const stopsAtLimit = Number(estimate.typical_usd) > Number(estimate.worst_usd)
  // The backend's own words about prices, when they are in the problem, aren't said twice.
  const pricesShown = estimate.problem?.includes(estimate.basis) ?? false
  return (
    <span className="flex flex-col gap-0.5">
      <span>
        A typical run costs <Money value={estimate.typical_usd} about className="font-semibold" />
        {stopsAtLimit ? (
          <>
            , but a run stops at <Money value={estimate.worst_usd} />.
          </>
        ) : (
          <>
            , and never more than <Money value={estimate.worst_usd} />. About{' '}
            <Money value={estimate.per_month_usd} /> a month at this schedule.
          </>
        )}
      </span>
      {pricesShown || !estimate.basis ? null : (
        <span className="text-muted-foreground">Prices used: {estimate.basis}.</span>
      )}
    </span>
  )
}

/** How the last start went, with a link to what it made. */
function LastRun({ schedule }: { schedule: Schedule }) {
  const when = formatDateTime(schedule.last_run_at)
  if (schedule.last_status === null) {
    return <span>Never.</span>
  }
  if (schedule.last_status === 'started') {
    return (
      <span className="flex flex-wrap items-center gap-x-2">
        <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
        <span>Started {when}.</span>
        {schedule.last_kind === 'run' && schedule.last_id ? (
          <Link
            to={`/runs/${schedule.last_id}`}
            className="font-semibold underline-offset-4 hover:underline"
          >
            Open the run
          </Link>
        ) : null}
        {schedule.last_kind === 'sync' ? (
          <Link to="/admin/hubspot" className="font-semibold underline-offset-4 hover:underline">
            See the syncs
          </Link>
        ) : null}
      </span>
    )
  }
  if (schedule.last_status === 'starting') {
    return <span>Starting {when}.</span>
  }
  const word = schedule.last_status === 'skipped' ? 'Skipped' : 'Failed'
  return (
    <span className="flex items-start gap-2">
      <CircleX aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>
        {word} {when}. {schedule.last_error}
      </span>
    </span>
  )
}

/** "Every [2] [weeks] on [Monday] at [07:00]" with a Save button. It starts again from the
 * server's values after a save, because the card is keyed on them. */
function WhenForm({ schedule }: { schedule: Schedule }) {
  const update = useUpdateSchedule()
  const [every, setEvery] = useState(String(schedule.every))
  const [unit, setUnit] = useState<'days' | 'weeks'>(schedule.unit)
  const [weekday, setWeekday] = useState(String(schedule.weekday ?? 0))
  const [at, setAt] = useState(schedule.at)
  const [typo, setTypo] = useState<string | null>(null)

  const everyNumber = Number(every)
  const changed =
    every !== String(schedule.every) ||
    unit !== schedule.unit ||
    (unit === 'weeks' && Number(weekday) !== (schedule.weekday ?? 0)) ||
    at !== schedule.at
  const errors = update.error ? fieldErrorMap(toApiProblem(update.error), ['body.']) : {}
  const everyError = typo ?? errors.every
  const disabled = !schedule.installed

  function save() {
    if (!/^\d+$/.test(every.trim()) || everyNumber < 1 || everyNumber > EVERY_MAX[unit]) {
      setTypo(`Use a whole number from 1 to ${String(EVERY_MAX[unit])}.`)
      return
    }
    setTypo(null)
    const change: ScheduleEdit = {}
    if (everyNumber !== schedule.every) change.every = everyNumber
    if (unit !== schedule.unit) change.unit = unit
    if (unit === 'weeks' && (schedule.unit !== 'weeks' || Number(weekday) !== schedule.weekday)) {
      change.weekday = Number(weekday)
    }
    if (at !== schedule.at) change.at = at
    update.mutate(
      { id: schedule.id, change },
      {
        onSuccess: () => {
          toast('Saved.')
        },
        onError: (error) => {
          if (toApiProblem(error).status !== 422) toastProblem(error)
        },
      },
    )
  }

  return (
    <form
      aria-label={`When ${schedule.name} runs`}
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="flex items-start gap-2">
          <span className="pt-2 text-ui">Every</span>
          <Field className="w-20">
            <FieldLabel htmlFor={`every-${schedule.id}`} className="sr-only">
              How many
            </FieldLabel>
            <Input
              id={`every-${schedule.id}`}
              inputMode="numeric"
              value={every}
              disabled={disabled}
              aria-invalid={everyError ? true : undefined}
              onChange={(event) => {
                setEvery(event.target.value)
                setTypo(null)
              }}
            />
          </Field>
          <Field className="w-28">
            <FieldLabel htmlFor={`unit-${schedule.id}`} className="sr-only">
              Days or weeks
            </FieldLabel>
            <Select
              value={unit}
              disabled={disabled}
              onValueChange={(value) => {
                setUnit(value === 'days' ? 'days' : 'weeks')
              }}
            >
              <SelectTrigger
                id={`unit-${schedule.id}`}
                aria-label="Days or weeks"
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="days">days</SelectItem>
                <SelectItem value="weeks">weeks</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        {unit === 'weeks' ? (
          <div className="flex items-start gap-2">
            <span className="pt-2 text-ui">on</span>
            <Field className="w-40">
              <FieldLabel htmlFor={`weekday-${schedule.id}`} className="sr-only">
                Day of the week
              </FieldLabel>
              <Select value={weekday} disabled={disabled} onValueChange={setWeekday}>
                <SelectTrigger
                  id={`weekday-${schedule.id}`}
                  aria-label="Day of the week"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((day, index) => (
                    <SelectItem key={day} value={String(index)}>
                      {day}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        ) : null}
        <div className="flex items-start gap-2">
          <span className="pt-2 text-ui">at</span>
          <Field className="w-36">
            <FieldLabel htmlFor={`at-${schedule.id}`} className="sr-only">
              Time of day
            </FieldLabel>
            <Input
              id={`at-${schedule.id}`}
              type="time"
              value={at}
              disabled={disabled}
              aria-invalid={errors.at ? true : undefined}
              onChange={(event) => {
                setAt(event.target.value)
              }}
            />
          </Field>
          <span className="pt-2 text-ui text-muted-foreground">Melbourne time</span>
        </div>
        <Button type="submit" variant="outline" disabled={disabled || !changed || update.isPending}>
          {update.isPending ? 'Saving.' : 'Save'}
        </Button>
      </div>
      {everyError ? <FieldError>{everyError}</FieldError> : null}
      {errors.at ? <FieldError>{errors.at}</FieldError> : null}
      {errors.weekday ? <FieldError>{errors.weekday}</FieldError> : null}
    </form>
  )
}

function ScheduleCard({ schedule }: { schedule: Schedule }) {
  const navigate = useNavigate()
  const update = useUpdateSchedule()
  const runNow = useRunScheduleNow()
  const [confirm, setConfirm] = useState<'on' | 'run' | null>(null)
  const estimate = schedule.estimate
  const money = costsMoney(schedule)
  // Nothing is spent by a start that would be refused, so only a run that would start asks first.
  const wouldStart = money && !estimate?.problem

  function switchTo(on: boolean) {
    update.mutate({ id: schedule.id, change: { enabled: on } }, { onError: toastProblem })
  }

  function start() {
    runNow.mutate(schedule.id, {
      onSuccess: (result) => {
        if (result.status === 'started') {
          if (result.ref && !result.ref.startsWith('sync:')) {
            void navigate(`/runs/${result.ref}`)
          } else {
            toast('Started. It runs in the background.')
          }
          return
        }
        toast.error(result.status === 'skipped' ? 'It did not start' : 'It could not start', {
          description: result.reason ?? undefined,
        })
      },
      onError: toastProblem,
    })
  }

  return (
    <Card data-schedule={schedule.job}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle className="flex flex-wrap items-center gap-2 text-section font-semibold">
              <CalendarClock aria-hidden="true" className="size-5 shrink-0" />
              {schedule.name}
              {schedule.running ? <Badge variant="outline">Running now</Badge> : null}
            </CardTitle>
            <CardDescription>{schedule.when}, Melbourne time.</CardDescription>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-ui">
            <span className="font-semibold">{schedule.enabled ? 'On' : 'Off'}</span>
            <Switch
              checked={schedule.enabled}
              disabled={!schedule.installed || update.isPending}
              aria-label={`${schedule.name} on or off`}
              onCheckedChange={(on) => {
                if (on && money) {
                  setConfirm('on')
                } else {
                  switchTo(on)
                }
              }}
            />
          </label>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {!schedule.installed ? (
          <p className="flex items-start gap-2 text-ui">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            The engine no longer has this job, so it can't be changed or started.
          </p>
        ) : null}
        <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-ui sm:grid-cols-[8rem_minmax(0,1fr)]">
          {schedule.summary ? (
            <>
              <dt className="text-muted-foreground">What it does</dt>
              <dd className="min-w-0 break-words">{schedule.summary}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Next run</dt>
          <dd>
            {schedule.enabled && schedule.next_run_at
              ? formatDateTime(schedule.next_run_at)
              : "None. It is off, so it won't run until you switch it on."}
          </dd>
          <dt className="text-muted-foreground">Last run</dt>
          <dd className="min-w-0 break-words">
            <LastRun schedule={schedule} />
          </dd>
          <dt className="text-muted-foreground">One run costs</dt>
          <dd className="min-w-0 break-words">
            <Cost schedule={schedule} />
          </dd>
        </dl>
        {estimate?.problem ? (
          <p
            role="status"
            className="flex items-start gap-2 rounded-lg border bg-muted p-3 text-ui"
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="font-semibold">It would not start now.</span> {estimate.problem}
            </span>
          </p>
        ) : null}
        <WhenForm
          key={`${schedule.id}-${String(schedule.every)}-${schedule.unit}-${String(schedule.weekday)}-${schedule.at}`}
          schedule={schedule}
        />
        <div>
          <Button
            type="button"
            disabled={!schedule.installed || schedule.running || runNow.isPending}
            onClick={() => {
              if (wouldStart) {
                setConfirm('run')
              } else {
                start()
              }
            }}
          >
            <Play aria-hidden="true" />
            {schedule.running ? 'Running.' : runNow.isPending ? 'Starting.' : 'Run now'}
          </Button>
        </div>
      </CardContent>
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'on' ? `Switch on ${schedule.name}?` : `Run ${schedule.name} now?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {estimate ? (
                <>
                  {estimate.problem ? (
                    <>It would not start right now: {estimate.problem} It tries again each time. </>
                  ) : null}
                  Each run costs money: about <Money value={estimate.typical_usd} />, and never more
                  than <Money value={estimate.worst_usd} />.
                  {confirm === 'on' ? (
                    <>
                      {' '}
                      {schedule.when}, that is about <Money value={estimate.per_month_usd} /> a
                      month. You can switch it off at any time.
                    </>
                  ) : (
                    <> It does not change when the schedule runs next.</>
                  )}
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm === 'on') {
                  switchTo(true)
                } else {
                  start()
                }
                setConfirm(null)
              }}
            >
              {confirm === 'on' ? (estimate?.problem ? 'Switch on anyway' : 'Switch on') : 'Run it'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

export default function SchedulesTab() {
  const schedules = useSchedules()
  if (schedules.error) {
    return (
      <ErrorState
        error={schedules.error}
        context="The schedules couldn't be loaded."
        onRetry={() => void schedules.refetch()}
      />
    )
  }
  if (!schedules.data) {
    return (
      <div className="flex flex-col gap-4" aria-label="Loading the schedules">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (schedules.data.items.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="No schedules yet."
        description="Each project's schedules are made when the backend starts."
      />
    )
  }
  return (
    <div className="flex flex-col gap-4">
      {schedules.data.items.map((schedule) => (
        <ScheduleCard key={schedule.id} schedule={schedule} />
      ))}
    </div>
  )
}
