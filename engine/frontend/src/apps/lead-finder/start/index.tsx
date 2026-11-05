/**
 * Start a run: pick what to look for, see what it would cost, then start.
 *
 * - Three kinds of run: find new leads on the web (discovery), research the HubSpot watchlist,
 *   or research companies by name. The watchlist waits for Levi's OK to send HubSpot names to
 *   Claude; until then its Start button says so.
 * - The estimate updates as you choose (300 ms after the last change), with the run's cap and
 *   what is left of today's limit. A choice the server refuses is shown beside its field.
 * - Start is safe to double-click: the same choices send the same Idempotency-Key, so a second
 *   click returns the first run instead of starting another.
 */
import { CircleAlert, MapPinned, Play } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { fieldErrorMap, newIdempotencyKey, toApiProblem } from '@/api/client'
import { useCreateRun, useEstimateRun, useRunOptions } from '@/api/hooks'
import type { RunCreate, RunOptions } from '@/api/types'
import { CityMap } from '@/components/city-map'
import { PendingForm } from '@/components/skeletons'
import { ErrorState } from '@/components/error-state'
import { Money } from '@/components/money'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMoney } from '@/lib/money'
import { useMediaQuery } from '@/lib/use-media-query'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useDebounced } from '@/hooks/useDebounced'
import {
  bodyOf,
  EMPTY_ROW,
  errorFor,
  estimateErrors,
  initialForm,
  type Area,
  type CompanyRow,
  type Mode,
  type StartForm,
} from './form'

const MODE_WORDS: Record<Mode, { title: string; about: string }> = {
  discovery: {
    title: 'Find new leads',
    about: 'Search the news for companies with a sign of an office change.',
  },
  watchlist: {
    title: 'HubSpot watchlist',
    about: 'Research the HubSpot companies most likely to move.',
  },
  company: { title: 'Companies by name', about: 'Research the companies you type in.' },
}

