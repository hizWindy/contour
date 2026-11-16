/**
 * The pre-read while AI drafts it (PLAN-V18 T2-4): one calm part at the top that says AI is
 * drafting it and that the rep checks it before anyone gets it, with the draft's three steps
 * (`StepTrail`): "Reading HubSpot", "Writing the summaries" and "Ready for you to check".
 *
 * - **Each step fills on its real trigger, never on a timer** (`draftReached`): the facts arrive,
 *   so the summaries are being written; then the status is "draft". The page asks the server every
 *   2 seconds while it drafts (`useMeetingForm`), and each answer moves the trail on.
 * - **When it is ready** the trail stays full while the page is open, so the rep sees the last
 *   step fill. A pre-read that opens ready shows no trail: there was nothing to watch.
 * - **A failed draft stops the trail at its step,** with the reason in the server's plain words
 *   and "Try again" (the redraft, with what it costs). The summaries under it can still be written
 *   by hand.
 *
 * It is the third place that says AI drafts the pre-read, after New pre-read and "Draft it".
 */
import { Cpu, RefreshCw, TriangleAlert } from 'lucide-react'
import { useId } from 'react'
import { isStillDrafting, useRedraftMeetingForm } from '@/api/hooks/meetings'
import type { MeetingFormOut } from '@/api/types'
import { StepTrail } from '@/components/motion'
import { Button } from '@/components/ui/button'
import { toastProblem } from '@/lib/problems'
import { cn } from '@/lib/utils'
import { draftReached } from './rules'
import {
  CHECK_BEFORE_SENDING,
  DRAFT_STEPS,
  DRAFT_STEPS_LABEL,
  DRAFT_STOPPED,
  DRAFTED_TITLE,
  DRAFTING_TITLE,
  failedReason,
  redraftHint,
  TRY_AGAIN,
  withEstimate,
} from './words'

export function DraftProgress({ form, className }: { form: MeetingFormOut; className?: string }) {
  const titleId = useId()
  const hintId = useId()
  const redraft = useRedraftMeetingForm(form.id)
  const failed = form.status === 'failed'
  const title = failed ? DRAFT_STOPPED : form.status === 'drafting' ? DRAFTING_TITLE : DRAFTED_TITLE

  return (
    <section
      aria-labelledby={titleId}
      data-slot="draft-progress"
      className={cn('flex flex-col gap-4', className)}
    >
      <div className="flex items-start gap-3">
        <Cpu aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={titleId} className="text-ui font-semibold text-foreground">
            {title}
          </h2>
          <p className="text-caption text-muted-foreground">{CHECK_BEFORE_SENDING}</p>
        </div>
      </div>
      <StepTrail
        steps={DRAFT_STEPS}
        reached={draftReached(form)}
        failed={failed}
        aria-label={DRAFT_STEPS_LABEL}
        className="pl-7"
      />
      {failed ? (
        <div className="flex flex-col gap-2 pl-7">
          <p
            role="alert"
            data-slot="draft-failed"
            className="flex items-start gap-2 text-ui text-destructive-ink"
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {failedReason(form.error)}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="touch:h-11"
              disabled={redraft.isPending}
              aria-describedby={hintId}
              onClick={() => {
                redraft.mutate(undefined, {
                  onError: (error) => {
                    if (!isStillDrafting(error)) toastProblem(error)
                  },
                })
              }}
            >
              <RefreshCw aria-hidden="true" />
              {withEstimate(TRY_AGAIN)}
            </Button>
            <p id={hintId} className="text-caption text-muted-foreground">
              {redraftHint(form.cost_usd)}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  )
}
