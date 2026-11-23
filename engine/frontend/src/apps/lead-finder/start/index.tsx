/**
 * Start a run: pick what to look for, see what it would cost, then start.
 *
 * - One kind of run, Find new leads (PLAN-V27 choice 1): the page opens on its form. Old offices
 *   and the HubSpot watchlist are switched off, and researching one company by name is the
 *   Assistant's ("Research Northwind"). Companies already in HubSpot are left out of the run.
 * - The estimate updates as you choose (300 ms after the last change), with the run's cap and
 *   what is left of today's limit. A choice the server refuses is shown beside its field.
 * - Start is safe to double-click: the same choices send the same Idempotency-Key, so a second
 *   click returns the first run instead of starting another.
 * - Finding new leads (PLAN-V16 T3-2) searches all of Australia or cities in four groups, and where
 *   to look (the web and the two property tools). Those parts are in `discovery.tsx`. How many
 *   companies to research (PLAN-V21 T3-3) is in `target.tsx`.
 */
import { CircleAlert, MapPinned, Play } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { fieldErrorMap, newIdempotencyKey, toApiProblem } from '@/api/client'
import { useCreateRun, useEstimateRun, useRunOptions } from '@/api/hooks'
import type { RunCreate, RunOptions } from '@/api/types'
import { useCanWrite, usePlatformAdminName, viewerReadOnlyWords } from '@/auth/can'
import { FeatureGuard } from '@/auth/guard'
import { PendingForm } from '@/components/skeletons'
import { ErrorState } from '@/components/error-state'
import { Money } from '@/components/money'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { sinceDaysLabel } from '@/lib/labels'
import { formatMoney } from '@/lib/money'
import { useBarRoom } from '@/lib/use-bar-room'
import { useMediaQuery } from '@/lib/use-media-query'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/motion'
import { useDebounced } from '@/hooks/useDebounced'
import { SourceChoices, WhereChoices } from './discovery'
import {
  bodyOf,
  errorFor,
  estimateErrors,
  initialForm,
  serverMode,
  targetChoice,
  type StartForm,
} from './form'
import { TargetChoices } from './target'

/** What the run does, in one line under the page's title (PLAN-V27 "Words on screen"). */
export const FIND_NEW_LEADS =
  'Find new leads: search the news for companies with a sign of an office change. Companies already in HubSpot are left out.'

/**
 * The signs' groups, in this order. PLAN-V16 T1-4 gives each sign a strength (very high to low);
 * until the backend sends those, the old groups (main, other, weak) show. A group the page doesn't
 * know yet comes last, under its own name, so no sign is ever hidden.
 */
const GROUP_WORDS: Record<string, string> = {
  very_high: 'Very strong signs',
  high: 'Strong signs',
  medium: 'Medium signs',
  low: 'Weak signs',
  main: 'Main signs',
  other: 'Other signs',
  weak: 'Weak signs',
}

function signGroups(options: RunOptions): string[] {
  const seen = [...new Set(options.triggers.map((trigger) => trigger.group as string))]
  const known = Object.keys(GROUP_WORDS).filter((group) => seen.includes(group))
  return [...known, ...seen.filter((group) => !(group in GROUP_WORDS))]
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

/** Below Tailwind's `lg`: the cost card sits under the form, not beside it. */
const UNDER_LAPTOP = '(max-width: 1023px)'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-section font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  )
}

