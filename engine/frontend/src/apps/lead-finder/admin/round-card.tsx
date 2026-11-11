/**
 * "Find new leads automatically" (PLAN-V13 T1-7): the four city schedules as one control. A switch
 * for the whole round, the cities as chips, how often, the first day and time, and the round's
 * budget, with a preview line that changes as you edit. One Save button, shown only after a change.
 * Switching the round on asks first, because it spends money.
 *
 * Under it: the last run of each city (date, good leads, cost) and "Run a city now", which asks
 * first with the city's own cost, as before.
 */
import { ChevronDown, Play } from 'lucide-react'
import { useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useRunScheduleNow, useSaveLeadFinderRound } from '@/api/hooks'
import { isApiProblem } from '@/api/client'
import type { LeadFinderRound, Schedule } from '@/api/types'
import { ChipGroup, Segmented } from '@/components/motion'
import { Money } from '@/components/money'
import { StatusBadge } from '@/components/status-badge'
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
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDate, formatNumber } from '@/lib/format'
import { toastProblem } from '@/lib/problems'
import {
  CITIES,
  WEEKDAYS,
  WEEKDAY_NAMES,
  bodyOf,
  checkForm,
  formOf,
  isSaved,
  monthWords,
  previewFor,
  splitWords,
  usd,
  withOften,
  type Often,
  type RoundErrors,
  type RoundForm,
  type Unit,
} from './round-plan'

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const OFTEN: { value: Often; label: string }[] = [
  { value: 'two-weeks', label: 'Every 2 weeks' },
  { value: 'thirty-days', label: 'Every 30 days' },
  { value: 'custom', label: 'Custom' },
]
const UNITS: { value: Unit; label: string }[] = [
  { value: 'days', label: 'Days' },
  { value: 'weeks', label: 'Weeks' },
]

/** The backend's 422 field (`body.every`) as the form's field name. */
const FIELD_OF: Record<string, keyof RoundErrors> = {
  'body.cities': 'cities',
  'body.every': 'every',
  'body.unit': 'every',
  'body.weekday': 'every',
  'body.at': 'at',
  'body.budget_usd': 'budget',
}

function errorsFromProblem(error: unknown): RoundErrors {
  const found: RoundErrors = {}
  if (isApiProblem(error)) {
    for (const item of error.errors ?? []) {
      const field = FIELD_OF[item.field]
      if (field && !found[field]) found[field] = item.message
    }
  }
  return found
}

