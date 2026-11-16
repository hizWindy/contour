/**
 * The parts of a card in "To confirm" (PLAN-V17 T3-6): its changes and its follow-ups. Each reads
 * as text, and while the card is edited, as fields.
 *
 * - **A field saves when you leave it,** or press Enter, and only if it changed. The card answers
 *   at once and the server is told after (`use-edit.ts`). Esc puts the field back as it was and
 *   ends the editing.
 * - **Fields forgive** (DESIGN.md): a follow-up's date takes "next tue", "24 nov" or "24/11"
 *   (`readDueDate`), and shows the day it read as you type. Before you type, it shows the day
 *   stored (`dueHint`). A change's value takes "30/6/2028" or "1,200 staff" (`values.ts`). Only
 *   what truly can't be read gets plain words, under the field.
 * - **A change shows its old value, an arrow, then the new one,** with its office. One whose
 *   HubSpot value moved since the rep saw it says so, and is held until they keep theirs or
 *   change it.
 */
import {
  ArrowRight,
  ChevronDown,
  ListTodo,
  Mail,
  PhoneCall,
  Plus,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { CallNoteChange, CallNoteTask, NoteField, TaskKind } from '@/api/types'
import { Segmented } from '@/components/motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { dueDateText, readDueDate } from '@/lib/due-date'
import { cn } from '@/lib/utils'
import { checkFollowUp } from '../call-notes/follow-up'
import {
  ADD_FOLLOW_UP,
  dueWords,
  WHAT_PLACEHOLDER,
  WHEN_PAST,
  WHEN_PLACEHOLDER,
  WHEN_UNREADABLE,
} from '../call-notes/words'
import { readFieldValue } from './values'
import {
  ADD,
  CANCEL,
  CHANGES,
  changedSince,
  changeLabel,
  fieldValue,
  FOLLOW_UPS,
  forWhom,
  fromWords,
  HELD,
  KEEP_MINE,
  KIND,
  KIND_LABELS,
  SHOW_ALL,
  SHOW_LESS,
  VALUE,
  VALUE_UNREADABLE,
  WHAT_TO_DO,
  WHEN,
} from './words'

/**
 * The start of the id of a part made on this card (a follow-up added, or a part put back by
 * Undo) that the server hasn't given an id yet. It goes to the server with no id.
 */
export const NEW_PART = 'new-'

/**
 * How much of a long text a folded card holds: more than its two lines ever show, so the fold is
 * the lines', and the page (and a screen reader) never holds a whole transcript until it is open.
 */
const FOLDED_CHARS = 400

/**
 * A card's text, folded to two lines (DESIGN.md's "two-line summary"), with "Show all" when there
 * is more: a long summary on a narrow screen, or a meeting's transcript, which is the card's text
 * while the AI is off (up to 60,000 characters). "Show less" folds it again and keeps the button
 * in view. Only the card changes: the note is as it was. `className` sets the text's size; its
 * colour comes from the card, so a card left out dims it.
 */
export function CardText({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false)
  // The folded lines hide some of it (measured; a test with no layout measures nothing).
  const [hidden, setHidden] = useState(false)
  const box = useRef<HTMLParagraphElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const textId = useId()
  const long = text.length > FOLDED_CHARS
  useLayoutEffect(() => {
    const shown = box.current
    if (open || !shown) return undefined
    // It answers once as it starts watching, then each time the card's width changes.
    const observer = new ResizeObserver(() => {
      setHidden(shown.scrollHeight > shown.clientHeight + 1)
    })
    observer.observe(shown)
    return () => {
      observer.disconnect()
    }
  }, [open, text])
  const folded = long ? `${text.slice(0, FOLDED_CHARS).trimEnd()}…` : text
  return (
    <div className="flex flex-col items-start gap-1">
      <p
        ref={box}
        id={textId}
        className={cn(
          'max-w-prose text-pretty break-words',
          open ? 'whitespace-pre-line' : 'line-clamp-2',
          className,
        )}
      >
        {open ? text : folded}
      </p>
      {open || long || hidden ? (
        <Button
          ref={toggle}
          type="button"
          variant="ghost"
          size="sm"
          className="touch:h-11"
          aria-expanded={open}
          aria-controls={textId}
          onClick={() => {
            const closing = open
            setOpen(!open)
            // A long text folds away above the button: keep the button where the eye is.
            if (closing) {
              requestAnimationFrame(() => {
                toggle.current?.scrollIntoView({ block: 'nearest' })
              })
            }
          }}
        >
          <ChevronDown
            aria-hidden="true"
            className={cn('transition-transform duration-150 ease-standard', open && 'rotate-180')}
          />
          {open ? SHOW_LESS : SHOW_ALL}
        </Button>
      ) : null}
    </div>
  )
}

const KIND_ICONS: Readonly<Record<TaskKind, LucideIcon>> = {
  call: PhoneCall,
  email: Mail,
  todo: ListTodo,
}

const KIND_OPTIONS = (Object.keys(KIND_LABELS) as TaskKind[]).map((kind) => ({
  value: kind,
  label: KIND_LABELS[kind],
}))

/** Enter alone (no Ctrl, which sends the batch). */
function plainEnter(event: KeyboardEvent): boolean {
  return (
    event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
  )
}

/**
 * A field that saves when it is left, or on Enter: `save` gets the text and returns words to show
 * under the field when it can't be read (or null when it went). Esc puts it back and ends the
 * editing.
 */
function useCommit(value: string, save: (text: string) => string | null, onCancel: () => void) {
  const [text, setText] = useState(value)
  const [problem, setProblem] = useState<string | null>(null)
  // Esc moves the focus, and the blur that follows must not save what Esc put back.
  const cancelled = useRef(false)
  const commit = (): void => {
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    if (text.trim() === value.trim()) {
      setProblem(null)
      return
    }
    setProblem(save(text))
  }
  const onKeyDown = (event: KeyboardEvent, enterSaves: boolean): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cancelled.current = true
      setText(value)
      setProblem(null)
      onCancel()
    } else if (enterSaves && plainEnter(event)) {
      event.preventDefault()
      commit()
    }
  }
  return {
    text,
    problem,
    commit,
    onKeyDown,
    change: (next: string) => {
      setText(next)
      setProblem(null)
    },
  }
}

