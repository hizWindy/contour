/**
 * The parts of "Find new leads" that PLAN-V16 T3-2 adds:
 *
 * - **Where:** "All of Australia" first (one national search for each sign; picking it clears the
 *   cities), then the cities in their four groups, as chips. The map shows what is picked, and
 *   each picked city can narrow to its CBD or its inner suburbs.
 * - "Where to look" (the web and the two property tools) was here too. PLAN-V27 took it out: a run
 *   finds companies on the web only, and the research reads the tools for each one.
 *
 * "How many leads" was here too (PLAN-V16 T3-2). PLAN-V20 took it out: a run researches every
 * company it chooses, and no goal of good leads stops it.
 */
import type { CityOption, RunOptions } from '@/api/types'
import { CityMap } from '@/components/city-map'
import { ChipGroup, Segmented } from '@/components/motion'
import { FieldError } from '@/components/ui/field'
import { CITY_GROUP_LABELS, CITY_GROUP_ORDER } from '@/lib/labels'
import { AUSTRALIA, errorFor, pickPlaces, type StartForm } from './form'

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
            <Segmented
              size="sm"
              value={form.area[city.name] ?? 'all'}
              options={city.areas.map((area) => ({ value: area.id, label: area.label }))}
              onChange={(value) => {
                update({ area: { ...form.area, [city.name]: value } })
              }}
              aria-label={`Part of ${city.name}`}
            />
          </div>
        ))}
      {errorFor(errors, 'area') ? <FieldError>{errorFor(errors, 'area')}</FieldError> : null}
    </>
  )
}