const GROUP_WORDS: Record<string, string> = {
  main: 'Main signs',
  other: 'Other signs',
  weak: 'Weak signs',
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
  const [form, setForm] = useState<StartForm>(() => initialForm(options))
  const update = (changes: Partial<StartForm>): void => {
    setForm((current) => ({ ...current, ...changes }))
  }

  const body = useMemo(() => bodyOf(form), [form])
  const bodyKey = JSON.stringify(body)
  const settledKey = useDebounced(bodyKey, 300)
  const settledBody = useMemo(() => JSON.parse(settledKey) as RunCreate, [settledKey])
  const estimate = useEstimateRun(settledBody)
  // One key for one set of choices: a double click sends it twice and gets one run.
  const lastStart = useRef<{ body: string; key: string } | null>(null)
  const createRun = useCreateRun()

  const result = estimate.data
  const fromServer = createRun.error ? fieldErrorMap(toApiProblem(createRun.error)) : {}
  const errors = { ...estimateErrors(result), ...fromServer }
  const mode = options.modes.find((item) => item.mode === form.mode)
  const settling = settledKey !== bodyKey || estimate.isFetching

  const reason: string | null =
    mode && mode.needs_approval && !mode.approved
      ? (result?.blocked?.message ?? "This kind of run waits for Levi's OK.")
      : result?.blocked
        ? result.blocked.message
        : result && !result.valid
          ? 'Fix the choices marked in red first.'
          : !result
            ? 'Working out what it would cost.'
            : null

  // Under 1024px the cost card is far below the form (three screens on a phone), so the money and
  // the Start button follow you in a bar at the bottom of the screen instead.
  const barAtBottom = useMediaQuery(UNDER_LAPTOP)

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
        <Section title="What to do">
          <ToggleGroup
            type="single"
            variant="outline"
            value={form.mode}
            onValueChange={(value) => {
              if (value) update({ mode: value as Mode })
            }}
            aria-label="Kind of run"
            className="flex-wrap justify-start"
          >
            {(Object.keys(MODE_WORDS) as Mode[]).map((value) => (
              <ToggleGroupItem key={value} value={value}>
                {MODE_WORDS[value].title}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-ui text-muted-foreground">{MODE_WORDS[form.mode].about}</p>
        </Section>

        {form.mode === 'discovery' ? (
          <>
            <Section title="Where">
              <CityMap
                label="Cities to search"
                cities={options.cities}
                selectedCities={form.cities}
                onToggleCity={(city) => {
                  update({ cities: toggle(form.cities, city) })
                }}
              />
              {errorFor(errors, 'cities') ? (
                <FieldError>{errorFor(errors, 'cities')}</FieldError>
              ) : null}
              {options.cities
                .filter((city) => form.cities.includes(city.name))
                .map((city) => (
                  <Field key={city.name} orientation="horizontal" className="flex-wrap">
                    <FieldLabel className="w-28">{city.name}</FieldLabel>
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      size="sm"
                      value={form.area[city.name] ?? 'all'}
                      onValueChange={(value) => {
                        if (value) update({ area: { ...form.area, [city.name]: value as Area } })
                      }}
                      aria-label={`Part of ${city.name}`}
                    >
                      {city.areas.map((area) => (
                        <ToggleGroupItem key={area.id} value={area.id}>
                          {area.label}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </Field>
                ))}
              {errorFor(errors, 'area') ? (
                <FieldError>{errorFor(errors, 'area')}</FieldError>
              ) : null}
            </Section>

            <Section title="Signs of an office change">
              {(['main', 'other', 'weak'] as const).map((group) => {
                const items = options.triggers.filter((trigger) => trigger.group === group)
                if (items.length === 0) return null
                return (
                  <FieldSet key={group}>
                    <FieldLegend variant="label">{GROUP_WORDS[group]}</FieldLegend>
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
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={String(form.sinceDays)}
                  onValueChange={(value) => {
                    if (value) update({ sinceDays: Number(value) })
                  }}
                  aria-labelledby="since-label"
                  className="justify-start"
                >
                  {options.since_days.choices.map((days) => (
                    <ToggleGroupItem key={days} value={String(days)}>
                      Last {days} days
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>
            </Section>
          </>
        ) : null}

        {form.mode === 'watchlist' ? (
          <Section title="Which HubSpot companies">
            <Field orientation="horizontal">
              <Checkbox
                id="include-unlikely"
                checked={form.includeUnlikely}
                onCheckedChange={(checked) => {
                  update({ includeUnlikely: checked === true })
                }}
              />
              <FieldLabel htmlFor="include-unlikely" className="font-normal">
                Include industries that rarely work in an office
              </FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                id="include-director"
                checked={form.includeDirector}
                onCheckedChange={(checked) => {
                  update({ includeDirector: checked === true })
                }}
              />
              <FieldLabel htmlFor="include-director" className="font-normal">
                Also research the Director review list
              </FieldLabel>
            </Field>
            <Field className="max-w-48">
              <FieldLabel htmlFor="watch-limit">Only the first</FieldLabel>
              <Input
                id="watch-limit"
                inputMode="numeric"
                placeholder="All"
                value={form.watchLimit}
                onChange={(event) => {
                  update({ watchLimit: event.target.value })
                }}
                aria-invalid={errorFor(errors, 'watchlist') ? true : undefined}
              />
              <FieldDescription>Leave empty for as many as the run limit allows.</FieldDescription>
              {errorFor(errors, 'watchlist') ? (
                <FieldError>{errorFor(errors, 'watchlist')}</FieldError>
              ) : null}
            </Field>
          </Section>
        ) : null}

        {form.mode === 'company' ? (
          <Section title="Companies">
            {form.companies.map((row, index) => {
              const label = `Company ${index + 1}`
              const nameError = errorFor(errors, `companies.${index}.name`)
              const change = (changes: Partial<CompanyRow>): void => {
                update({
                  companies: form.companies.map((item, at) =>
                    at === index ? { ...item, ...changes } : item,
                  ),
                })
              }
              return (
                <FieldSet key={index} className="grid gap-3 sm:grid-cols-[2fr_1fr_1.5fr_auto]">
                  <FieldLegend className="sr-only">{label}</FieldLegend>
                  <Field>
                    <FieldLabel htmlFor={`company-${index}-name`}>Name</FieldLabel>
                    <Input
                      id={`company-${index}-name`}
                      value={row.name}
                      placeholder="Culture Amp"
                      onChange={(event) => {
                        change({ name: event.target.value })
                      }}
                      aria-invalid={nameError ? true : undefined}
                    />
                    {nameError ? <FieldError>{nameError}</FieldError> : null}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`company-${index}-city`}>City</FieldLabel>
                    <Input
                      id={`company-${index}-city`}
                      value={row.city}
                      placeholder="Melbourne"
                      onChange={(event) => {
                        change({ city: event.target.value })
                      }}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`company-${index}-website`}>Website</FieldLabel>
                    <Input
                      id={`company-${index}-website`}
                      value={row.website}
                      placeholder="cultureamp.com"
                      onChange={(event) => {
                        change({ website: event.target.value })
                      }}
                    />
                  </Field>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={form.companies.length === 1}
                      onClick={() => {
                        update({ companies: form.companies.filter((_, at) => at !== index) })
                      }}
                      aria-label={`Remove company ${index + 1}`}
                    >
                      Remove
                    </Button>
                  </div>
                </FieldSet>
              )
            })}
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={form.companies.length >= options.companies_limit.max}
                onClick={() => {
                  update({ companies: [...form.companies, { ...EMPTY_ROW }] })
                }}
              >
                Add a company
              </Button>
            </div>
            {errorFor(errors, 'companies') && !errorFor(errors, 'companies.0') ? (
              <FieldError>{errorFor(errors, 'companies')}</FieldError>
            ) : null}
          </Section>
        ) : null}

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
            {barAtBottom ? null : (
              <Button
                type="button"
                size="lg"
                disabled={reason !== null || settling || createRun.isPending}
                onClick={start}
              >
                <Play aria-hidden="true" />
                {createRun.isPending ? 'Starting.' : 'Start run'}
              </Button>
            )}
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
          data-slot="start-bar"
          className="sticky bottom-0 z-30 -mx-4 flex items-center gap-3 border-t bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6 [@media(max-height:480px)]:static"
        >
          <div className="min-w-0 flex-1">
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
          </div>
          <Button
            type="button"
            size="lg"
            disabled={reason !== null || settling || createRun.isPending}
            onClick={start}
          >
            <Play aria-hidden="true" />
            {createRun.isPending ? 'Starting.' : 'Start run'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export default function StartPage() {
  const options = useRunOptions()
  return (
    <>
      <PageHeader
        icon={MapPinned}
        tone="lead"
        title="Start a run"
        description="Choose what to look for, check the cost, then start. You can stop a run at any time."
      />
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
