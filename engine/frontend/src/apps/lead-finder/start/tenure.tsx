/**
 * Start a run, "Old offices (lease and tenure)" (PLAN-V11 C3): the HubSpot watchlist in one city,
 * researched for how long each company has been at its address. 8 or more years with no office
 * project since is a sign of its own (C1).
 *
 * - The city, the industries (optional, from that city's watchlist, with counts) and how many
 *   companies, the most staff first.
 * - The free count: how many watchlist companies fit, from the local HubSpot copy. Nothing goes to
 *   Claude for it, so it is free. The cost card beside the form shows what the run would cost.
 */
import { useWatchlist } from '@/api/hooks'
import type { RunOptions } from '@/api/types'
import { PickList } from '@/components/pick-list'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { pluralise } from '@/lib/format'
import { errorFor, type StartForm } from './form'

interface TenureChoicesProps {
  options: RunOptions
  form: StartForm
  update: (changes: Partial<StartForm>) => void
  errors: Record<string, string>
}

/** How many watchlist companies fit the choices, free: the local HubSpot copy, no Claude. */
function FreeCount({ city, industries }: { city: string; industries: string[] }) {
  const preview = useWatchlist({
    city,
    industry: industries,
    include_director: false,
    limit: 1,
  })
  const total = preview.data?.total
  return (
    <p className="text-ui text-muted-foreground" role="status">
      {total === undefined
        ? `Counting the watchlist companies in ${city}.`
        : `${pluralise(total, 'watchlist company', 'watchlist companies')} in ${city}${
            industries.length > 0 ? ' in these industries' : ''
          }. Counting them is free: nothing goes to Claude.`}
    </p>
  )
}

export function TenureChoices({ options, form, update, errors }: TenureChoicesProps) {
  const cities = options.watchlist_cities ?? []
  const city = form.tenureCity
  // The city's industries, the most companies first, for the picker. Free, like the count.
  const preview = useWatchlist({ city, include_director: false, limit: 1 })
  const industries = (preview.data?.industries ?? []).map((item) => ({
    value: item.value,
    label: item.value,
    count: item.count,
  }))
  const cityError = errorFor(errors, 'watchlist.city')
  const industryError = errorFor(errors, 'watchlist.industries')
  const limitError = errorFor(errors, 'watchlist.limit')
  return (
    <>
      <Field>
        <FieldLabel id="tenure-city-label">City</FieldLabel>
        <ToggleGroup
          type="single"
          variant="outline"
          value={city}
          onValueChange={(value) => {
            // A new city has other industries, so the picked ones start again.
            if (value) update({ tenureCity: value, tenureIndustries: [] })
          }}
          aria-labelledby="tenure-city-label"
          className="flex-wrap justify-start"
        >
          {cities.map((name) => (
            <ToggleGroupItem key={name} value={name}>
              {name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {cityError ? <FieldError>{cityError}</FieldError> : null}
      </Field>
      <Field>
        <FieldLabel id="tenure-industries-label">Industries</FieldLabel>
        <div className="flex flex-wrap items-center gap-2">
          <PickList
            title="Industries"
            srPrefix="Choose"
            options={industries}
            picked={form.tenureIndustries}
            onChange={(values) => {
              update({ tenureIndustries: values })
            }}
          />
          <span className="text-ui text-muted-foreground">
            {form.tenureIndustries.length === 0 ? 'Any industry' : form.tenureIndustries.join(', ')}
          </span>
        </div>
        <FieldDescription>Optional. The industries as HubSpot names them.</FieldDescription>
        {industryError ? <FieldError>{industryError}</FieldError> : null}
      </Field>
      <Field className="max-w-56">
        <FieldLabel htmlFor="tenure-limit">How many companies</FieldLabel>
        <Input
          id="tenure-limit"
          inputMode="numeric"
          placeholder="All"
          value={form.tenureLimit}
          onChange={(event) => {
            update({ tenureLimit: event.target.value.replace(/\D/g, '') })
          }}
          aria-invalid={limitError ? true : undefined}
        />
        <FieldDescription>
          The most staff first. Empty: as many as the run limit allows.
        </FieldDescription>
        {limitError ? <FieldError>{limitError}</FieldError> : null}
      </Field>
      {city ? <FreeCount city={city} industries={form.tenureIndustries} /> : null}
    </>
  )
}
