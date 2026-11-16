/**
 * The pre-read's three summaries (PLAN-V17 "The screens", part 6): What they do, What we know
 * about the project, and The talks so far. The AI writes these three and nothing else (choice 11).
 * They are the form's third section (PLAN-V18 T2-5).
 *
 * - **Boxes the rep types into directly,** with no pencil step: each has its title as its label
 *   above it, and saves when it is left (a PATCH with that summary's text), only if it changed.
 *   "Saving." then "Saved." fade in under it. A failed save keeps the rep's words and says why,
 *   with Try again; one that fails after the rep has left the page says so in a toast.
 * - **Each says who wrote it:** "Written by AI" until the rep changes it, then "Edited by you",
 *   as soon as the words differ. The mark fades from one to the other (`FadeSwap`). Each shows
 *   its sources under it as call prep's chips (a fact's id, with where it came from in a tooltip).
 * - **The box follows the server** while the rep has nothing unsaved in it: a draft or a redraft
 *   writes the AI's words in, and a save shows what the server keeps. A summary the rep changed
 *   stays as it is through a redraft: the server keeps it.
 * - **Redraft** writes the three again, which costs money, so the button says what one draft
 *   costs by the plan's estimate, and the line beside it what the drafts have cost so far (the
 *   server adds them together, and keeps no cost for each one). While it drafts, each AI summary
 *   is a still grey block at its real size (the rep's own stay as they are, and can be typed
 *   into), and the page asks again every 2 seconds (`useMeetingForm`).
 * - **A failed draft** says what went wrong, with Try again, in the draft's steps at the top of the
 *   form (`draft-progress.tsx`, PLAN-V18 T2-4). The boxes stay, so the rep can write them by hand.
 */
import { Cpu, PenLine, RefreshCw } from 'lucide-react'
import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { toast } from 'sonner'
import { isStillDrafting, useEditMeetingForm, useRedraftMeetingForm } from '@/api/hooks/meetings'
import type { FormSummariesPatch, MeetingFormOut, SummaryBy } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { toastProblem } from '@/lib/problems'
import { SourceChip } from '../../source-chip'
import { FadeSwap } from './fade-swap'
import { FormSection } from './form-section'
import { SUMMARY_MAX_CHARS, SUMMARY_NAMES, type SummaryName } from './rules'
import type { SaveState } from './use-blank'
import {
  EDITED_BY_YOU,
  LEFT_EMPTY,
  leftNotSavedWords,
  NOTHING_FROM_AI,
  notSavedWords,
  REDRAFT,
  redraftHint,
  SUMMARIES_NOTE,
  SUMMARY_TITLES,
  THE_SUMMARIES,
  tooLongWords,
  withEstimate,
  WRITTEN_BY_AI,
} from './words'
import { SaveNote } from './your-part'

/** "Written by AI" or "Edited by you": an icon and a word, in quiet text. */
function SummaryMark({ by }: { by: SummaryBy }) {
  const Icon = by === 'ai' ? Cpu : PenLine
  return (
    <FadeSwap swapKey={by} className="inline-flex">
      <span
        data-slot="summary-mark"
        className="inline-flex items-center gap-1.5 text-caption text-muted-foreground"
      >
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        {by === 'ai' ? WRITTEN_BY_AI : EDITED_BY_YOU}
      </span>
    </FadeSwap>
  )
}

/** A summary being written: still grey lines, as tall as a box of three or four sentences. */
function SummaryPending() {
  return (
    <div
      aria-hidden="true"
      data-slot="summary-pending"
      className="flex flex-col gap-2 rounded-lg border px-3 py-2.5"
    >
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-5 w-11/12" />
      <Skeleton className="h-5 w-3/5" />
    </div>
  )
}

interface SummaryFieldProps {
  form: MeetingFormOut
  name: SummaryName
  /** Each save the server keeps, for the footer's "saved 2:14 pm". */
  onSaved: () => void
}

