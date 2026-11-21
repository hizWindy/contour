/**
 * The confirmation before the batch leaves Contour (DESIGN.md "A real confirmation"; PLAN-V17
 * T3-6): an Alert Dialog with the totals from the preview, "7 calls, 3 tasks, 2 field changes",
 * and one main button. The preview reads HubSpot again as the dialog opens, so a change whose
 * value moved since is counted as held. Nothing is written until the rep sends.
 *
 * - **The title counts only what will go,** each kind by its name: "Send 2 calls and 1 meeting
 *   note to HubSpot?" (a logged meeting goes as a note, not a call). Until the preview answers it
 *   counts the cards being sent; then the server's totals, which leave out what it won't send.
 * - A call the server won't send (`skipped`, T3-11), like one whose change isn't on the list a call
 *   may change, is named here with why, in the server's words, before anything goes. The totals
 *   are the server's, without it. With none left to send, Send is greyed, with why.
 * - The calls that still need a company (PLAN-V24 T3-3) are never in a send: one line says how
 *   many, and that they stay in Call logs. It shows from the start, so the dialog doesn't grow
 *   when the preview answers.
 *
 * It rises 8px as it fades in, and fades out in 150ms, as the company's dialog does. As it closes,
 * the page puts the focus back (`focusBack`): it has no trigger of its own, so Esc left the focus
 * on the page's body (the PLAN-V24 browser check).
 */
import { Send, TriangleAlert } from 'lucide-react'
import { useId } from 'react'
import type { ApiProblem } from '@/api/client'
import type { CallNotePreview } from '@/api/types'
import { sendCounts, type SendCounts } from './notes'
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
  needsCompanySendWords,
  NOTHING_TO_SEND,
  notSentHead,
  PREVIEW_FAILED,
  READING_HUBSPOT,
  SEND_DESCRIPTION,
  SEND_TO_HUBSPOT,
  sendTitle,
  totalsWords,
  waitingLine,
} from './words'

/** A call the server won't send, by its company, with why. */
export interface SkippedCall {
  id: string
  /** The company the call was with, from the cards on screen, or null if it isn't there. */
  name: string | null
  /** A logged meeting's notes, not a call (from the card on screen). */
  meeting: boolean
  why: string
}

export interface SendDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The calls and meeting notes among the cards the rep is sending, until the preview answers. */
  cards: Pick<SendCounts, 'calls' | 'meetingNotes'>
  preview: CallNotePreview | undefined
  /** The calls the preview says won't be sent, with why. */
  skipped: readonly SkippedCall[]
  loading: boolean
  error: ApiProblem | null
  onRetry: () => void
  onSend: () => void
  /** How many of the rep's calls still need a company, and so stay out of the send. */
  needsCompany?: number
  /**
   * Where the focus goes as the dialog closes (the PLAN-V24 browser check): the page puts it back
   * on what opened the dialog, or the next sensible place, and says true. Left out, or false: the
   * dialog's own way, which, with no trigger of its own, left it on the page's body.
   */
  focusBack?: () => boolean
}

export function SendDialog({
  open,
  onOpenChange,
  cards,
  preview,
  skipped,
  loading,
  error,
  onRetry,
  onSend,
  needsCompany = 0,
  focusBack,
}: SendDialogProps) {
  const reasonId = useId()
  const held = preview
    ? preview.items.flatMap((note) => note.changes).filter((change) => change.current_changed)
        .length
    : 0
  // Every call left out: there is nothing to send.
  const nothing = preview !== undefined && preview.items.length === 0 && skipped.length > 0
  const ready = preview?.sending_ready === true && !loading && !nothing
  // What will go: the server's count once the preview is here, the cards' until then.
  const counts = preview && !loading ? sendCounts(preview) : null
  const going = counts ?? cards
  const skippedMeetings = skipped.filter((call) => call.meeting).length
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        className="data-open:slide-in-from-bottom-2"
        onCloseAutoFocus={(event) => {
          if (focusBack?.()) event.preventDefault()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{sendTitle(going.calls, going.meetingNotes)}</AlertDialogTitle>
          <AlertDialogDescription>{SEND_DESCRIPTION}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <ErrorState error={error} context={PREVIEW_FAILED} onRetry={onRetry} />
        ) : !counts || !preview ? (
          // As tall as the totals that take its place, so the dialog doesn't jump.
          <p role="status" className="text-body text-muted-foreground">
            {READING_HUBSPOT}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Nothing will go: no totals of nothing, the line under the list says why. */}
            {nothing ? null : (
              <p data-slot="send-totals" className="text-body font-semibold text-foreground">
                {totalsWords(counts)}
              </p>
            )}
            {held > 0 ? (
              <p className="flex items-start gap-2 text-ui text-review-ink">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {heldWords(held)}
              </p>
            ) : null}
            {skipped.length > 0 ? (
              <div data-slot="send-skipped" className="flex flex-col gap-1.5 text-ui">
                <p className="flex items-start gap-2 text-review-ink">
                  <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  {notSentHead(skipped.length - skippedMeetings, skippedMeetings)}
                </p>
                <ul className="flex flex-col gap-1 pl-6 text-foreground">
                  {skipped.map((call) => (
                    <li key={call.id} className="break-words">
                      {call.name ? <span className="font-semibold">{call.name}: </span> : null}
                      {call.why}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {preview.sending_ready ? null : (
              <p role="status" className="text-ui text-muted-foreground">
                {waitingLine(preview.waiting_for)}
              </p>
            )}
            {nothing ? (
              <p id={reasonId} className="text-ui text-muted-foreground">
                {NOTHING_TO_SEND}
              </p>
            ) : null}
          </div>
        )}
        {needsCompany > 0 ? (
          <p
            data-slot="send-needs-company"
            className="flex items-start gap-2 text-ui text-review-ink"
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {needsCompanySendWords(needsCompany)}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{CANCEL}</AlertDialogCancel>
          <Button
            type="button"
            disabled={!ready}
            aria-describedby={nothing ? reasonId : undefined}
            onClick={onSend}
          >
            <Send aria-hidden="true" />
            {SEND_TO_HUBSPOT}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
