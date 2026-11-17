/**
 * "How many companies" on "Find new leads" (PLAN-V21 T3-3), under the signs:
 *
 * - The presets as buttons (25, 50 and 100, cut to the run's company limit by the backend) and a
 *   number field that forgives "1,000" and "50 companies".
 * - The estimate's cost for that many companies ("about US$X to US$Y"), and its one sentence when
 *   the target doesn't fit the money limits.
 * - "Top up from the HubSpot watchlist": the sliding switch, with one line on what it does. While
 *   HubSpot names may not go to Claude, it is off and greyed, with the backend's reason.
 *
 * "Most companies to research" (in the Limits fold) stays the ceiling. A person who lowers it
 * under the target gets a run that aims for the lower number, and the line under the field says
 * so. The typed target is kept, so raising the limit again brings it back, and the form never
 * holds a choice the server would refuse.
 */
import { TriangleAlert } from 'lucide-react'
import type { RunEstimate, RunOptions } from '@/api/types'
import { Segmented } from '@/components/motion'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
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

/** When the backend gives no reason, which it always should. */
const TOP_UP_OFF = 'Not available for this run yet.'

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
  const allowed = options.top_up.allowed

  return (
    <>
      <Field>
        <FieldLabel htmlFor="target-companies">Companies to research</FieldLabel>
        <div className="flex flex-wrap items-center gap-2">
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
      <Field
        orientation="horizontal"
        data-disabled={allowed ? undefined : 'true'}
        className="border-t pt-4"
      >
        <FieldContent>
          <FieldLabel htmlFor="top-up">Top up from the HubSpot watchlist</FieldLabel>
          <FieldDescription id="top-up-about">
            {allowed
              ? 'If the searches come up short of the number, the run adds companies from the HubSpot watchlist in the same places, most likely first.'
              : (options.top_up.message ?? TOP_UP_OFF)}
          </FieldDescription>
        </FieldContent>
        <Switch
          id="top-up"
          checked={allowed && form.topUp}
          disabled={!allowed}
          onCheckedChange={(on) => {
            update({ topUp: on })
          }}
          aria-describedby="top-up-about"
        />
      </Field>
    </>
  )
}
