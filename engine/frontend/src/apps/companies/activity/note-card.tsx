/**
 * One call in "To confirm" (PLAN-V17 T3-6, "The screens" part 3): who, when and the outcome, a
 * two-line summary, then "Changes" and "Follow-ups". The rep checks it, and fixes what is wrong.
 *
 * - **Edit** (or E) turns its parts into fields: the summary, the outcome, each change's value,
 *   each follow-up's words, kind and day, and "Add a follow-up". Each field saves when it is left
 *   (`note-parts.tsx`). Done, or Esc, ends it.
 * - **Leave out** (or X) keeps it here, dimmed, out of this batch. "Put back" brings it back.
 * - **Remove** takes it away at once, with Undo in a toast (`remove.ts`).
 * - **A note the sorter was unsure of** says so at the top, in words, and sits first in the list.
 * - **A note still being sorted** shows a still grey line where its parts will be. When they come,
 *   they fade and rise into place one after another (`Reveal`, 40ms apart).
 * - **While it is sent:** "Sending to HubSpot.", then the tick beside "Logged" (`TickIn`), or
 *   "Needs a look" with what happened. Nothing can be changed meanwhile.
 * - **The active card** (J and K move it) has the Navy edge of a selected row.
 */
import {
  CircleAlert,
  CircleMinus,
  Pencil,
  Send,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-react'
import { Fragment, useId, useState, type ReactNode } from 'react'
import type { CallNoteOptions, CallNoteOut, CallNotePatch } from '@/api/v17'
import { ChipGroup, Reveal, TickIn } from '@/components/motion'
import { Pending } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { NEW_TASK, ChangeList, SummaryField, TaskList } from './note-parts'
import type { Landing } from './use-batch'
import {
  callWhen,
  CHECK_THIS_ONE,
  DONE,
  EDIT,
  LEAVE_OUT,
  LEFT_OUT,
  LOGGED,
  NEEDS_LOOK,
  NO_OUTCOME,
  OUTCOME,
  personLine,
  PUT_BACK,
  REMOVE,
  SENDING,
  SORTING,
  SUMMARY,
} from './words'

/** Sends an edit: what the server is told, and the same change made on screen at once. */
export type EditNote = (patch: CallNotePatch, apply: (note: CallNoteOut) => CallNoteOut) => void

export interface NoteCardProps {
  note: CallNoteOut
  options: CallNoteOptions
  /** Melbourne's day, for "Today" and for reading a follow-up's day. */
  today: string
  active: boolean
  editing: boolean
  /** Where the batch stands for this note while it is sent, or null. */
  landing: Landing | null
  onActivate: () => void
  /** Starts or ends the editing. Ending puts the focus back on the card. */
  onEditing: (editing: boolean) => void
  onToggleLeftOut: () => void
  onRemove: () => void
  edit: EditNote
}

/** The words of the first step that didn't land, for "Needs a look". */
function problemWords(note: CallNoteOut): string {
  return (
    note.steps.find((step) => step.status === 'failed' || step.status === 'uncertain')?.words ?? ''
  )
}

function SortingLine() {
  return (
    <Pending label={SORTING}>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </Pending>
  )
}

/** The bottom row: what the card is doing, or what can be done to it. */
function Footer({
  note,
  landing,
  editing,
  sorting,
  onEditing,
  onToggleLeftOut,
  onRemove,
}: Pick<NoteCardProps, 'note' | 'landing' | 'onEditing' | 'onToggleLeftOut' | 'onRemove'> & {
  editing: boolean
  sorting: boolean
}) {
  if (landing === 'logged') {
    return (
      <p className="flex items-center gap-2 font-semibold text-pass-ink">
        <TickIn />
        {LOGGED}
      </p>
    )
  }
  if (landing === 'needs_look') {
    const words = problemWords(note)
    return (
      <p className="flex items-start gap-2 text-destructive-ink">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>
          <span className="font-semibold">{NEEDS_LOOK}.</span>
          {words ? ` ${words}` : ''}
        </span>
      </p>
    )
  }
  if (landing === 'waiting' || note.status === 'sending') {
    return (
      <p className="flex items-center gap-2 text-muted-foreground">
        <Send aria-hidden="true" className="size-4 shrink-0" />
        {SENDING}
      </p>
    )
  }
  const remove = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="ml-auto text-muted-foreground touch:h-11"
      onClick={onRemove}
    >
      <Trash2 aria-hidden="true" />
      {REMOVE}
    </Button>
  )
  if (editing) {
    return (
      <>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="touch:h-11"
          onClick={() => {
            onEditing(false)
          }}
        >
          {DONE}
        </Button>
        {remove}
      </>
    )
  }
  const leave = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="touch:h-11"
      aria-keyshortcuts="X"
      onClick={onToggleLeftOut}
    >
      {note.left_out ? <Undo2 aria-hidden="true" /> : <X aria-hidden="true" />}
      {note.left_out ? PUT_BACK : LEAVE_OUT}
      <Kbd aria-hidden="true" className="touch:hidden">
        X
      </Kbd>
    </Button>
  )
  return (
    <>
      {note.left_out ? (
        <span className="flex items-center gap-2 text-muted-foreground">
          <CircleMinus aria-hidden="true" className="size-4 shrink-0" />
          {LEFT_OUT}
        </span>
      ) : null}
      {sorting || note.left_out ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="touch:h-11"
          aria-keyshortcuts="E"
          onClick={() => {
            onEditing(true)
          }}
        >
          <Pencil aria-hidden="true" />
          {EDIT}
          <Kbd aria-hidden="true" className="touch:hidden">
            E
          </Kbd>
        </Button>
      )}
      {leave}
      {remove}
    </>
  )
}