/** The summary, as a text box that saves when it is left. An emptied box goes back. */
export function SummaryField({
  value,
  label,
  autoFocus,
  onSave,
  onCancel,
}: {
  value: string
  label: string
  autoFocus: boolean
  onSave: (text: string) => void
  onCancel: () => void
}) {
  const field = useCommit(
    value,
    (text) => {
      const trimmed = text.trim()
      if (trimmed !== '') onSave(trimmed)
      return null
    },
    onCancel,
  )
  return (
    <Textarea
      data-first-field=""
      aria-label={label}
      value={field.text}
      // Opened by E or Edit: the first field takes the focus as it shows.
      autoFocus={autoFocus}
      rows={2}
      maxLength={2000}
      className="text-body touch:text-body"
      // The cursor goes to the end, so what the rep types adds to the summary.
      onFocus={(event) => {
        const end = event.currentTarget.value.length
        event.currentTarget.setSelectionRange(end, end)
      }}
      onChange={(event) => {
        field.change(event.target.value)
      }}
      onBlur={() => {
        if (field.text.trim() === '') field.change(value)
        field.commit()
      }}
      onKeyDown={(event) => {
        field.onKeyDown(event, false)
      }}
    />
  )
}

/** One line of text that saves when it is left or on Enter. Empty goes back. */
function LineField({
  value,
  label,
  placeholder,
  onSave,
  onCancel,
}: {
  value: string
  label: string
  placeholder?: string
  onSave: (text: string) => void
  onCancel: () => void
}) {
  const field = useCommit(
    value,
    (text) => {
      const trimmed = text.trim()
      if (trimmed !== '') onSave(trimmed)
      return null
    },
    onCancel,
  )
  return (
    <Input
      aria-label={label}
      value={field.text}
      placeholder={placeholder}
      maxLength={200}
      className="touch:text-body"
      onChange={(event) => {
        field.change(event.target.value)
      }}
      onBlur={() => {
        if (field.text.trim() === '') field.change(value)
        field.commit()
      }}
      onKeyDown={(event) => {
        field.onKeyDown(event, true)
      }}
    />
  )
}

// --- Changes --------------------------------------------------------------------------------

interface ChangeListProps {
  changes: readonly CallNoteChange[]
  fields: readonly NoteField[]
  editing: boolean
  /** The whole list after an edit: a value changed, one kept or one removed. */
  onSave: (changes: CallNoteChange[], removed?: CallNoteChange) => void
  onCancel: () => void
}

function kindOf(fields: readonly NoteField[], id: string): NoteField['kind'] | undefined {
  return fields.find((field) => field.id === id)?.kind
}

