/**
 * "How many companies" on "Find new leads" (PLAN-V21 T3-3), under the signs:
 *
 * - The presets as buttons (25, 50 and 100, cut to the run's company limit by the backend) and a
 *   number field that forgives "1,000" and "50 companies". A single preset would only repeat the
 *   field, so it shows only when there are two or more.
 * - The estimate's cost for that many companies ("about US$X to US$Y"), and its one sentence when
 *   the target doesn't fit the money limits.
 * - A short run is no longer topped up from the HubSpot watchlist (PLAN-V27 choice 5): it says it
 *   came up short in its feed.
 *
 * "Most companies to research" (in the Limits fold) stays the ceiling. A person who lowers it
 * under the target gets a run that aims for the lower number, and the line under the field says
 * so. The typed target is kept, so raising the limit again brings it back, and the form never
 * holds a choice the server would refuse.
 */
import { TriangleAlert } from 'lucide-react'
import type { RunEstimate, RunOptions } from '@/api/types'
import { Segmented } from '@/components/motion'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { pluralise } from '@/lib/format'
import { formatMoney } from '@/lib/money'
import { errorFor, targetChoice, wholeNumberOf, type StartForm } from './form'

interface TargetProps {
  options: RunOptions
  form: StartForm
  update: (changes: Partial<StartForm>) => void
  errors: Record<string, string>
  /** The last estimate: the cost of the target, and its note. */
  estimate: RunEstimate | undefined
}

export function TargetChoices({ options, form, update, errors, estimate }: TargetProps) {
  const limits = options.target_companies
  const choice = targetChoice(form, options)
  const typed = wholeNumberOf(form.targetCompanies)
  const preset = typed !== null && limits.presets.includes(typed) ? String(typed) : ''
  const error = errorFor(errors, 'target_companies')
  const valid = estimate?.valid === true
  const low = valid ? estimate.target_cost_usd_low : null
  const high = valid ? estimate.target_cost_usd_high : null
  const aimed = valid ? estimate.target_companies : null

  return (
    <>
      <Field>
        <FieldLabel htmlFor="target-companies">Companies to research</FieldLabel>
        <div className="flex flex-wrap items-center gap-2">
          {/* One preset (a company limit of 20 leaves only 20) would only repeat the field. */}
          {limits.presets.length > 1 ? (
            <Segmented
              aria-label="Suggested numbers"
              value={preset}
              options={limits.presets.map((count) => ({
                value: String(count),
                label: String(count),
              }))}
              onChange={(value) => {
                update({ targetCompanies: value })
              }}
            />
          ) : null}
          <Input
            id="target-companies"
            inputMode="numeric"
            className="w-24"
            placeholder={String(limits.default)}
            value={form.targetCompanies}
            onChange={(event) => {
              update({ targetCompanies: event.target.value })
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby="target-companies-about"
          />
        </div>
        <FieldDescription id="target-companies-about">
          {choice.pulledTo !== null
            ? `The run aims for ${String(choice.pulledTo)}, the most companies its limits below allow.`
            : `If the first search finds fewer, the run searches again in new ways. From ${String(limits.min)} to ${String(limits.max)}.`}
        </FieldDescription>
        {error ? <FieldError>{error}</FieldError> : null}
      </Field>
      {low !== null && high !== null && aimed !== null ? (
        <p className="text-ui">
          About {formatMoney(low)} to {formatMoney(high)} for{' '}
          {pluralise(aimed, 'company', 'companies')}.
        </p>
      ) : null}
      {valid && estimate.target_note ? (
        <p className="flex items-start gap-2 text-ui text-review-ink">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {estimate.target_note}
        </p>
      ) : null}
    </>
  )
}
