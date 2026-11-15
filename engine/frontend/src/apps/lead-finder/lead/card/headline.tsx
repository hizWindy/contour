/**
 * The top of the lead card for PLAN-V16 (T3-4):
 *
 * - `ExclusionNotice`: an excluded lead says why first (Levi's section 3), with its evidence and
 *   page, and an Override that asks once, then judges the lead again without the exclusion. That is
 *   free and the backend records who did it. An overridden exclusion stays as one quiet line.
 * - `TierHeadline`: "A · 82 · Medium" (tier, score, confidence), what changed since the last
 *   research ("Up from B to A: ..."), how many points the dampeners took off, and the flag
 *   "Verify before outreach" for a Tier A lead with low confidence.
 *
 * Every text came from the research or the backend, so it is shown as plain text, and the link
 * goes through `SourceLink`.
 */
import { ShieldOff, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { useOverrideExclusion } from '@/api/hooks'
import type { LeadDetail } from '@/api/types'
import { SourceLink } from '@/components/source-link'
import { TierLine } from '@/components/tier-mark'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { formatDate, pluralise } from '@/lib/format'
import { isTier, TIER_ACTIONS, TIER_LABELS } from '@/lib/labels'
import { toastProblem } from '@/lib/problems'
import { activeExclusion, CHANGE_MARKS, needsVerifying } from './v16-words'

export function ExclusionNotice({ lead }: { lead: LeadDetail }) {
  const override = useOverrideExclusion()
  const excluded = lead.excluded
  if (!excluded) {
    return null
  }
  if (!activeExclusion(lead)) {
    return (
      <p className="text-ui text-muted-foreground">
        Exclusion overridden by {excluded.overridden_by}
        {excluded.overridden_at ? ` on ${formatDate(excluded.overridden_at)}` : ''}. It was:{' '}
        {excluded.label}.
      </p>
    )
  }
  return (
    <div
      data-slot="exclusion"
      className="flex flex-col gap-2 rounded-md border border-input px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-2">
        <ShieldOff aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-ui">
            <span className="font-semibold">Left out: </span>
            {excluded.label}
          </p>
          <p className="max-w-prose text-ui text-muted-foreground">{excluded.evidence}</p>
          {excluded.url ? <SourceLink href={excluded.url} /> : null}
        </div>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="shrink-0"
            disabled={override.isPending}
          >
            {override.isPending ? 'Judging again.' : 'Override'}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Override the exclusion?</AlertDialogTitle>
            <AlertDialogDescription>
              {`The rules judge ${lead.company} again without the exclusion (${excluded.label}). It is free: nothing goes to Claude. Your name is saved with the change, and it can't be undone here.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                override.mutate(lead.id, {
                  onSuccess: (judged) => {
                    toast(
                      isTier(judged.tier)
                        ? `${judged.company} judged again: Tier ${TIER_LABELS[judged.tier]}, score ${String(judged.score)}.`
                        : `${judged.company} judged again: score ${String(judged.score)}.`,
                    )
                  },
                  onError: toastProblem,
                })
              }}
            >
              Override and judge again
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export function TierHeadline({ lead }: { lead: LeadDetail }) {
  const change = lead.what_changed
  const mark = change ? CHANGE_MARKS[change.kind] : null
  const ChangeIcon = mark?.icon
  const deducted = (lead.score_before_dampeners ?? lead.score) - lead.score
  return (
    <div data-slot="tier-headline" className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <TierLine
          tier={lead.tier}
          score={lead.score}
          confidence={lead.confidence}
          className="text-title"
        />
        {isTier(lead.tier) ? (
          <span className="text-ui text-muted-foreground">{TIER_ACTIONS[lead.tier]}</span>
        ) : null}
      </div>
      {change && mark && ChangeIcon ? (
        <p className="flex items-start gap-2 text-ui">
          <ChangeIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="sr-only">What changed: {mark.word}. </span>
          <span className="max-w-prose">{change.text}</span>
        </p>
      ) : null}
      <p className="max-w-prose text-caption text-muted-foreground">
        {lead.confidence_why}
        {deducted > 0
          ? ` Dampeners took off ${pluralise(deducted, 'point')} (${String(lead.score_before_dampeners)} before).`
          : ''}
      </p>
      {needsVerifying(lead) ? (
        <p
          role="status"
          className="flex max-w-prose items-start gap-2 rounded-md border border-review bg-review-soft px-3 py-2 text-ui text-review-ink"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="font-semibold">Verify before outreach.</span> A Tier A lead with low
            confidence: check its key facts by hand first.
          </span>
        </p>
      ) : null}
    </div>
  )
}
