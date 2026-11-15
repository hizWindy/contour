/**
 * One call in "To confirm" (PLAN-V17 T3-6, "The screens" part 3): who, when and the outcome, a
 * two-line summary (with "Show all" when there is more, `CardText`), then "Changes" and
 * "Follow-ups". The rep checks it, and fixes what is wrong.
 *
 * - **Edit** (or E) turns its parts into fields: the summary, the outcome, each change's value,
 *   each follow-up's words, kind and day, and "Add a follow-up". Each field saves when it is left
 *   (`note-parts.tsx`). Done, or Esc, ends it. A change or a follow-up removed meanwhile goes at
 *   once, with Undo in a toast.
 * - **Leave out** (or X) keeps it here, dimmed, out of this batch. "Put back" brings it back.
 *   Dimmed means the quieter text colour on the title, the summary and the parts (they take the
 *   colour from the card, so `note-parts.tsx` sets none of its own on them), not lower opacity:
 *   every line still reads at 4.5:1 or more. The status line and the buttons stay at full strength.
 * - **Remove** takes it away at once, with Undo in a toast (`remove.ts`).
 * - **A note the sorter was unsure of** says so at the top, in words, and sits first in the list.
 * - **A note still being sorted** says so in words, with the hourglass, above a still grey line
 *   where its parts will be. When they come, they fade and rise into place one after another
 *   (`Reveal`, 40ms apart).
 * - **While it is sent:** "Sending to HubSpot.", then the tick beside "Logged" (`TickIn`), or
 *   "Needs a look" with what happened. Nothing can be changed meanwhile.
 * - **The active card** (J and K move it) has the Navy edge and the tint of a selected row. While
 *   it is edited it keeps the edge but not the tint: its fields sit on the card colour, where
 *   their borders reach 3:1.
 * - **A logged meeting** (T3-11, `source` transcript) reads as meeting notes: its line says
 *   "Meeting notes", not a call outcome, and editing it offers no outcome. It goes to HubSpot as a
 *   note.
 * - **A note the last send left out** (`skipped`, T3-11) says so at the top, in the server's words,
 *   until it is changed or sent again, so it never looks forgotten.
 */
import {
  CircleAlert,
  CircleMinus,
  Hourglass,
  Pencil,
  Send,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Fragment, useId, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { noteInLists } from '@/api/hooks/call-notes'
import type {
  CallNoteChange,
  CallNoteOptions,
  CallNoteOut,
  CallNotePatch,
  CallNoteTask,
} from '@/api/v17'
import { ChipGroup, Reveal, TickIn } from '@/components/motion'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { NEW_PART, CardText, ChangeList, SummaryField, TaskList } from './note-parts'
import type { Landing } from './use-batch'
import {
  changeLabel,
  CHECK_THIS_ONE,
  DONE,
  EDIT,
  isMeetingNotes,
  LEAVE_OUT,
  LEFT_BEHIND,
  LEFT_OUT,
  LOGGED,
  NEEDS_LOOK,
  noteLine,
  OUTCOME,
  PUT_BACK,
  REMOVE,
  removedChangeWords,
  removedTaskWords,
  SENDING,
  SORTING,
  SUMMARY,
  UNDO,
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
  /** Why the last send left this note out, in the server's words, or null (T3-11). */
  skippedWhy?: string | null
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

/**
 * A note the server is still sorting. Sorting takes seconds, not a blink, so the word shows at
 * once, with the hourglass the app uses for waiting (DESIGN.md: every status has an icon and a
 * word). The still grey lines under it only show where the parts will be.
 */
function SortingLine() {
  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="flex items-center gap-2 text-muted-foreground">
        <Hourglass aria-hidden="true" className="size-4 shrink-0" />
        {SORTING}
      </p>
      <div aria-hidden="true" className="flex flex-col gap-2">
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
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
  skippedWhy = null,
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
  const client = useQueryClient()
  const stop = (): void => {
    onEditing(false)
  }

  // Changes and follow-ups go as whole lists. A part made here goes with no id.
  const saveChanges = (changes: CallNoteChange[]): void => {
    edit(
      {
        changes: changes.map((change) => ({
          id: change.id.startsWith(NEW_PART) ? null : change.id,
          field: change.field,
          office: change.office,
          value: change.value,
        })),
      },
      (now) => ({ ...now, changes }),
    )
  }
  const saveTasks = (tasks: CallNoteTask[]): void => {
    edit(
      {
        tasks: tasks.map((task) => ({
          id: task.id.startsWith(NEW_PART) ? null : task.id,
          subject: task.subject,
          due: task.due,
          due_words: task.due_words,
          kind: task.kind,
        })),
      },
      (now) => ({ ...now, tasks }),
    )
  }
  /**
   * A removed part, with Undo in a toast. Undo puts it back where it was, in the note as it is
   * then (other edits since stay), as a new part.
   */
  const offerUndo = <Part extends { id: string }>(
    words: string,
    part: Part,
    index: number,
    listOf: (now: CallNoteOut) => Part[],
    save: (list: Part[]) => void,
  ): void => {
    toast(words, {
      action: {
        label: UNDO,
        onClick: () => {
          const list = [...listOf(noteInLists(client, note.id) ?? note)]
          list.splice(Math.min(index, list.length), 0, {
            ...part,
            id: `${NEW_PART}${crypto.randomUUID()}`,
          })
          save(list)
        },
      },
    })
  }

  // A logged meeting's notes have no call outcome to pick: they go to HubSpot as a note.
  const outcomes = isMeetingNotes(note)
    ? []
    : outcome && !options.outcomes.includes(outcome)
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
          <CardText text={summary} className="text-body" />
        )}
        {editing && outcomes.length > 0 ? (
          <section aria-labelledby={outcomeId} className="flex flex-col gap-2">
            <h3 id={outcomeId} className="text-ui font-semibold text-foreground">
              {OUTCOME}
            </h3>
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
          onSave={(changes, removed) => {
            saveChanges(changes)
            if (removed) {
              offerUndo(
                removedChangeWords(changeLabel(removed.label, removed.office)),
                removed,
                note.changes.findIndex((change) => change.id === removed.id),
                (now) => now.changes,
                saveChanges,
              )
            }
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
          onSave={(tasks, removed) => {
            saveTasks(tasks)
            if (removed) {
              offerUndo(
                removedTaskWords(removed.subject),
                removed,
                note.tasks.findIndex((task) => task.id === removed.id),
                (now) => now.tasks,
                saveTasks,
              )
            }
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
        active && 'shadow-[inset_3px_0_0_var(--primary)]',
        // A field's border is under 3:1 on the selected tint (contrast.test.ts), so the card being
        // edited, always the active one, keeps the Navy edge only.
        active && !editing && 'bg-selected',
      )}
    >
      {skippedWhy ? (
        <p
          data-slot="left-behind"
          className="flex items-start gap-2 border-b border-review bg-review-soft px-4 py-2 text-review-ink sm:px-5"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="font-semibold">{LEFT_BEHIND}</span> {skippedWhy}
          </span>
        </p>
      ) : null}
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
          'flex flex-col gap-4 p-4 transition-colors sm:p-5',
          // Left out: the title, the summary and the parts take the quieter text colour, which
          // still reads at 4.5:1 or more. Lower opacity took the quieter text under 4.5:1 (T3-8).
          note.left_out && !editing ? 'text-muted-foreground' : 'text-foreground',
        )}
      >
        <header className="flex flex-col gap-0.5">
          <h2 id={titleId} className="text-section font-semibold text-balance">
            {note.company_name}
          </h2>
          <p className="text-caption text-muted-foreground">{noteLine(note, today)}</p>
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
