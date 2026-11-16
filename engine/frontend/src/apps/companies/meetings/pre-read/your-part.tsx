/**
 * The rep's part of the pre-read (PLAN-V17 "The screens", part 6), and the form's footer
 * (PLAN-V18 T2-5).
 *
 * - **Two required blanks,** "Ideal next step" and "Who is going", each with its label above and a
 *   star, which a screen reader hears as "required" (`aria-required`). The AI never fills them (Levi asked for blanks), so
 *   they start empty. Each saves when it is left (`use-blank.ts`): "Saved." fades in under it, and
 *   a failed save keeps the words and says why, with Try again.
 * - **The footer** stays at the bottom of the form while it scrolls: the status on the left
 *   ("Draft ready, saved 2:14 pm"), with the reason under it while "Check and send" can't be
 *   pressed, and "Check and send", the page's one Navy button, on the right. It opens the send
 *   dialog (`send-dialog.tsx`, T3-11). While the pre-read is sent and unchanged the footer isn't
 *   there: the page says who got it. An edit makes it a draft again, and the footer comes back. On a
 *   phone the footer is fixed at the bottom of the screen, above the safe area, where a thumb
 *   reaches it.
 */
import { Send } from 'lucide-react'
import { useId, type Ref } from 'react'
import type { MeetingFormOut } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { STATUS_LOOK } from '../status-look'
import { STATUS_WORDS } from '../words'
import type { SendBlock } from './rules'
import type { Blank, SaveState } from './use-blank'
import {
  CHECK_AND_SEND,
  formStatusWords,
  SAVED,
  SAVING,
  SEND_REASONS,
  tooLongWords,
  TRY_AGAIN,
} from './words'

/**
 * The line under a field that saves when it is left: what went wrong with Try again, too long,
 * saving, or saved. A new word fades in (150ms). It keeps its height, so nothing under it moves.
 */
export function SaveNote({
  id,
  state,
  problem,
  tooLong,
  onRetry,
}: {
  id: string
  state: SaveState
  problem: string | null
  /** "Too long: 1,050 of 1,000 characters.", or null. */
  tooLong: string | null
  onRetry: () => void
}) {
  if (state === 'failed' && problem) {
    // The field's description is the words only, never the button beside them.
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p id={id} role="alert" className="text-caption text-destructive-ink">
          {problem}
        </p>
        <Button type="button" variant="outline" size="sm" className="touch:h-11" onClick={onRetry}>
          {TRY_AGAIN}
        </Button>
      </div>
    )
  }
  if (tooLong) {
    return (
      <p id={id} className="text-caption text-destructive-ink tabular-nums">
        {tooLong}
      </p>
    )
  }
  const words = state === 'saving' ? SAVING : state === 'saved' ? SAVED : null
  return (
    <p id={id} role="status" className="min-h-5 text-caption text-muted-foreground">
      {words ? (
        <span key={words} className="animate-in duration-150 fade-in-0">
          {words}
        </span>
      ) : null}
    </p>
  )
}

export function BlankField({
  label,
  placeholder,
  blank,
  max,
  ref,
}: {
  label: string
  placeholder: string
  blank: Blank
  /** The most it may hold. */
  max: number
  ref?: Ref<HTMLTextAreaElement>
}) {
  const id = useId()
  const noteId = useId()
  const wrong = blank.tooLong || blank.state === 'failed'
  return (
    <Field data-invalid={wrong || undefined} className="gap-2">
      <FieldLabel htmlFor={id} className="gap-1 text-ui font-semibold text-foreground">
        {label}
        <span aria-hidden="true" data-slot="required-star" className="text-foreground">
          *
        </span>
      </FieldLabel>
      <Textarea
        ref={ref}
        id={id}
        value={blank.text}
        rows={2}
        placeholder={placeholder}
        aria-required="true"
        aria-invalid={wrong || undefined}
        aria-describedby={noteId}
        // 16px text, so it reads like the summaries, and an iPhone doesn't zoom in on focus.
        className="text-body"
        onChange={(event) => {
          blank.change(event.target.value)
        }}
        onBlur={blank.commit}
      />
      <SaveNote
        id={noteId}
        state={blank.state}
        problem={blank.problem}
        tooLong={blank.tooLong ? tooLongWords(blank.text.trim().length, max) : null}
        onRetry={blank.retry}
      />
    </Field>
  )
}

export interface FormFooterProps {
  form: MeetingFormOut
  /** Why "Check and send" can't be pressed yet, or null. */
  block: SendBlock | null
  /** When the form was last saved on this visit, or null. */
  savedAt: string | null
  onPhone: boolean
  /** The room the page keeps above the footer, so a field the keyboard lands on isn't under it. */
  barRoom: Ref<HTMLElement>
  onCheckAndSend: () => void
}

export function FormFooter({
  form,
  block,
  savedAt,
  onPhone,
  barRoom,
  onCheckAndSend,
}: FormFooterProps) {
  const reasonId = useId()
  const reason = block ? SEND_REASONS[block] : null
  const { icon: StatusIcon, ink: statusInk } = STATUS_LOOK[form.status]
  // Sent and unchanged: nothing to send, and the page says who got it. An edit makes it a draft
  // again, and the footer comes back.
  if (form.status === 'sent') return null
  return (
    <footer
      ref={barRoom}
      data-slot="send-bar"
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t bg-card',
        onPhone
          ? 'fixed inset-x-0 bottom-0 z-20 flex-col items-stretch p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]'
          : 'sticky bottom-0 z-10 rounded-b-lg px-6 py-3',
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p data-slot="form-status" className="flex items-center gap-1.5 text-ui text-foreground">
          {/* An icon and a word, as everywhere the status shows. */}
          <StatusIcon aria-hidden="true" className={cn('size-4 shrink-0', statusInk)} />
          {formStatusWords(STATUS_WORDS[form.status], savedAt)}
        </p>
        {reason ? (
          <p id={reasonId} className="text-caption text-pretty text-muted-foreground">
            {reason}
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        size={onPhone ? 'lg' : 'default'}
        className={onPhone ? 'w-full' : undefined}
        disabled={block !== null}
        aria-describedby={reason ? reasonId : undefined}
        onClick={onCheckAndSend}
      >
        <Send aria-hidden="true" />
        {CHECK_AND_SEND}
      </Button>
    </footer>
  )
}
