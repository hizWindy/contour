/**
 * Admin, Schedules (PLAN-V6 D3, redone in PLAN-V13 T1-7): what starts on its own, and when.
 *
 * - **Find new leads automatically:** the Lead Finder's four city schedules as one control, with
 *   the round's budget, and each city's last run under it (`round-card.tsx`).
 * - **The other jobs**, one compact row each: the daily HubSpot copy (free) and the Companies
 *   page's morning search ahead (it spends money). On or off, the time, the last start, Run now.
 *
 * Money is asked about first: switching on a job that costs money, and starting one by hand, show
 * what a run costs in a confirm. A free job needs no confirm. What the backend says about a start
 * that didn't happen is shown as it is: it is already in plain words.
 */
import { CircleCheck, CircleX, Play } from 'lucide-react'
import { useId, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useLeadFinderRound, useRunScheduleNow, useSchedules, useUpdateSchedule } from '@/api/hooks'
import type { Schedule } from '@/api/types'
import { ErrorState } from '@/components/error-state'
import { Money } from '@/components/money'
import { PendingCards } from '@/components/skeletons'
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
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { formatDateTime } from '@/lib/format'
import { toastProblem } from '@/lib/problems'
import { RoundCard } from './round-card'

/** A run's id. A start that made something else (a sync, a search ahead) has another ref. */
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** The city schedules: the round card holds them. */
const CITY_JOB = 'lead_finder.discovery'

function costsMoney(schedule: Schedule): boolean {
  const estimate = schedule.estimate
  return estimate !== null && estimate.valid && Number(estimate.typical_usd) > 0
}

/** How the last start went, in a few words, with a link to what it made. */
function LastStart({ schedule }: { schedule: Schedule }) {
  const when = formatDateTime(schedule.last_run_at)
  if (schedule.last_status === null) {
    return <span>Never run.</span>
  }
  if (schedule.last_status === 'started' || schedule.last_status === 'starting') {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2">
        <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
        <span>Started {when}.</span>
        {schedule.last_kind === 'run' && schedule.last_id ? (
          <Link
            to={`/runs/${schedule.last_id}`}
            className="text-link underline-offset-4 hover:underline"
          >
            Open the run
          </Link>
        ) : null}
        {schedule.last_kind === 'sync' ? (
          <Link to="/admin/hubspot" className="text-link underline-offset-4 hover:underline">
            See the syncs
          </Link>
        ) : null}
      </span>
    )
  }
  return (
    <span className="inline-flex items-start gap-2">
      <CircleX aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>
        {schedule.last_status === 'skipped' ? 'Skipped' : 'Failed'} {when}. {schedule.last_error}
      </span>
    </span>
  )
}

/** One job in a row: on or off, its time (changed with a Save that shows only after a change),
 * its last start, and Run now. */
function JobRow({ schedule }: { schedule: Schedule }) {
  const id = useId()
  const navigate = useNavigate()
  const update = useUpdateSchedule()
  const runNow = useRunScheduleNow()
  const [at, setAt] = useState(schedule.at)
  const [confirm, setConfirm] = useState<'on' | 'run' | null>(null)
  const estimate = schedule.estimate
  const money = costsMoney(schedule)
  const locked = !schedule.installed

  function switchTo(on: boolean) {
    update.mutate({ id: schedule.id, change: { enabled: on } }, { onError: toastProblem })
  }

  function start() {
    runNow.mutate(schedule.id, {
      onSuccess: (result) => {
        if (result.status === 'started') {
          if (result.ref && RUN_ID.test(result.ref)) void navigate(`/runs/${result.ref}`)
          else toast('Started. It runs in the background.')
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
    <li
      data-schedule={schedule.job}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b py-3 last:border-b-0"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${id}-on`} className="font-semibold">
            {schedule.name}
          </label>
          {schedule.running ? <Badge variant="outline">Running now</Badge> : null}
          {money ? (
            <span className="text-caption text-muted-foreground">
              About <Money value={estimate?.typical_usd ?? '0'} /> a run
            </span>
          ) : (
            <span className="text-caption text-muted-foreground">Free</span>
          )}
        </span>
        <span className="text-caption text-muted-foreground">
          {schedule.when}, Melbourne time. <LastStart schedule={schedule} />
        </span>
      </div>
      <Switch
        id={`${id}-on`}
        checked={schedule.enabled}
        disabled={locked || update.isPending}
        onCheckedChange={(on) => {
          if (on && money) setConfirm('on')
          else switchTo(on)
        }}
      />
      <div className="col-span-2 flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-at`} className="text-caption text-muted-foreground">
          Time
        </label>
        <Input
          id={`${id}-at`}
          type="time"
          step={60}
          className="h-8 w-36 tabular-nums"
          value={at}
          disabled={locked}
          onChange={(event) => {
            setAt(event.target.value)
          }}
        />
        {at !== schedule.at ? (
          <Button
            type="button"
            size="sm"
            disabled={update.isPending || !/^\d\d:\d\d$/.test(at)}
            onClick={() => {
              update.mutate({ id: schedule.id, change: { at } }, { onError: toastProblem })
            }}
          >
            Save
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto"
          disabled={locked || schedule.running || runNow.isPending}
          onClick={() => {
            if (money) setConfirm('run')
            else start()
          }}
        >
          <Play aria-hidden="true" />
          {schedule.running ? 'Running' : runNow.isPending ? 'Starting' : 'Run now'}
        </Button>
      </div>
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
                  {estimate.problem ? <>It would not start right now: {estimate.problem} </> : null}
                  Each run costs about <Money value={estimate.typical_usd} />, and never more than{' '}
                  <Money value={estimate.worst_usd} />.
                  {confirm === 'on' ? (
                    <>
                      {' '}
                      {schedule.when}, that is about <Money value={estimate.per_month_usd} /> a
                      month. You can switch it off at any time.
                    </>
                  ) : (
                    <> It does not change when it runs next.</>
                  )}
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm === 'on') switchTo(true)
                else start()
                setConfirm(null)
              }}
            >
              {confirm === 'on' ? 'Switch on' : 'Run it'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}

function OtherJobs({ schedules }: { schedules: Schedule[] }) {
  if (schedules.length === 0) {
    return null
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-section font-semibold">Other jobs</CardTitle>
        <CardDescription>
          The daily HubSpot copy, and what other pages start on their own.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul aria-label="Other jobs">
          {schedules.map((schedule) => (
            <JobRow key={`${schedule.id}|${schedule.at}`} schedule={schedule} />
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

export default function SchedulesTab() {
  const schedules = useSchedules()
  const round = useLeadFinderRound()
  const error = schedules.error ?? round.error
  if (error) {
    return (
      <ErrorState
        error={error}
        context="The schedules couldn't be loaded."
        onRetry={() => {
          void schedules.refetch()
          void round.refetch()
        }}
      />
    )
  }
  if (!schedules.data || !round.data) {
    return <PendingCards label="Loading the schedules" cards={2} lines={6} />
  }
  const items = schedules.data.items
  const others = items.filter((schedule) => !schedule.job.startsWith(CITY_JOB))
  return (
    <div className="flex flex-col gap-6">
      <RoundCard round={round.data} schedules={items} />
      <OtherJobs schedules={others} />
    </div>
  )
}