export function NoteCard({
  note,
  options,
  today,
  active,
  editing: editingWanted,
  landing,
  onActivate,
  onEditing,
  onToggleLeftOut,
  onRemove,
  edit,
}: NoteCardProps) {
  const titleId = useId()
  const outcomeId = useId()
  // Mounted while the note was being sorted: its parts fade in when they come.
  const [revealParts] = useState(note.status === 'sorting')
  const sorting = note.status === 'sorting'
  const locked = landing !== null || note.status === 'sending'
  const editing = editingWanted && !sorting && !locked
  const summary = note.call.summary.trim() || note.text
  const outcome = note.call.outcome
  const fieldKinds = options.fields
  const stop = (): void => {
    onEditing(false)
  }

  const outcomes =
    outcome && !options.outcomes.includes(outcome)
      ? [...options.outcomes, outcome]
      : options.outcomes

  const parts: { key: string; node: ReactNode }[] = []
  parts.push({
    key: 'call',
    node: (
      <div className="flex flex-col gap-3">
        {editing ? (
          <SummaryField
            value={summary}
            label={`${SUMMARY}: ${note.company_name}`}
            autoFocus
            onSave={(text) => {
              edit({ summary: text }, (now) => ({ ...now, call: { ...now.call, summary: text } }))
            }}
            onCancel={stop}
          />
        ) : (
          <p className="line-clamp-2 max-w-prose text-body text-pretty break-words text-foreground">
            {summary}
          </p>
        )}
        {editing && outcomes.length > 0 ? (
          <section aria-labelledby={outcomeId} className="flex flex-col gap-2">
            <h4 id={outcomeId} className="text-ui font-semibold text-foreground">
              {OUTCOME}
            </h4>
            <ChipGroup
              mode="one-or-none"
              aria-labelledby={outcomeId}
              options={outcomes.map((name) => ({ value: name, label: name }))}
              value={outcome === null ? [] : [outcome]}
              onChange={([picked]) => {
                const next = picked ?? null
                edit({ outcome: next }, (now) => ({ ...now, call: { ...now.call, outcome: next } }))
              }}
            />
          </section>
        ) : null}
      </div>
    ),
  })
  if (note.changes.length > 0) {
    parts.push({
      key: 'changes',
      node: (
        <ChangeList
          changes={note.changes}
          fields={fieldKinds}
          editing={editing}
          onSave={(changes) => {
            edit(
              {
                changes: changes.map((change) => ({
                  id: change.id,
                  field: change.field,
                  office: change.office,
                  value: change.value,
                })),
              },
              (now) => ({ ...now, changes }),
            )
          }}
          onCancel={stop}
        />
      ),
    })
  }
  if (note.tasks.length > 0 || editing) {
    parts.push({
      key: 'tasks',
      node: (
        <TaskList
          tasks={note.tasks}
          editing={editing}
          today={today}
          onSave={(tasks) => {
            edit(
              {
                tasks: tasks.map((task) => ({
                  id: task.id.startsWith(NEW_TASK) ? null : task.id,
                  subject: task.subject,
                  due: task.due,
                  due_words: task.due_words,
                  kind: task.kind,
                })),
              },
              (now) => ({ ...now, tasks }),
            )
          }}
          onCancel={stop}
        />
      ),
    })
  }

  return (
    <article
      data-note={note.id}
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-current={active || undefined}
      onFocusCapture={onActivate}
      onPointerDown={onActivate}
      className={cn(
        'flex flex-col overflow-hidden rounded-lg border bg-card text-ui',
        active && 'bg-selected shadow-[inset_3px_0_0_var(--primary)]',
      )}
    >
      {note.unsure ? (
        <p className="flex items-start gap-2 border-b border-review bg-review-soft px-4 py-2 text-review-ink sm:px-5">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="font-semibold">{CHECK_THIS_ONE}</span> {note.unsure}
          </span>
        </p>
      ) : null}
      <div
        className={cn(
          'flex flex-col gap-4 p-4 transition-opacity sm:p-5',
          note.left_out && !editing && 'opacity-60',
        )}
      >
        <header className="flex flex-col gap-0.5">
          <h3 id={titleId} className="text-section font-semibold text-balance text-foreground">
            {note.company_name}
          </h3>
          <p className="text-caption text-muted-foreground">
            {[personLine(note.person), callWhen(note.called_at, today), outcome ?? NO_OUTCOME].join(
              ' · ',
            )}
          </p>
        </header>
        {sorting ? (
          <SortingLine />
        ) : (
          parts.map(({ key, node }, index) =>
            revealParts ? (
              <Reveal key={key} index={index}>
                {node}
              </Reveal>
            ) : (
              <Fragment key={key}>{node}</Fragment>
            ),
          )
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5 sm:px-5">
        <Footer
          note={note}
          landing={landing}
          editing={editing}
          sorting={sorting}
          onEditing={onEditing}
          onToggleLeftOut={onToggleLeftOut}
          onRemove={onRemove}
        />
      </div>
    </article>
  )
}
