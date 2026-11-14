/**
 * Admin, Sources (PLAN-V16 T3-6): Property Daily and Arealytics, the two property tools the Lead
 * Finder reads through a browser of its own. For each: its switch, whether it is signed in, when
 * it was last read, the pages today against the day's limit, the records in our copy, a pause and
 * its Resume, the last problem in plain words, and "Check now" (a free sign-in check that reads
 * one page).
 *
 * The switch is a setting (`property_daily_enabled`), so it saves at once with an Undo. A tool we
 * have no connector for (Arealytics, dropped on 15 Nov because it refused automated access) shows
 * why, and has no switch, no check and no resume.
 */
import { CircleCheck, CircleMinus, Pause, RefreshCw, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useCheckSource, useResumeSource, useSources, useUpdateSettings } from '@/api/hooks'
import type { ToolOut } from '@/api/types'
import { ErrorState } from '@/components/error-state'
import { EmptyState } from '@/components/empty-state'
import { PendingCards } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { formatDateTime, formatNumber, pluralise } from '@/lib/format'
import { toastProblem } from '@/lib/problems'
import { cn } from '@/lib/utils'
import { signInWords, switchKey } from './sources-words'

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

function SourceSwitch({ source }: { source: ToolOut }) {
  const update = useUpdateSettings()
  // The switch moves at once; the list catches up when the save is back.
  const [pending, setPending] = useState<boolean | null>(null)
  const on = pending ?? source.on
  const save = (value: boolean, undo: boolean): void => {
    setPending(value)
    update.mutate(
      { [switchKey(source.id)]: value },
      {
        onSuccess: () => {
          if (undo) {
            toast(`${source.name} switched ${value ? 'on' : 'off'}.`, {
              action: {
                label: 'Undo',
                onClick: () => {
                  save(!value, false)
                },
              },
            })
          }
        },
        onError: (problem) => {
          toastProblem(problem)
        },
        onSettled: () => {
          setPending(null)
        },
      },
    )
  }
  return (
    <div className="flex items-center gap-2">
      <Switch
        id={`source-${source.id}-on`}
        checked={on}
        disabled={update.isPending}
        onCheckedChange={(checked) => {
          save(checked, true)
        }}
      />
      <label htmlFor={`source-${source.id}-on`} className="text-ui">
        {on ? 'Switched on' : 'Switched off'}
      </label>
    </div>
  )
}

function SourceCard({ source }: { source: ToolOut }) {
  const check = useCheckSource()
  const resume = useResumeSource()
  const paused = source.paused_until !== null
  const signedIn = signInWords(source.signed_in)
  return (
    <Card data-slot="source" aria-labelledby={`source-${source.id}-title`}>
      <CardHeader>
        <CardTitle id={`source-${source.id}-title`} className="text-section font-semibold">
          {source.name}
        </CardTitle>
        <CardDescription>
          {source.connected
            ? 'Read by our connector, one page at a time, at a slow pace.'
            : 'Not connected: there is no connector for it.'}
        </CardDescription>
        {source.connected ? (
          <CardAction>
            <SourceSwitch source={source} />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-ui">
        {source.connected ? (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5">
            <Line label="Sign-in">
              <span className="inline-flex items-center gap-1.5">
                {source.signed_in === true ? (
                  <CircleCheck aria-hidden="true" className="size-4 text-pass" />
                ) : (
                  <CircleMinus aria-hidden="true" className="size-4 text-muted-foreground" />
                )}
                {signedIn}
              </span>
            </Line>
            <Line label="Last read">
              {source.last_read_at ? formatDateTime(source.last_read_at) : 'Never'}
            </Line>
            <Line label="Pages today">
              <span className="tabular-nums">
                {formatNumber(source.pages_today)} of {formatNumber(source.pages_limit)}
              </span>
            </Line>
            <Line label="In our copy">{pluralise(source.records, 'record')}</Line>
          </dl>
        ) : null}
        {paused && source.paused_until ? (
          <div className="flex flex-col gap-2 rounded-md border border-review bg-review-soft px-3 py-2 text-review-ink sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2">
              <Pause aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              Paused until {formatDateTime(source.paused_until)}. Nothing reads it until then.
            </p>
            {source.connected ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={resume.isPending}
                onClick={() => {
                  resume.mutate(source.id, {
                    onSuccess: (resumed) => {
                      toast(`${resumed.name} resumed.`)
                    },
                    onError: toastProblem,
                  })
                }}
              >
                {resume.isPending ? 'Resuming.' : 'Resume'}
              </Button>
            ) : null}
          </div>
        ) : null}
        {source.last_problem ? (
          <p
            className={cn(
              'flex max-w-prose items-start gap-2',
              source.connected ? 'text-review-ink' : 'text-muted-foreground',
            )}
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {source.last_problem}
          </p>
        ) : null}
        {source.connected ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              // The backend checks only a tool that is on and not paused (409 otherwise).
              disabled={check.isPending || !source.on || paused}
              onClick={() => {
                check.mutate(source.id, {
                  onSuccess: (checked) => {
                    toast(
                      checked.last_problem
                        ? `${checked.name}: ${checked.last_problem}`
                        : `Signed in to ${checked.name}.`,
                    )
                  },
                  onError: toastProblem,
                })
              }}
            >
              <RefreshCw aria-hidden="true" />
              {check.isPending ? 'Checking.' : 'Check now'}
            </Button>
            <span className="text-caption text-muted-foreground">
              {!source.on
                ? 'Switch it on to check its sign-in.'
                : paused
                  ? 'Resume it to check its sign-in.'
                  : 'A free sign-in check: it reads one page.'}
            </span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export default function AdminSourcesTab() {
  const sources = useSources()
  if (sources.error) {
    return (
      <ErrorState
        error={sources.error}
        context="The sources couldn't be loaded."
        onRetry={() => void sources.refetch()}
      />
    )
  }
  if (!sources.data) {
    return <PendingCards label="Loading the sources." cards={2} />
  }
  if (sources.data.items.length === 0) {
    return <EmptyState title="No property tools are set up." />
  }
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {sources.data.items.map((source) => (
        <SourceCard key={source.id} source={source} />
      ))}
    </div>
  )
}