function StartFormView({ options }: { options: RunOptions }) {
  const navigate = useNavigate()
  const canWrite = useCanWrite('lead_finder.start_run')
  const platformAdminName = usePlatformAdminName()
  const [form, setForm] = useState<StartForm>(() => initialForm(options))
  const update = (changes: Partial<StartForm>): void => {
    setForm((current) => ({ ...current, ...changes }))
  }

  const body = useMemo(() => bodyOf(form, options), [form, options])
  const bodyKey = JSON.stringify(body)
  const settledKey = useDebounced(bodyKey, 300)
  const settledBody = useMemo(() => JSON.parse(settledKey) as RunCreate, [settledKey])
  const estimate = useEstimateRun(canWrite ? settledBody : null)
  // One key for one set of choices: a double click sends it twice and gets one run.
  const lastStart = useRef<{ body: string; key: string } | null>(null)
  const createRun = useCreateRun()

  const result = estimate.data
  const fromServer = createRun.error ? fieldErrorMap(toApiProblem(createRun.error)) : {}
  // A target the page can't read never reaches the server: it says why, beside the field.
  const targetError = targetChoice(form, options).error
  const fromPage: Record<string, string> = targetError ? { target_companies: targetError } : {}
  const errors = { ...estimateErrors(result), ...fromServer, ...fromPage }
  const mode = options.modes.find((item) => item.mode === serverMode(form.mode))
  const settling = canWrite && (settledKey !== bodyKey || estimate.isFetching)

  const reason: string | null = !canWrite
    ? null
    : mode && mode.needs_approval && !mode.approved
      ? (result?.blocked?.message ?? "This kind of run waits for Levi's OK.")
      : result?.blocked
        ? result.blocked.message
        : targetError || (result && !result.valid)
          ? 'Fix the choices marked in red first.'
          : !result
            ? 'Working out what it would cost.'
            : null

  // Under 1024px the cost card is far below the form (three screens on a phone), so the money and
  // the Start button follow you in a bar at the bottom of the screen instead.
  const barAtBottom = useMediaQuery(UNDER_LAPTOP)
  // A field the keyboard lands on scrolls above that bar, never under it.
  const barRoom = useBarRoom()

  const start = (): void => {
    if (lastStart.current?.body !== bodyKey) {
      lastStart.current = { body: bodyKey, key: newIdempotencyKey() }
    }
    createRun.mutate(
      { body, idempotencyKey: lastStart.current.key },
      {
        onSuccess: (run) => {
          void navigate(`/runs/${run.id}`)
        },
      },
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-6">
        <>
          <Section title="Where">
            <WhereChoices options={options} form={form} update={update} errors={errors} />
          </Section>

          <Section title="Signs of an office change">
            {signGroups(options).map((group) => {
              const items = options.triggers.filter((trigger) => trigger.group === group)
              if (items.length === 0) return null
              return (
                <FieldSet key={group}>
                  <FieldLegend variant="label">{GROUP_WORDS[group] ?? group}</FieldLegend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {items.map((trigger) => {
                      const id = `trigger-${trigger.id}`
                      return (
                        <Field key={trigger.id} orientation="horizontal">
                          <Checkbox
                            id={id}
                            checked={form.triggers.includes(trigger.id)}
                            onCheckedChange={() => {
                              update({ triggers: toggle(form.triggers, trigger.id) })
                            }}
                          />
                          <FieldLabel htmlFor={id} className="font-normal">
                            {trigger.label}
                          </FieldLabel>
                        </Field>
                      )
                    })}
                  </div>
                </FieldSet>
              )
            })}
            {errorFor(errors, 'triggers') ? (
              <FieldError>{errorFor(errors, 'triggers')}</FieldError>
            ) : null}
            <Field>
              <FieldLabel id="since-label">How far back</FieldLabel>
              {/* The vertical Field stretches each direct child (`*:w-full`), which beat the
                    control's own `w-fit` and spread its track across the card. The wrapper takes
                    the stretch, and the control hugs its labels (PLAN-V21 T3-2). */}
              <div data-slot="since-days">
                <Segmented
                  size="sm"
                  value={String(form.sinceDays)}
                  options={options.since_days.choices.map((days) => ({
                    value: String(days),
                    label: sinceDaysLabel(days),
                  }))}
                  onChange={(value) => {
                    update({ sinceDays: Number(value) })
                  }}
                  aria-labelledby="since-label"
                />
              </div>
            </Field>
          </Section>

          <Section title="How many companies">
            <TargetChoices
              options={options}
              form={form}
              update={update}
              errors={errors}
              estimate={result}
            />
          </Section>

          <Section title="Sources">
            <SourceChoices options={options} form={form} update={update} errors={errors} />
          </Section>
        </>

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="self-start">
              Lower the limits for this run
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="run-cap">Most this run may spend (US$)</FieldLabel>
              <Input
                id="run-cap"
                inputMode="decimal"
                placeholder={options.caps.run_cap_usd}
                value={form.runCap}
                onChange={(event) => {
                  update({ runCap: event.target.value })
                }}
                aria-invalid={errorFor(errors, 'caps.run_cap_usd') ? true : undefined}
              />
              {errorFor(errors, 'caps.run_cap_usd') ? (
                <FieldError>{errorFor(errors, 'caps.run_cap_usd')}</FieldError>
              ) : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="max-companies">Most companies to research</FieldLabel>
              <Input
                id="max-companies"
                inputMode="numeric"
                placeholder={String(options.caps.max_companies)}
                value={form.maxCompanies}
                onChange={(event) => {
                  update({ maxCompanies: event.target.value })
                }}
                aria-invalid={errorFor(errors, 'caps.max_companies') ? true : undefined}
              />
              {errorFor(errors, 'caps.max_companies') ? (
                <FieldError>{errorFor(errors, 'caps.max_companies')}</FieldError>
              ) : null}
            </Field>
          </CollapsibleContent>
        </Collapsible>
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start" aria-label="Cost">
        <Card>
          <CardHeader>
            <CardTitle className="text-section font-semibold">What it would cost</CardTitle>
            <CardDescription>
              {settling ? 'Updating.' : (result?.basis ?? 'Estimated from past runs or defaults.')}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-ui">
            {estimate.error ? (
              <ErrorState error={estimate.error} context="The cost couldn't be worked out." />
            ) : null}
            {result?.valid ? (
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                <dt className="text-muted-foreground">Likely</dt>
                <dd className="text-right">
                  <Money value={result.cost_usd_low} about />
                </dd>
                <dt className="text-muted-foreground">At most</dt>
                <dd className="text-right">
                  <Money value={result.cost_usd_high} />
                </dd>
                <dt className="text-muted-foreground">Run limit</dt>
                <dd className="text-right">
                  <Money value={result.cap_usd} />
                </dd>
                <dt className="text-muted-foreground">Left today</dt>
                <dd className="text-right">
                  <Money value={result.daily_left_usd} />
                </dd>
                {result.slices > 0 ? (
                  <>
                    <dt className="text-muted-foreground">Searches for companies</dt>
                    <dd className="text-right">{result.slices}</dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Companies</dt>
                <dd className="text-right">{result.companies_expected}</dd>
              </dl>
            ) : null}
            {result && result.warnings.length > 0 ? (
              <ul className="flex flex-col gap-1 text-caption text-muted-foreground">
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            {createRun.error ? <ErrorState error={createRun.error} /> : null}
            {!barAtBottom && canWrite ? (
              <Button
                type="button"
                size="lg"
                disabled={reason !== null || settling || createRun.isPending}
                onClick={start}
              >
                <Play aria-hidden="true" />
                {createRun.isPending ? 'Starting.' : 'Start run'}
              </Button>
            ) : null}
            {!canWrite ? (
              <p className="text-caption text-muted-foreground" role="status">
                {viewerReadOnlyWords(platformAdminName)}
              </p>
            ) : null}
            {reason ? (
              <p
                className="flex items-start gap-2 text-caption text-muted-foreground"
                role="status"
              >
                <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {reason}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </aside>

      {barAtBottom ? (
        <div
          ref={barRoom}
          data-slot="start-bar"
          className="sticky bottom-0 z-30 -mx-4 flex items-center gap-3 border-t bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6 [@media(max-height:480px)]:static"
        >
          <div className="min-w-0 flex-1">
            {!canWrite ? (
              <p className="line-clamp-2 text-caption text-muted-foreground" role="status">
                {viewerReadOnlyWords(platformAdminName)}
              </p>
            ) : (
              <>
                {result?.valid ? (
                  <p className="font-semibold">
                    <Money value={result.cost_usd_low} about />
                  </p>
                ) : null}
                <p className="line-clamp-2 text-caption text-muted-foreground" role="status">
                  {reason ??
                    (result?.valid
                      ? `Run limit ${formatMoney(result.cap_usd)}. Left today ${formatMoney(result.daily_left_usd)}.`
                      : 'Working out what it would cost.')}
                </p>
              </>
            )}
          </div>
          {canWrite ? (
            <Button
              type="button"
              size="lg"
              disabled={reason !== null || settling || createRun.isPending}
              onClick={start}
            >
              <Play aria-hidden="true" />
              {createRun.isPending ? 'Starting.' : 'Start run'}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function StartContent() {
  const options = useRunOptions()
  return (
    <>
      <PageHeader icon={MapPinned} tone="lead" title="Start a run" description={FIND_NEW_LEADS} />
      {options.error ? (
        <ErrorState
          error={options.error}
          context="The choices couldn't be loaded."
          onRetry={() => void options.refetch()}
        />
      ) : options.data ? (
        <StartFormView options={options.data} />
      ) : (
        <PendingForm label="Loading the choices." />
      )}
    </>
  )
}

export default function StartPage() {
  return (
    <FeatureGuard feature="lead_finder.start_run" page="Start a run">
      <StartContent />
    </FeatureGuard>
  )
}
