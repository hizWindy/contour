/**
 * The pre-read's three summaries (PLAN-V17 "The screens", part 6): What they do, What we know
 * about the project, and The talks so far. The AI writes these three and nothing else (choice 11).
 *
 * - **Each says who wrote it:** "Written by AI", or "Edited by you" once the rep has changed it.
 *   The mark fades from one to the other (`FadeSwap`). Each shows its sources as call prep's chips
 *   (a fact's id, with where it came from in a tooltip).
 * - **The pencil** (the line editor's, `line-box.tsx`) turns a summary into a text box. Save
 *   shows the new words and "Edited by you" at once, then tells the server (a PATCH with that
 *   summary's text). If the server says no, the summary goes back, and the box opens again with
 *   the rep's words and why. A summary the rep changed stays as it is through a redraft: the
 *   server keeps it.
 * - **Redraft** writes the three again, which costs money, so the button says what one draft
 *   costs by the plan's estimate, and the line beside it what the drafts have cost so far (the
 *   server adds them together, and keeps no cost for each one). While it drafts, each AI summary
 *   is a still grey block at its real size (the rep's own stay as they are), and the page asks
 *   again every 2 seconds (`useMeetingForm`).
 * - **A failed draft** says what went wrong in the server's plain words, with Try again (the
 *   redraft). Summaries an earlier draft wrote stay under it.
 */
import { Cpu, Hourglass, PenLine, RefreshCw, TriangleAlert } from 'lucide-react'
import { useId, useRef, useState, type RefObject } from 'react'
import { isStillDrafting, useEditMeetingForm, useRedraftMeetingForm } from '@/api/hooks/meetings'
import type { FormSummariesPatch, MeetingFormOut, SummaryBy } from '@/api/v17'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toastProblem } from '@/lib/problems'
import { SourceChip } from '../../source-chip'
import { EditPencil, LineTextBox } from '../../line-box'
import { FadeSwap } from './fade-swap'
import {
  hasSummaries,
  SUMMARY_MAX_CHARS,
  SUMMARY_NAMES,
  withSummary,
  type SummaryName,
} from './rules'
import {
  EDITED_BY_YOU,
  FAILED_FALLBACK,
  FAILED_TITLE,
  LEFT_EMPTY,
  NOTHING_FROM_AI,
  notSavedWords,
  REDRAFT,
  redraftHint,
  SUMMARIES,
  SUMMARY_HINT,
  SUMMARY_TITLES,
  TRY_AGAIN,
  withEstimate,
  WRITING,
  WRITTEN_BY_AI,
} from './words'

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

/** A summary being written: still grey lines, as tall as a summary of three or four sentences. */
function SummaryPending() {
  return (
    <div
      aria-hidden="true"
      data-slot="summary-pending"
      className="flex max-w-prose flex-col gap-2 py-0.5"
    >
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-5 w-11/12" />
      <Skeleton className="h-5 w-3/5" />
    </div>
  )
}

interface SummaryBlockProps {
  form: MeetingFormOut
  name: SummaryName
}