function ValueField({
  change,
  kind,
  label,
  onSave,
  onCancel,
}: {
  change: CallNoteChange
  kind: NoteField['kind'] | undefined
  label: string
  onSave: (value: string) => void
  onCancel: () => void
}) {
  const noteId = useId()
  // It opens as the card shows it ("31 Mar 2028", "1,200"), which reads back as the same value,
  // so a field left as it was saves nothing. An empty value opens empty, not as "Empty".
  const start = change.value.trim() === '' ? '' : fieldValue(change.value, kind)
  const field = useCommit(
    start,
    (text) => {
      const value = readFieldValue(kind, text)
      if (value === null) return VALUE_UNREADABLE
      if (value !== change.value) onSave(value)
      return null
    },
    onCancel,
  )
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <Input
        aria-label={`${label}: ${VALUE.toLowerCase()}`}
        value={field.text}
        aria-invalid={field.problem ? true : undefined}
        aria-describedby={field.problem ? noteId : undefined}
        autoComplete="off"
        className="touch:text-body"
        onChange={(event) => {
          field.change(event.target.value)
        }}
        onBlur={field.commit}
        onKeyDown={(event) => {
          field.onKeyDown(event, true)
        }}
      />
      {field.problem ? (
        <p id={noteId} role="alert" className="text-caption text-destructive-ink">
          {field.problem}
        </p>
      ) : null}
    </div>
  )
}

