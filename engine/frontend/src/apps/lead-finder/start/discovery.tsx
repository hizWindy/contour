/**
 * The parts of "Find new leads" that PLAN-V16 T3-2 adds:
 *
 * - **Where:** "All of Australia" first (one national search for each sign; picking it clears the
 *   cities), then the cities in their four groups, as chips. The map shows what is picked, and
 *   each picked city can narrow to its CBD or its inner suburbs.
 * - **Where to look:** the web, Property Daily and Arealytics. A tool that isn't ready is greyed
 *   out, with the backend's one sentence on why.
 * - **How many leads:** 1 to 100, filled with the default. Under it, the estimate's sentence: the
 *   companies the goal needs and their cost, or the limit that binds.
 */
import { TriangleAlert } from 'lucide-react'
import type { CityOption, RunEstimate, RunOptions } from '@/api/types'
import { CityMap } from '@/components/city-map'
import { ChipGroup } from '@/components/motion'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  CITY_GROUP_LABELS,
  CITY_GROUP_ORDER,
  RUN_SOURCE_LABELS,
  RUN_SOURCE_ORDER,
} from '@/lib/labels'
import { cn } from '@/lib/utils'
import {
  AUSTRALIA,
  errorFor,
  goalLine,
  pickPlaces,
  readGoal,
  type Area,
  type StartForm,
} from './form'

type Update = (changes: Partial<StartForm>) => void

function cityWords(city: CityOption): string {
  return city.kind === 'director_review' ? `${city.name}, Director review` : city.name
}

interface PartProps {
  options: RunOptions
  form: StartForm
  update: Update
  errors: Record<string, string>
}

/** Where to search: all of Australia, or cities picked from the four groups. */
export function WhereChoices({ options, form, update, errors }: PartProps) {
  const national = options.cities.find((city) => city.group === 'national')
  const nationwide = form.cities.includes(AUSTRALIA)
  const picked = options.cities.filter(
    (city) => city.group !== 'national' && form.cities.includes(city.name),
  )
  const change = (group: readonly string[], next: readonly string[]): void => {
    update({ cities: pickPlaces(options, form.cities, group, next) })
  }
  return (
    <>
      {national ? (
        <div className="flex flex-col gap-1.5">
          <ChipGroup
            aria-label="All of Australia"
            options={[{ value: national.name, label: 'All of Australia' }]}
            value={nationwide ? [national.name] : []}
            onChange={(next) => {
              change([national.name], next)
            }}
          />
          <p className="text-caption text-muted-foreground">
            One search for each sign, across Australia. Picking it clears the cities.
          </p>
        </div>
      ) : null}
      {CITY_GROUP_ORDER.map((group) => {
        const cities = options.cities.filter((city) => city.group === group)
        if (cities.length === 0) {
          return null
        }
        const names = cities.map((city) => city.name)
        const labelId = `city-group-${group}`
        return (
          <div key={group} className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-start">
            <p id={labelId} className="text-ui font-semibold sm:pt-1.5">
              {CITY_GROUP_LABELS[group]}
            </p>
            <ChipGroup
              aria-labelledby={labelId}
              options={cities.map((city) => ({ value: city.name, label: cityWords(city) }))}
              value={form.cities.filter((name) => names.includes(name))}
              onChange={(next) => {
                change(names, next)
              }}
            />
          </div>
        )
      })}
      {errorFor(errors, 'cities') ? <FieldError>{errorFor(errors, 'cities')}</FieldError> : null}
      {/* The map shows what is picked. Picking is done with the chips above, which the keyboard
          reaches; all of Australia shows the whole map. */}
      <CityMap
        label="Where this run searches"
        cities={picked}
        selectedCities={form.cities}
        wholeCountry={nationwide}
        compact
      />
      {/* Each picked city's part: the toggles sit right after the name, not at the far edge. */}
      {picked
        .filter((city) => city.areas.length > 1)
        .map((city) => (
          <div key={city.name} className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="w-28 text-ui">{city.name}</span>
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
          </div>
        ))}
      {errorFor(errors, 'area') ? <FieldError>{errorFor(errors, 'area')}</FieldError> : null}
    </>
  )
}

function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

/** The web, Property Daily and Arealytics. A tool that isn't ready can't be ticked, and says why. */
export function SourceChoices({ options, form, update, errors }: PartProps) {
  const error = errorFor(errors, 'sources')
  return (
    <FieldSet>
      <FieldLegend variant="label">Where to look</FieldLegend>
      <div className="flex flex-col gap-3">
        {RUN_SOURCE_ORDER.map((id) => {
          const source = options.sources[id]
          const inputId = `source-${id}`
          const whyId = `${inputId}-why`
          return (
            <Field
              key={id}
              orientation="horizontal"
              data-disabled={source.ready ? undefined : 'true'}
            >
              <Checkbox
                id={inputId}
                checked={source.ready && form.sources.includes(id)}
                disabled={!source.ready}
                onCheckedChange={() => {
                  update({ sources: toggle(form.sources, id) })
                }}
                aria-describedby={source.message ? whyId : undefined}
              />
              <FieldContent>
                <FieldLabel htmlFor={inputId} className="font-normal">
                  {RUN_SOURCE_LABELS[id]}
                </FieldLabel>
                {source.message ? (
                  <FieldDescription id={whyId}>{source.message}</FieldDescription>
                ) : null}
              </FieldContent>
            </Field>
          )
        })}
      </div>
      {error ? <FieldError>{error}</FieldError> : null}
    </FieldSet>
  )
}

/** How many good leads the run should find, with the estimate's sentence under it. */
export function GoalChoice({
  form,
  update,
  errors,
  estimate,
  goalProblem,
}: Omit<PartProps, 'options'> & { estimate: RunEstimate | undefined; goalProblem?: string }) {
  const error = goalProblem ?? errorFor(errors, 'goal_leads')
  const line = goalLine(estimate, readGoal(form.goalLeads))
  const binds = line !== null && Boolean(estimate?.goal_note)
  return (
    <Field>
      <FieldLabel htmlFor="goal-leads">How many leads</FieldLabel>
      <Input
        id="goal-leads"
        inputMode="numeric"
        autoComplete="off"
        className="max-w-32"
        value={form.goalLeads}
        onChange={(event) => {
          update({ goalLeads: event.target.value })
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby="goal-leads-about"
      />
      <FieldDescription id="goal-leads-about">
        Good leads, Tier A or B. The run stops once it has found them. Leave it empty for no goal.
      </FieldDescription>
      {error ? <FieldError>{error}</FieldError> : null}
      {line && !error ? (
        <p
          className={cn(
            'flex items-start gap-2 text-ui',
            binds ? 'text-review-ink' : 'text-muted-foreground',
          )}
        >
          {binds ? <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : null}
          {line}
        </p>
      ) : null}
    </Field>
  )
}
