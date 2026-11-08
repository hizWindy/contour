/**
 * The lead card's actions, in the quick view: Watch, Reject (with a reason), Send to HubSpot and
 * Re-check, then the thumbs (Useful, Not useful).
 *
 * Watch, Reject and the thumbs change the lead, and each shows a toast with Undo, which sends back
 * the exact values from before. Reject asks for a reason from a fixed list (PLAN-V9 D1). Re-check costs money, so it asks first and has no Undo. Send to
 * HubSpot previews first and writes once only (send-lead.tsx).
 */
import { Bookmark, BookmarkCheck, RefreshCw, ThumbsDown, ThumbsUp, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { usePatchLead, useRecheckLead } from '@/api/hooks'
import type { LeadDetail, LeadPatch } from '@/api/types'
import { Money } from '@/components/money'
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
import { toastProblem } from '@/lib/problems'
import { RejectDialog } from '../../reject-reasons'
import { SendLead } from '../send-lead'

/** The values a change touches, as they were before it, for Undo. */
function before(lead: LeadDetail, patch: LeadPatch): LeadPatch {
  const previous: LeadPatch = {}
  if ('status' in patch) previous.status = lead.status === 'sent' ? 'new' : lead.status
  if ('status' in patch || 'reject_reason' in patch) {
    previous.reject_reason = lead.reject_reason
    previous.reject_note = lead.reject_note
  }
  if ('useful' in patch) previous.useful = lead.useful
  if ('note' in patch) previous.note = lead.note
  return previous
}

export function Actions({ lead }: { lead: LeadDetail }) {
  const navigate = useNavigate()
  const patchLead = usePatchLead()
  const recheck = useRecheckLead()
  const [rejecting, setRejecting] = useState(false)

  const change = (patch: LeadPatch, done: string, onDone?: () => void): void => {
    const undo = before(lead, patch)
    patchLead.mutate(
      { leadId: lead.id, patch },
      {
        onSuccess: () => {
          onDone?.()
          toast(done, {
            action: {
              label: 'Undo',
              onClick: () => {
                patchLead.mutate({ leadId: lead.id, patch: undo }, { onError: toastProblem })
              },
            },
          })
        },
        onError: toastProblem,
      },
    )
  }

  const watching = lead.status === 'watching'
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div
        // A phone gets a tidy two-column grid of equal buttons; wider screens keep one row.
        className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center max-sm:[&>button]:w-full"
        role="group"
        aria-label="Actions"
      >
        <Button
          type="button"
          variant="outline"
          disabled={patchLead.isPending || lead.status === 'sent'}
          onClick={() => {
            change(
              { status: watching ? 'new' : 'watching' },
              watching ? 'Not watching any more.' : 'Watching.',
            )
          }}
        >
          {watching ? <BookmarkCheck aria-hidden="true" /> : <Bookmark aria-hidden="true" />}
          {watching ? 'Stop watching' : 'Watch'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={patchLead.isPending || lead.status === 'rejected' || lead.status === 'sent'}
          onClick={() => {
            setRejecting(true)
          }}
        >
          <XCircle aria-hidden="true" />
          Reject
        </Button>
        <span className="inline-flex flex-col gap-2 max-sm:[&>button]:w-full sm:flex-row sm:items-center">
          <SendLead lead={lead} />
        </span>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="outline" disabled={recheck.isPending}>
              <RefreshCw aria-hidden="true" />
              Re-check
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Research {lead.company} again?</AlertDialogTitle>
              <AlertDialogDescription>
                This searches the web again, even where memory is fresh. It costs money: up to the
                company cap, last time <Money value={lead.research.cost_usd} />. It can&apos;t be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  recheck.mutate(lead.id, {
                    onSuccess: (run) => {
                      void navigate(`/runs/${run.id}`)
                    },
                    onError: toastProblem,
                  })
                }}
              >
                Research again
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <div className="flex items-center gap-1" role="group" aria-label="Was this lead useful?">
        <Button
          type="button"
          size="sm"
          variant={lead.useful === true ? 'secondary' : 'ghost'}
          aria-pressed={lead.useful === true}
          disabled={patchLead.isPending}
          onClick={() => {
            change({ useful: lead.useful === true ? null : true }, 'Thanks. Marked as useful.')
          }}
        >
          <ThumbsUp aria-hidden="true" />
          Useful
        </Button>
        <Button
          type="button"
          size="sm"
          variant={lead.useful === false ? 'secondary' : 'ghost'}
          aria-pressed={lead.useful === false}
          disabled={patchLead.isPending}
          onClick={() => {
            change(
              { useful: lead.useful === false ? null : false },
              'Thanks. Marked as not useful.',
            )
          }}
        >
          <ThumbsDown aria-hidden="true" />
          Not useful
        </Button>
      </div>

      <RejectDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title={`Reject ${lead.company}`}
        pending={patchLead.isPending}
        onReject={(reason, note) => {
          change(
            { status: 'rejected', reject_reason: reason, reject_note: note },
            'Rejected.',
            () => {
              setRejecting(false)
            },
          )
        }}
      />
    </div>
  )
}