function SummaryBlock({ form, name }: SummaryBlockProps) {
  const summary = form.summaries[name]
  const title = SUMMARY_TITLES[name]
  const titleId = useId()
  const edit = useEditMeetingForm(form.id)
  const pencil = useRef<HTMLButtonElement>(null)
  const [editing, setEditing] = useState(false)
  // A save the server refused: the rep's words, to open the box with again, and why.
  const [kept, setKept] = useState<{ text: string; problem: string } | null>(null)
  const writing = form.status === 'drafting' && summary.by === 'ai'
  const text = summary.text.trim()

  const close = (): void => {
    setEditing(false)
    setKept(null)
    // Back to the pencil, so the keyboard carries on from the summary.
    requestAnimationFrame(() => pencil.current?.focus())
  }

  const save = (next: string): void => {
    if (next === text) {
      close()
      return
    }
    // It answers at once: the new words and "Edited by you" show while the server is told.
    close()
    const patch: FormSummariesPatch = {}
    patch[name] = next
    edit.mutate(
      { patch: { summaries: patch }, apply: (current) => withSummary(current, name, next) },
      {
        onError: (error) => {
          setKept({ text: next, problem: notSavedWords(error) })
          setEditing(true)
        },
      },
    )
  }

  let body
  if (writing) {
    body = <SummaryPending />
  } else if (editing) {
    body = (
      <LineTextBox
        initial={kept?.text ?? summary.text}
        label={title}
        maxChars={SUMMARY_MAX_CHARS}
        hint={SUMMARY_HINT}
        rows={4}
        // The page's one Navy button is "Check and send": an open box's Save stays quiet.
        quietSave
        problem={kept?.problem ?? null}
        onCancel={close}
        onSubmit={save}
      />
    )
  } else {
    body = (
      <div className="flex min-w-0 items-start gap-1">
        <div className="min-w-0 flex-1 animate-in duration-150 fade-in-0">
          {text ? (
            <p className="max-w-prose text-body text-pretty text-foreground">
              {summary.text}
              {summary.sources.length > 0 ? (
                <>
                  {' '}
                  <span className="inline-flex flex-wrap gap-1 align-middle">
                    {summary.sources.map((source) => (
                      <SourceChip key={source.id} id={source.id} source={source} />
                    ))}
                  </span>
                </>
              ) : null}
            </p>
          ) : (
            <p className="max-w-prose text-ui text-muted-foreground">
              {summary.by === 'ai' ? NOTHING_FROM_AI : LEFT_EMPTY}
            </p>
          )}
        </div>
        <EditPencil
          ref={pencil}
          label={title}
          className="touch:size-11"
          onClick={() => {
            setEditing(true)
          }}
        />
      </div>
    )
  }

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      data-slot="summary"
      data-summary={name}
      className="flex flex-col gap-2 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 id={titleId} className="text-ui font-semibold text-foreground">
          {title}
        </h3>
        {/* Nothing written yet has no mark: the AI wrote nothing to own. */}
        {writing || (summary.by === 'ai' && !text) ? null : <SummaryMark by={summary.by} />}
      </div>
      {body}
    </div>
  )
}

/** What went wrong with the draft, in the server's plain words, and Try again (the redraft). */
function FailedNotice({
  form,
  busy,
  onTryAgain,
}: {
  form: MeetingFormOut
  busy: boolean
  onTryAgain: () => void
}) {
  const hintId = useId()
  return (
    <div
      role="alert"
      data-slot="draft-failed"
      className="flex items-start gap-3 rounded-lg border border-destructive bg-destructive-soft p-4 text-ui text-destructive-ink"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-semibold">{FAILED_TITLE}</p>
        <p>{form.error?.trim() || FAILED_FALLBACK}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="touch:h-11"
            disabled={busy}
            aria-describedby={hintId}
            onClick={onTryAgain}
          >
            <RefreshCw aria-hidden="true" />
            {withEstimate(TRY_AGAIN)}
          </Button>
          <p id={hintId} className="text-caption">
            {redraftHint(form.cost_usd)}
          </p>
        </div>
      </div>
    </div>
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

export function SummariesSection({ form }: { form: MeetingFormOut }) {
  const headingId = useId()
  const title = useRef<HTMLHeadingElement>(null)
  const redraft = useRedraftMeetingForm(form.id)
  const failed = form.status === 'failed'
  const drafting = form.status === 'drafting'
  const showBlocks = !failed || hasSummaries(form)

  const startRedraft = (): void => {
    // The button greys out (or, in the failed box, goes) while it drafts: the focus stays here.
    focusTitle(title)
    redraft.mutate(undefined, {
      onError: (error) => {
        if (!isStillDrafting(error)) toastProblem(error)
      },
    })
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id={headingId}
          ref={title}
          tabIndex={-1}
          className="rounded-sm text-section font-semibold text-foreground"
        >
          {SUMMARIES}
        </h2>
        {drafting ? (
          <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
            <Hourglass aria-hidden="true" className="size-3.5 shrink-0" />
            {WRITING}
          </p>
        ) : null}
      </div>
      {failed ? (
        <FailedNotice form={form} busy={redraft.isPending} onTryAgain={startRedraft} />
      ) : null}
      {showBlocks ? (
        <div className="flex flex-col divide-y rounded-lg border bg-card">
          {SUMMARY_NAMES.map((name) => (
            <SummaryBlock key={name} form={form} name={name} />
          ))}
        </div>
      ) : null}
      {failed ? null : <RedraftRow form={form} busy={redraft.isPending} onRedraft={startRedraft} />}
    </section>
  )
}
