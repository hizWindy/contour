/**
 * The review bar (PLAN-V9 C3): Results for one run (`/results?run_id=...`, the link in the run
 * email) becomes a review page. Tick leads, then:
 *
 * - **Approve and send to HubSpot:** each ticked lead is previewed and written once, with the write
 *   log. A lead that fails is named, with why; the others still go. While HubSpot writing is off
 *   (PLAN-V5 F1 to F3) the button is greyed out and says so.
 * - **Reject:** asks why (PLAN-V9 D1).
 * - **Watch.**
 *
 * The bar also says what the run found: its city, good leads, Watch and Drop, and the cost of each
 * good lead.
 */
import { Bookmark, Send, XCircle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useReview, useReviewSend, useReviewStatus, type ReviewResult } from '@/api/hooks'
import { Money } from '@/components/money'
import { PendingText } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import { formatNumber, pluralise } from '@/lib/format'
import { toastProblem } from '@/lib/problems'
import { RejectDialog } from '../reject-reasons'
import { PageTick, type Tick } from './company-cell'

/** One toast for a whole action: how many worked, and each lead that didn't, with why. */
function report(result: ReviewResult, done: string): void {
  const failed = result.items.filter((item) => !item.ok)
  const head =
    failed.length === 0
      ? `${pluralise(result.done, 'lead')} ${done}.`
      : `${pluralise(result.done, 'lead')} ${done}. ${pluralise(failed.length, 'lead')} failed.`
  if (failed.length === 0) {
    toast(head)
    return
  }
  toast.error(head, {
    description: failed
      .slice(0, 5)
      .map((item) => `${item.company ?? 'A lead'}: ${item.problem ?? 'it failed'}`)
      .join(' '),
    duration: 15_000,
  })
}

export function ReviewBar({
  runId,
  tick,
  onDone,
}: {
  runId: string
  /** The ticks: which leads are ticked, and the page's own ids for "tick the whole page". */
  tick: Tick
  /** Called with the ids that worked, so they can be unticked. */
  onDone: (ids: string[]) => void
}) {
  const selected = [...tick.selected]
  const review = useReview(runId)
  const status = useReviewStatus()
  const send = useReviewSend()
  const [rejecting, setRejecting] = useState(false)
  const busy = status.isPending || send.isPending
  const none = selected.length === 0
  const data = review.data
  const writeOff = data ? !data.hubspot_write_enabled : true

  const finished = (result: ReviewResult): void => {
    onDone(result.items.filter((item) => item.ok).map((item) => item.lead_id))
  }

  return (
    <section
      aria-label="Review this run's leads"
      className="flex flex-col gap-3 rounded-lg border bg-card p-4 text-ui"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-section font-semibold">Review this run&apos;s leads</h2>
        {review.error ? (
          <p className="text-muted-foreground">The run&apos;s numbers couldn&apos;t be loaded.</p>
        ) : data ? (
          <p className="text-muted-foreground">
            {data.cities.join(', ') || 'Lead Finder'}: {pluralise(data.good_leads, 'good lead')}{' '}
            (Pass or Director review), {formatNumber(data.watch)} Watch, {formatNumber(data.drop)}{' '}
            Drop. Cost <Money value={data.cost_usd} />
            {data.cost_per_good_lead_usd ? (
              <>
                , <Money value={data.cost_per_good_lead_usd} /> per good lead.
              </>
            ) : (
              '. No good leads yet.'
            )}
          </p>
        ) : (
          <PendingText className="w-72" />
        )}
        <p className="text-muted-foreground">
          Tick the leads, then approve them for HubSpot, reject them or watch them. Nothing goes to
          HubSpot until you approve it.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <span className="flex items-center gap-3">
          <PageTick tick={tick} />
          <span className="font-semibold tabular-nums" aria-live="polite">
            {none ? 'No lead ticked' : `${pluralise(selected.length, 'lead')} ticked`}
          </span>
        </span>
        <div
          role="group"
          aria-label="What to do with the ticked leads"
          className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center"
        >
          <Button
            type="button"
            disabled={none || busy || writeOff}
            aria-describedby={writeOff ? 'review-write-off' : undefined}
            onClick={() => {
              send.mutate([...selected], {
                onSuccess: (result) => {
                  report(result, 'sent to HubSpot')
                  finished(result)
                },
                onError: toastProblem,
              })
            }}
          >
            <Send aria-hidden="true" />
            {send.isPending ? 'Sending.' : 'Approve and send to HubSpot'}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={none || busy}
            onClick={() => {
              setRejecting(true)
            }}
          >
            <XCircle aria-hidden="true" />
            Reject
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={none || busy}
            onClick={() => {
              status.mutate(
                { lead_ids: [...selected], status: 'watching' },
                {
                  onSuccess: (result) => {
                    report(result, 'watched')
                    finished(result)
                  },
                  onError: toastProblem,
                },
              )
            }}
          >
            <Bookmark aria-hidden="true" />
            Watch
          </Button>
        </div>
      </div>
      {data && writeOff ? (
        <p id="review-write-off" className="text-caption text-muted-foreground">
          {data.hubspot_write_off ?? 'HubSpot writing is off'}. Sending waits for HubSpot write
          access. Reject and Watch still work.
        </p>
      ) : null}
      <RejectDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title={`Reject ${pluralise(selected.length, 'lead')}`}
        description="Pick why, so the rules can learn from it. The same reason goes on every ticked lead."
        pending={status.isPending}
        onReject={(reason, note) => {
          status.mutate(
            {
              lead_ids: [...selected],
              status: 'rejected',
              reject_reason: reason,
              reject_note: note,
            },
            {
              onSuccess: (result) => {
                setRejecting(false)
                report(result, 'rejected')
                finished(result)
              },
              onError: toastProblem,
            },
          )
        }}
      />
    </section>
  )
}
