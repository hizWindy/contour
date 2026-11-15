/**
 * The confirmation before the batch leaves Contour (DESIGN.md "A real confirmation"; PLAN-V17
 * T3-6): an Alert Dialog with the totals from the preview, "7 calls, 3 tasks, 2 field changes",
 * and one main button. The preview reads HubSpot again as the dialog opens, so a change whose
 * value moved since is counted as held. Nothing is written until the rep sends.
 *
 * It rises 8px as it fades in, and fades out in 150ms, as the company's dialog does.
 */
import { Send, TriangleAlert } from 'lucide-react'
import type { ApiProblem } from '@/api/client'
import type { CallNotePreview } from '@/api/v17'
import { ErrorState } from '@/components/error-state'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  CANCEL,
  heldWords,
  PREVIEW_FAILED,
  READING_HUBSPOT,
  SEND_DESCRIPTION,
  SEND_TO_HUBSPOT,
  sendTitle,
  totalsWords,
  waitingLine,
} from './words'

export interface SendDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** How many calls the rep is sending. */
  count: number
  preview: CallNotePreview | undefined
  loading: boolean
  error: ApiProblem | null
  onRetry: () => void
  onSend: () => void
}

export function SendDialog({
  open,
  onOpenChange,
  count,
  preview,
  loading,
  error,
  onRetry,
  onSend,
}: SendDialogProps) {
  const held = preview
    ? preview.items.flatMap((note) => note.changes).filter((change) => change.current_changed)
        .length
    : 0
  const ready = preview?.sending_ready === true && !loading
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="data-open:slide-in-from-bottom-2">
        <AlertDialogHeader>
          <AlertDialogTitle>{sendTitle(count)}</AlertDialogTitle>
          <AlertDialogDescription>{SEND_DESCRIPTION}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <ErrorState error={error} context={PREVIEW_FAILED} onRetry={onRetry} />
        ) : loading || !preview ? (
          // As tall as the totals that take its place, so the dialog doesn't jump.
          <p role="status" className="text-body text-muted-foreground">
            {READING_HUBSPOT}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <p data-slot="send-totals" className="text-body font-semibold text-foreground">
              {totalsWords(preview.totals)}
            </p>
            {held > 0 ? (
              <p className="flex items-start gap-2 text-ui text-review-ink">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {heldWords(held)}
              </p>
            ) : null}
            {preview.sending_ready ? null : (
              <p role="status" className="text-ui text-muted-foreground">
                {waitingLine(preview.waiting_for)}
              </p>
            )}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{CANCEL}</AlertDialogCancel>
          <Button type="button" disabled={!ready} onClick={onSend}>
            <Send aria-hidden="true" />
            {SEND_TO_HUBSPOT}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