function SummaryField({ form, name, onSaved }: SummaryFieldProps) {
  const summary = form.summaries[name]
  const title = SUMMARY_TITLES[name]
  const id = useId()
  const noteId = useId()
  const edit = useEditMeetingForm(form.id)
  const [text, setText] = useState(summary.text)
  // What the server holds, as far as the box knows: the same words have nothing to save.
  const [held, setHeld] = useState(summary.text)
  const [state, setState] = useState<SaveState>('idle')
  const [problem, setProblem] = useState<string | null>(null)
  // Only the newest save's answer counts, as one left on its way may answer after it.
  const newest = useRef(0)
  // Still on screen: a save that fails after the rep left the page says so in a toast instead.
  const shownNow = useRef(true)
  useEffect(() => {
    shownNow.current = true
    return () => {
      shownNow.current = false
    }
  }, [])

  // The server's words changed (a draft wrote them): the box follows, unless the rep has words
  // in it that aren't saved yet. A save on its way sets both itself.
  if (summary.text !== held && state !== 'saving') {
    if (text === held) setText(summary.text)
    setHeld(summary.text)
  }

  const writing = form.status === 'drafting' && summary.by === 'ai'
  const changed = text.trim() !== held.trim()
  const by: SummaryBy = summary.by === 'person' || changed ? 'person' : 'ai'
  const tooLong = text.trim().length > SUMMARY_MAX_CHARS

  const save = (value: string): void => {
    if (value.trim().length > SUMMARY_MAX_CHARS) return
    setState('saving')
    setProblem(null)
    const patch: FormSummariesPatch = {}
    patch[name] = value
    newest.current += 1
    const mine = newest.current
    // Its promise answers even once the page is gone, which a callback given to `mutate` doesn't.
    void edit.mutateAsync({ patch: { summaries: patch } }).then(
      (answer) => {
        if (mine !== newest.current) return
        const kept = answer.summaries[name].text
        setHeld(kept)
        // Show what the server keeps (it tidies spaces), unless the rep has typed on since.
        setText((now) => (now === value ? kept : now))
        setState('saved')
        onSaved()
      },
      (error: unknown) => {
        if (mine !== newest.current) return
        if (!shownNow.current) {
          const words = leftNotSavedWords(title, form.meeting.company_name, error)
          toast.error(words.title, { description: words.description })
          return
        }
        setState('failed')
        setProblem(notSavedWords(error))
      },
    )
  }

  const commit = (): void => {
    if (!changed) {
      // Back to what the server has: nothing is waiting to be saved.
      if (state === 'failed') {
        setState('idle')
        setProblem(null)
      }
      return
    }
    save(text)
  }

  const wrong = tooLong || state === 'failed'
  return (
    <Field
      data-slot="summary"
      data-summary={name}
      data-invalid={wrong || undefined}
      className="gap-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <FieldLabel htmlFor={id} className="text-ui font-semibold text-foreground">
          {title}
        </FieldLabel>
        {/* Nothing written yet has no mark: the AI wrote nothing to own. */}
        {writing || (by === 'ai' && !text.trim()) ? null : <SummaryMark by={by} />}
      </div>
      {writing ? (
        <SummaryPending />
      ) : (
        <Textarea
          id={id}
          value={text}
          rows={3}
          placeholder={summary.by === 'ai' ? NOTHING_FROM_AI : LEFT_EMPTY}
          aria-invalid={wrong || undefined}
          aria-describedby={noteId}
          // Reading text: 16px, and an iPhone doesn't zoom in on focus.
          className="max-w-full text-body text-pretty"
          onChange={(event) => {
            setText(event.target.value)
            if (state === 'saved') setState('idle')
          }}
          onBlur={commit}
        />
      )}
      {summary.sources.length > 0 && !writing ? (
        <div data-slot="summary-sources" className="flex flex-wrap gap-1">
          {summary.sources.map((source) => (
            <SourceChip key={source.id} id={source.id} source={source} />
          ))}
        </div>
      ) : null}
      {writing ? null : (
        <SaveNote
          id={noteId}
          state={state}
          problem={problem}
          tooLong={tooLong ? tooLongWords(text.trim().length, SUMMARY_MAX_CHARS) : null}
          onRetry={() => {
            save(text)
          }}
        />
      )}
    </Field>
  )
}

/** Redraft, with what it costs, and the line that says the rep's edits stay. */
function RedraftRow({
  form,
  busy,
  onRedraft,
}: {
  form: MeetingFormOut
  busy: boolean
  onRedraft: () => void
}) {
  const hintId = useId()
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit touch:h-11"
        disabled={busy || form.status === 'drafting'}
        aria-describedby={hintId}
        onClick={onRedraft}
      >
        <RefreshCw aria-hidden="true" />
        {withEstimate(REDRAFT)}
      </Button>
      <p id={hintId} className="text-caption text-muted-foreground">
        {redraftHint(form.cost_usd)}
      </p>
    </div>
  )
}

/** Moves the focus to the section's title, for a button that is about to go or grey out. */
function focusTitle(title: RefObject<HTMLHeadingElement | null>): void {
  requestAnimationFrame(() => title.current?.focus())
}

export function SummariesSection({
  form,
  number,
  onSaved,
}: {
  form: MeetingFormOut
  /** The section's place in the form. */
  number: number
  onSaved: () => void
}) {
  const title = useRef<HTMLHeadingElement>(null)
  const redraft = useRedraftMeetingForm(form.id)
  const failed = form.status === 'failed'

  const startRedraft = (): void => {
    // The button greys out while it drafts: the focus stays in the section.
    focusTitle(title)
    redraft.mutate(undefined, {
      onError: (error) => {
        if (!isStillDrafting(error)) toastProblem(error)
      },
    })
  }

  return (
    <FormSection number={number} title={THE_SUMMARIES} note={SUMMARIES_NOTE} headingRef={title}>
      <div className="flex flex-col gap-5">
        {SUMMARY_NAMES.map((name) => (
          <SummaryField key={name} form={form} name={name} onSaved={onSaved} />
        ))}
      </div>
      {/* A failed draft's Try again is with its reason, in the draft's steps. */}
      {failed ? null : <RedraftRow form={form} busy={redraft.isPending} onRedraft={startRedraft} />}
    </FormSection>
  )
}