function ChangeRow({
  change,
  kind,
  editing,
  onValue,
  onKeep,
  onRemove,
  onCancel,
}: {
  change: CallNoteChange
  kind: NoteField['kind'] | undefined
  editing: boolean
  onValue: (value: string) => void
  onKeep: () => void
  onRemove: () => void
  onCancel: () => void
}) {
  const label = changeLabel(change.label, change.office)
  const was = fieldValue(change.current, kind)
  return (
    <li className="flex flex-col gap-1">
      <span className="text-caption text-muted-foreground">{label}</span>
      {editing ? (
        <div className="flex flex-wrap items-start gap-2">
          <span className="flex h-9 items-center gap-2 text-ui text-muted-foreground touch:h-11">
            <span>
              <span className="sr-only">HubSpot has </span>
              {was}
            </span>
            <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
          </span>
          <ValueField
            change={change}
            kind={kind}
            label={label}
            onSave={onValue}
            onCancel={onCancel}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove the change to ${label}`}
            onClick={onRemove}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ui">
          <span className="text-muted-foreground">
            <span className="sr-only">HubSpot has </span>
            {was}
          </span>
          <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="font-semibold">
            <span className="sr-only">, new value </span>
            {fieldValue(change.value, kind)}
          </span>
        </span>
      )}
      {change.current_changed ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-review-ink">
          <span className="flex min-w-0 items-start gap-1.5">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {changedSince(fieldValue(change.current, kind))} {HELD}
            </span>
          </span>
          <Button type="button" variant="outline" size="xs" className="touch:h-11" onClick={onKeep}>
            {KEEP_MINE}
          </Button>
        </div>
      ) : null}
    </li>
  )
}

export function ChangeList({ changes, fields, editing, onSave, onCancel }: ChangeListProps) {
  const titleId = useId()
  if (changes.length === 0) return null
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <h3 id={titleId} className="text-ui font-semibold">
        {CHANGES}
      </h3>
      <ul className="flex flex-col gap-3">
        {changes.map((change) => (
          <ChangeRow
            key={change.id}
            change={change}
            kind={kindOf(fields, change.field)}
            editing={editing}
            onValue={(value) => {
              onSave(
                changes.map((item) =>
                  item.id === change.id ? { ...item, value, current_changed: false } : item,
                ),
              )
            }}
            onKeep={() => {
              onSave(
                changes.map((item) =>
                  item.id === change.id ? { ...item, current_changed: false } : item,
                ),
              )
            }}
            onRemove={() => {
              onSave(
                changes.filter((item) => item.id !== change.id),
                change,
              )
            }}
            onCancel={onCancel}
          />
        ))}
      </ul>
    </section>
  )
}

// --- Follow-ups -----------------------------------------------------------------------------

/** "Call · Due Tue 24 Nov 2026 · from "next Tuesday" · For you" */
function taskLine(task: CallNoteTask): string {
  return [
    KIND_LABELS[task.kind],
    `Due ${dueDateText(task.due)}`,
    task.due_words ? fromWords(task.due_words) : null,
    forWhom(task.owner),
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * The line under a follow-up's date: the day that will be stored. Until the rep changes the
 * words, that is the day already stored, because the words were read on the day of the call and
 * today they may mean another day ("tomorrow" said on Monday is Tuesday, even when the rep checks
 * it on Wednesday). A stored day that has gone says so. Once the rep types, the line follows what
 * they type.
 */
function dueHint(
  text: string,
  start: string,
  task: CallNoteTask,
  today: string,
): { words: string; gone: boolean } {
  const read = readDueDate(text, today)
  const changed = text.trim() !== start.trim()
  // New words, or the stored words if today they still read as the stored day: say the day they
  // read, with the weekend move if there was one.
  if (read.kind === 'date' && (changed || read.date === task.due)) {
    return { words: dueWords(read.date, read.moved), gone: false }
  }
  return task.due < today
    ? { words: WHEN_PAST, gone: true }
    : { words: dueWords(task.due, false), gone: false }
}

function DueField({
  task,
  today,
  label,
  onSave,
  onCancel,
}: {
  task: CallNoteTask
  today: string
  label: string
  onSave: (due: string, words: string) => void
  onCancel: () => void
}) {
  const noteId = useId()
  const start = task.due_words ?? dueDateText(task.due)
  const field = useCommit(
    start,
    (text) => {
      const due = readDueDate(text, today)
      if (due.kind === 'unreadable') return WHEN_UNREADABLE
      if (due.kind === 'past') return WHEN_PAST
      if (due.kind === 'date') onSave(due.date, text.trim())
      return null
    },
    onCancel,
  )
  const hint = dueHint(field.text, start, task, today)
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Input
        aria-label={label}
        value={field.text}
        placeholder={WHEN_PLACEHOLDER}
        maxLength={60}
        autoComplete="off"
        aria-invalid={field.problem ? true : undefined}
        aria-describedby={noteId}
        className="touch:text-body"
        onChange={(event) => {
          field.change(event.target.value)
        }}
        onBlur={() => {
          if (field.text.trim() === '') field.change(start)
          field.commit()
        }}
        onKeyDown={(event) => {
          field.onKeyDown(event, true)
        }}
      />
      <p
        id={noteId}
        role={field.problem ? 'alert' : undefined}
        className={cn(
          'min-h-5 text-caption',
          field.problem || hint.gone ? 'text-destructive-ink' : 'text-muted-foreground',
        )}
      >
        {field.problem ?? hint.words}
      </p>
    </div>
  )
}

function TaskRow({
  task,
  index,
  editing,
  today,
  onSave,
  onRemove,
  onCancel,
}: {
  task: CallNoteTask
  index: number
  editing: boolean
  today: string
  onSave: (task: CallNoteTask) => void
  onRemove: () => void
  onCancel: () => void
}) {
  const Icon = KIND_ICONS[task.kind]
  const name = `Follow-up ${String(index + 1)}`
  if (!editing) {
    return (
      <li className="flex items-start gap-2">
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-ui font-semibold break-words">{task.subject}</span>
          <span className="text-caption text-muted-foreground">{taskLine(task)}</span>
        </span>
      </li>
    )
  }
  return (
    <li className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <LineField
            value={task.subject}
            label={`${name}: ${WHAT_TO_DO.toLowerCase()}`}
            placeholder={WHAT_PLACEHOLDER}
            onSave={(subject) => {
              onSave({ ...task, subject })
            }}
            onCancel={onCancel}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Remove ${name.toLowerCase()}: ${task.subject}`}
          onClick={onRemove}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)]">
        <Segmented
          size="sm"
          aria-label={`${name}: ${KIND.toLowerCase()}`}
          options={KIND_OPTIONS}
          value={task.kind}
          onChange={(kind) => {
            if (kind !== task.kind) onSave({ ...task, kind })
          }}
        />
        <DueField
          task={task}
          today={today}
          label={`${name}: ${WHEN.toLowerCase()}`}
          onSave={(due, words) => {
            onSave({ ...task, due, due_words: words })
          }}
          onCancel={onCancel}
        />
      </div>
      <p className="text-caption text-muted-foreground">{forWhom(task.owner)}</p>
    </li>
  )
}