function RoundControl({ round }: { round: LeadFinderRound }) {
  const id = useId()
  const save = useSaveLeadFinderRound()
  const [form, setForm] = useState<RoundForm>(() => formOf(round))
  const [serverErrors, setServerErrors] = useState<RoundErrors>({})
  const [asking, setAsking] = useState(false)
  const budgetMax = Number(round.budget_max_usd)
  const errors = { ...checkForm(form, budgetMax), ...serverErrors }
  const changed = !isSaved(form, round)
  const canSave = changed && Object.keys(checkForm(form, budgetMax)).length === 0
  const preview = previewFor(form, round, new Date())

  function edit(next: RoundForm) {
    setForm(next)
    setServerErrors({})
  }

  function send() {
    save.mutate(bodyOf(form), {
      onSuccess: (saved) => {
        setForm(formOf(saved))
        toast(saved.enabled ? 'Saved. The round is on.' : 'Saved. The round is off.')
      },
      onError: (error) => {
        const found = errorsFromProblem(error)
        if (Object.keys(found).length > 0) setServerErrors(found)
        else toastProblem(error)
      },
    })
  }

  function onSave() {
    if (form.enabled && !round.enabled) {
      setAsking(true) // switching on spends money: ask first
      return
    }
    send()
  }

  return (
    <Card data-slot="round-card">
      <CardHeader>
        <CardTitle className="text-section font-semibold">
          <label htmlFor={`${id}-on`}>Find new leads automatically</label>
        </CardTitle>
        <CardDescription>
          {round.enabled
            ? `On. ${round.when}, Melbourne time.`
            : 'Off. No city runs on its own until it is on.'}
        </CardDescription>
        <CardAction>
          <Switch
            id={`${id}-on`}
            checked={form.enabled}
            onCheckedChange={(on) => {
              edit({ ...form, enabled: on })
            }}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Field data-invalid={errors.cities ? true : undefined}>
          <FieldLabel id={`${id}-cities`}>Cities</FieldLabel>
          <ChipGroup
            aria-labelledby={`${id}-cities`}
            options={CITIES.map((city) => ({ value: city, label: city }))}
            value={form.cities}
            onChange={(cities) => {
              edit({ ...form, cities: cities })
            }}
          />
          <FieldDescription>
            One day apart, in this order. Sydney&apos;s leads go to a Director.
          </FieldDescription>
          {errors.cities ? <FieldError>{errors.cities}</FieldError> : null}
        </Field>

        <Field data-invalid={errors.every ? true : undefined}>
          <FieldLabel id={`${id}-often`}>How often</FieldLabel>
          {/* A field stretches what it holds, so the control sits in a row of its own. */}
          <div className="flex">
            <Segmented
              aria-labelledby={`${id}-often`}
              options={OFTEN}
              value={form.often}
              onChange={(often) => {
                edit(withOften(form, often))
              }}
            />
          </div>
          {form.often === 'custom' ? (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={`${id}-every`} className="text-ui">
                Every
              </label>
              <Input
                id={`${id}-every`}
                inputMode="numeric"
                className="w-20 tabular-nums"
                value={form.every}
                aria-invalid={errors.every ? true : undefined}
                onChange={(event) => {
                  edit({ ...form, every: event.target.value })
                }}
              />
              <Segmented
                aria-label="Days or weeks"
                size="sm"
                options={UNITS}
                value={form.unit}
                onChange={(unit) => {
                  edit({ ...form, unit })
                }}
              />
            </div>
          ) : null}
          {errors.every ? <FieldError>{errors.every}</FieldError> : null}
        </Field>

        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Field>
            <FieldLabel id={`${id}-day`}>First day</FieldLabel>
            <ChipGroup
              mode="one"
              aria-labelledby={`${id}-day`}
              options={WEEKDAYS.map((label, index) => ({
                value: String(index),
                label,
                description: WEEKDAY_NAMES[index],
              }))}
              value={[String(form.weekday)]}
              onChange={(picked) => {
                const [day] = picked
                if (day !== undefined) edit({ ...form, weekday: Number(day) })
              }}
            />
          </Field>
          <Field data-invalid={errors.at ? true : undefined}>
            <FieldLabel htmlFor={`${id}-at`}>Time</FieldLabel>
            <Input
              id={`${id}-at`}
              type="time"
              step={60}
              className="w-36 tabular-nums"
              value={form.at}
              aria-describedby={`${id}-zone`}
              aria-invalid={errors.at ? true : undefined}
              onChange={(event) => {
                edit({ ...form, at: event.target.value })
              }}
            />
            <FieldDescription id={`${id}-zone`}>Melbourne time</FieldDescription>
            {errors.at ? <FieldError>{errors.at}</FieldError> : null}
          </Field>
        </div>

        <Field data-invalid={errors.budget ? true : undefined}>
          <FieldLabel htmlFor={`${id}-budget`}>Round budget (US$)</FieldLabel>
          <div className="flex">
            <Input
              id={`${id}-budget`}
              inputMode="decimal"
              className="w-32 tabular-nums"
              value={form.budget}
              aria-describedby={`${id}-split`}
              aria-invalid={errors.budget ? true : undefined}
              onChange={(event) => {
                edit({ ...form, budget: event.target.value })
              }}
            />
          </div>
          <FieldDescription id={`${id}-split`}>
            {splitWords(form.budget, form.cities.length)} A city&apos;s run stops at what is left.
          </FieldDescription>
          {errors.budget ? <FieldError>{errors.budget}</FieldError> : null}
        </Field>

        {round.note ? (
          <p className="text-ui font-semibold" role="status">
            {round.note}
          </p>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t">
        <p className="text-ui" aria-live="polite" data-slot="round-preview">
          {preview}
        </p>
        {changed ? (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={save.isPending}
              onClick={() => {
                edit(formOf(round))
              }}
            >
              Undo
            </Button>
            <Button type="button" disabled={!canSave || save.isPending} onClick={onSave}>
              {save.isPending ? 'Saving' : 'Save'}
            </Button>
          </div>
        ) : null}
      </CardFooter>
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch on finding new leads?</AlertDialogTitle>
            <AlertDialogDescription>
              Each round may spend up to {usd(Number(form.budget))} between its cities, so at most
              about {monthWords(form)} a month at this plan. Each city&apos;s run also stops at its
              own cap and at today&apos;s limit. You can switch it off at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setAsking(false)
                send()
              }}
            >
              Switch on
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

/** "Run a city now": the city's own cost first, then its run opens. */
function RunCityNow({ round, schedules }: { round: LeadFinderRound; schedules: Schedule[] }) {
  const navigate = useNavigate()
  const runNow = useRunScheduleNow()
  const [city, setCity] = useState<Schedule | null>(null)
  const byId = new Map(schedules.map((schedule) => [schedule.id, schedule]))
  const items = round.city_plan
    .map((item) => ({ item, schedule: item.schedule_id ? byId.get(item.schedule_id) : undefined }))
    .filter((pair): pair is { item: typeof pair.item; schedule: Schedule } => !!pair.schedule)
  const estimate = city?.estimate ?? null

  function start(schedule: Schedule) {
    runNow.mutate(schedule.id, {
      onSuccess: (result) => {
        if (result.status === 'started' && result.ref && RUN_ID.test(result.ref)) {
          void navigate(`/runs/${result.ref}`)
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
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={runNow.isPending}>
            <Play aria-hidden="true" />
            {runNow.isPending ? 'Starting' : 'Run a city now'}
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {items.map(({ item, schedule }) => (
            <DropdownMenuItem
              key={item.city}
              disabled={schedule.running}
              onSelect={() => {
                setCity(schedule)
              }}
            >
              {item.city}
              {schedule.running ? ' (running)' : ''}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog
        open={city !== null}
        onOpenChange={(open) => {
          if (!open) setCity(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Run {city?.name.replace('Find new leads: ', '')} now?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {estimate && estimate.valid ? (
                <>
                  {estimate.problem ? <>It would not start right now: {estimate.problem} </> : null}
                  A run costs about <Money value={estimate.typical_usd} />, and never more than{' '}
                  <Money value={estimate.worst_usd} />. It counts toward this round&apos;s budget,
                  and it does not change when the city runs next.
                </>
              ) : (
                'Its cost is not known right now. It does not change when the city runs next.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (city) start(city)
                setCity(null)
              }}
            >
              Run it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** Each city's newest automatic run, and the round so far in one line. */
function LastRound({ round, schedules }: { round: LeadFinderRound; schedules: Schedule[] }) {
  const state = round.round
  const rows = round.city_plan.filter((item) => item.last_run || item.picked)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-section font-semibold">The last round</CardTitle>
        <CardDescription>
          {state.runs === 0
            ? 'No city has run in this round yet.'
            : `${formatNumber(state.good_leads)} of ${formatNumber(state.goal)} good leads, ${formatNumber(state.runs)} ${state.runs === 1 ? 'city run' : 'city runs'}.`}{' '}
          <Money value={state.spent_usd} /> spent, <Money value={state.left_usd} /> left of the
          budget.
        </CardDescription>
        <CardAction>
          <RunCityNow round={round} schedules={schedules} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <Table compact aria-label="Each city's last run">
          <TableHeader>
            <TableRow>
              <TableHead>City</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Good leads</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((item) => (
              <TableRow key={item.city}>
                <TableCell className="font-semibold">{item.city}</TableCell>
                <TableCell>
                  {item.last_run ? formatDate(item.last_run.created_at) : 'Not yet'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.last_run ? formatNumber(item.last_run.good_leads) : ''}
                </TableCell>
                <TableCell className="text-right">
                  {item.last_run ? <Money value={item.last_run.cost_usd} /> : ''}
                </TableCell>
                <TableCell>
                  {item.last_run ? (
                    <StatusBadge status={item.last_run.status} />
                  ) : item.last_error ? (
                    <span className="text-caption text-muted-foreground">{item.last_error}</span>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

/** The control, keyed on what is saved so a save (or another person's) starts it afresh. */
export function RoundCard({ round, schedules }: { round: LeadFinderRound; schedules: Schedule[] }) {
  const key = `${String(round.enabled)}|${round.cities.join()}|${String(round.every)}|${round.unit}|${String(round.weekday)}|${round.at}|${round.budget_usd}`
  return (
    <>
      <RoundControl key={key} round={round} />
      <LastRound round={round} schedules={schedules} />
    </>
  )
}
