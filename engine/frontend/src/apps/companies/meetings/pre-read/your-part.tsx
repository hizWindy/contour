/**
 * The rep's part of the pre-read (PLAN-V17 "The screens", part 6): two blanks with clear labels,
 * "Ideal next step" and "Who is going". The AI never fills them (Levi asked for blanks), so they
 * start empty.
 *
 * - **Each saves when it is left** (a PATCH with `next_step` or `going`), and only if it changed,
 *   so leaving a sent pre-read untouched never makes it a draft again (the server does that on a
 *   change). After a save the field shows what the server keeps, unless the rep has typed on.
 * - **A failed save keeps the text**, says why and "Not saved yet. Try again.", with Try again.
 * - **"Check and send"** is the page's one Navy button. It stays greyed until both blanks are
 *   filled, with the reason beside it in plain words (`sendBlock`), and while the summaries are
 *   written or after a draft failed, since the server sends only a written pre-read. On a phone
 *   it sits at the bottom of the screen, where a thumb reaches it. It opens the send dialog
 *   (`send-dialog.tsx`, T3-11). While the pre-read is sent and unchanged it isn't offered: the
 *   page says who got it. An edit makes it a draft again, and the button comes back.
 *
 * The blanks are the rep's own while the page is open: a new answer from the server (the page
 * asks every 2 seconds while the summaries are written) doesn't touch them.
 */
import { Send } from 'lucide-react'
import { useId, useState } from 'react'
import type { ApiProblem } from '@/api/client'
import { useEditMeetingForm } from '@/api/hooks/meetings'
import type { MeetingFormOut, MeetingFormPatch } from '@/api/v17'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { PHONE, useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { BLANK_MAX_CHARS, sendBlock } from './rules'
import {
  CHECK_AND_SEND,
  GOING,
  GOING_PLACEHOLDER,
  NEXT_STEP,
  NEXT_STEP_PLACEHOLDER,
  notSavedWords,
  SAVED,
  SAVING,
  SEND_REASONS,
  tooLongWords,
  TRY_AGAIN,
  YOUR_PART,
  YOUR_PART_NOTE,
} from './words'

type BlankName = 'next_step' | 'going'
type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

interface Blank {
  text: string
  change: (text: string) => void
  state: SaveState
  /** Why the last save didn't go, in plain words. */
  problem: string | null
  tooLong: boolean
  /** The field was left: save it if it changed. */
  commit: () => void
  /** Save it again after a failure. */
  retry: () => void
}

/** One blank: the text as the rep sees it, and its save to the server. */
function useBlank(form: MeetingFormOut, name: BlankName): Blank {
  const edit = useEditMeetingForm(form.id)
  const [text, setText] = useState(form[name] ?? '')
  // What the server holds, as far as the page knows: a field the same as it has nothing to save.
  const [saved, setSaved] = useState(form[name] ?? '')
  const [state, setState] = useState<SaveState>('idle')
  const [problem, setProblem] = useState<string | null>(null)
  const tooLong = text.trim().length > BLANK_MAX_CHARS

  const save = (value: string): void => {
    const next = value.trim()
    if (next.length > BLANK_MAX_CHARS) return
    setState('saving')
    setProblem(null)
    const patch: MeetingFormPatch = {}
    patch[name] = next
    edit.mutate(
      { patch },
      {
        onSuccess: (answer) => {
          const kept = answer[name] ?? ''
          setSaved(kept)
          // Show what the server keeps (it tidies spaces), unless the rep has typed on since.
          setText((now) => (now === value ? kept : now))
          setState('saved')
        },
        onError: (error: ApiProblem) => {
          setState('failed')
          setProblem(notSavedWords(error))
        },
      },
    )
  }

  return {
    text,
    change: (next) => {
      setText(next)
      if (state === 'saved') setState('idle')
    },
    state,
    problem,
    tooLong,
    commit: () => {
      if (text.trim() === saved.trim()) {
        // Back to what the server has: nothing is waiting to be saved.
        if (state === 'failed') {
          setState('idle')
          setProblem(null)
        }
        return
      }
      save(text)
    },
    retry: () => {
      save(text)
    },
  }
}

/** The line under a blank: what went wrong with Try again, too long, saving, or saved. */
function BlankNote({ id, blank }: { id: string; blank: Blank }) {
  if (blank.state === 'failed' && blank.problem) {
    // The field's description is the words only, never the button beside them.
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p id={id} role="alert" className="text-caption text-destructive-ink">
          {blank.problem}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="touch:h-11"
          onClick={blank.retry}
        >
          {TRY_AGAIN}
        </Button>
      </div>
    )
  }
  if (blank.tooLong) {
    return (
      <p id={id} className="text-caption text-destructive-ink tabular-nums">
        {tooLongWords(blank.text.trim().length, BLANK_MAX_CHARS)}
      </p>
    )
  }
  return (
    <p id={id} role="status" className="min-h-5 text-caption text-muted-foreground">
      {blank.state === 'saving' ? SAVING : blank.state === 'saved' ? SAVED : null}
    </p>
  )
}

function BlankField({
  label,
  placeholder,
  blank,
}: {
  label: string
  placeholder: string
  blank: Blank
}) {
  const id = useId()
  const noteId = useId()
  const wrong = blank.tooLong || blank.state === 'failed'
  return (
    <Field data-invalid={wrong || undefined} className="gap-2">
      <FieldLabel htmlFor={id} className="text-ui font-semibold text-foreground">
        {label}
      </FieldLabel>
      <Textarea
        id={id}
        value={blank.text}
        rows={2}
        placeholder={placeholder}
        aria-invalid={wrong || undefined}
        aria-describedby={noteId}
        // 16px text on a touch screen, so an iPhone doesn't zoom in on focus.
        className="text-body touch:text-body"
        onChange={(event) => {
          blank.change(event.target.value)
        }}
        onBlur={blank.commit}
      />
      <BlankNote id={noteId} blank={blank} />
    </Field>
  )
}

export function YourPart({
  form,
  onCheckAndSend,
}: {
  form: MeetingFormOut
  /** Opens the send dialog (T3-11). */
  onCheckAndSend: () => void
}) {
  const headingId = useId()
  const reasonId = useId()
  const onPhone = useMediaQuery(PHONE)
  const nextStep = useBlank(form, 'next_step')
  const going = useBlank(form, 'going')
  const block = sendBlock({
    status: form.status,
    nextStep: nextStep.text,
    going: going.text,
    unsaved: nextStep.state === 'failed' || going.state === 'failed',
  })
  const reason = block ? SEND_REASONS[block] : null

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id={headingId} className="text-section font-semibold text-foreground">
          {YOUR_PART}
        </h2>
        <p className="text-caption text-muted-foreground">{YOUR_PART_NOTE}</p>
      </div>
      <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
        <BlankField label={NEXT_STEP} placeholder={NEXT_STEP_PLACEHOLDER} blank={nextStep} />
        <BlankField label={GOING} placeholder={GOING_PLACEHOLDER} blank={going} />
      </div>
      {/* Sent and unchanged: nothing to send. An edit makes it a draft, and this comes back. */}
      {form.status === 'sent' ? null : (
        <div
          data-slot="send-bar"
          className={cn(
            'flex flex-wrap items-center justify-end gap-x-4 gap-y-2',
            onPhone &&
              'fixed inset-x-0 bottom-0 z-20 flex-col items-stretch border-t bg-popover p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
          )}
        >
          {reason ? (
            <p id={reasonId} className="min-w-0 flex-1 text-ui text-pretty text-muted-foreground">
              {reason}
            </p>
          ) : null}
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
        </div>
      )}
    </section>
  )
}