/** "Add a follow-up": what to do and when, then Add. It reads the date as Log call does. */
function AddFollowUp({ today, onAdd }: { today: string; onAdd: (task: CallNoteTask) => void }) {
  const [draft, setDraft] = useState<{ subject: string; when: string } | null>(null)
  const [problem, setProblem] = useState<{ field: 'what' | 'when'; words: string } | null>(null)
  const whatId = useId()
  const whenId = useId()
  const noteId = useId()
  if (draft === null) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-2 w-fit text-muted-foreground touch:h-11"
        onClick={() => {
          setDraft({ subject: '', when: '' })
        }}
      >
        <Plus aria-hidden="true" />
        {ADD_FOLLOW_UP}
      </Button>
    )
  }
  const read = readDueDate(draft.when, today)
  const add = (): void => {
    const check = checkFollowUp(draft, today)
    if (!check.ok) {
      setProblem({ field: check.field, words: check.words })
      return
    }
    if (check.task) {
      onAdd({
        id: `${NEW_PART}${crypto.randomUUID()}`,
        subject: check.task.subject,
        due: check.task.due,
        due_words: check.task.due_words ?? '',
        kind: check.task.kind,
        owner: null,
        in_hubspot: false,
      })
    }
    setDraft(null)
    setProblem(null)
  }
  return (
    <div
      className="flex flex-col gap-2 rounded-md border p-3"
      onKeyDown={(event) => {
        // Enter in a field adds it; on a button, Enter is that button's own.
        if (plainEnter(event) && event.target instanceof HTMLInputElement) {
          event.preventDefault()
          add()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          setDraft(null)
          setProblem(null)
        }
      }}
    >
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={whatId} className="text-caption text-muted-foreground">
            {WHAT_TO_DO}
          </label>
          <Input
            id={whatId}
            autoFocus
            value={draft.subject}
            placeholder={WHAT_PLACEHOLDER}
            maxLength={200}
            aria-invalid={problem?.field === 'what' ? true : undefined}
            aria-describedby={problem?.field === 'what' ? noteId : undefined}
            className="touch:text-body"
            onChange={(event) => {
              setDraft({ ...draft, subject: event.target.value })
              setProblem(null)
            }}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={whenId} className="text-caption text-muted-foreground">
            {WHEN}
          </label>
          <Input
            id={whenId}
            value={draft.when}
            placeholder={WHEN_PLACEHOLDER}
            maxLength={60}
            autoComplete="off"
            aria-invalid={problem?.field === 'when' ? true : undefined}
            aria-describedby={noteId}
            className="touch:text-body"
            onChange={(event) => {
              setDraft({ ...draft, when: event.target.value })
              setProblem(null)
            }}
          />
        </div>
      </div>
      <p
        id={noteId}
        role={problem ? 'alert' : undefined}
        className={cn(
          'min-h-5 text-caption',
          problem ? 'text-destructive-ink' : 'text-muted-foreground',
        )}
      >
        {problem?.words ?? (read.kind === 'date' ? dueWords(read.date, read.moved) : '')}
      </p>
      <div className="flex flex-wrap gap-2 max-sm:*:flex-1">
        <Button type="button" size="sm" variant="outline" className="touch:h-11" onClick={add}>
          {ADD}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="touch:h-11"
          onClick={() => {
            setDraft(null)
            setProblem(null)
          }}
        >
          {CANCEL}
        </Button>
      </div>
    </div>
  )
}

interface TaskListProps {
  tasks: readonly CallNoteTask[]
  editing: boolean
  today: string
  /** The whole list after an edit: one changed, added or removed. */
  onSave: (tasks: CallNoteTask[], removed?: CallNoteTask) => void
  onCancel: () => void
}

export function TaskList({ tasks, editing, today, onSave, onCancel }: TaskListProps) {
  const titleId = useId()
  if (tasks.length === 0 && !editing) return null
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <h3 id={titleId} className="text-ui font-semibold">
        {FOLLOW_UPS}
      </h3>
      {tasks.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {tasks.map((task, index) => (
            <TaskRow
              key={task.id}
              task={task}
              index={index}
              editing={editing}
              today={today}
              onSave={(next) => {
                onSave(tasks.map((item) => (item.id === task.id ? next : item)))
              }}
              onRemove={() => {
                onSave(
                  tasks.filter((item) => item.id !== task.id),
                  task,
                )
              }}
              onCancel={onCancel}
            />
          ))}
        </ul>
      ) : null}
      {editing ? (
        <AddFollowUp
          today={today}
          onAdd={(task) => {
            onSave([...tasks, task])
          }}
        />
      ) : null}
    </section>
  )
}
