/**
 * The follow-up a rep adds by hand while the AI is off (PLAN-V17 choice 2): what to do, and when.
 * Folded behind "Add a follow-up" until it is wanted, so "L, talk, Ctrl+Enter" stays three steps.
 *
 * "When" forgives (DESIGN.md "Fields forgive"): "next tue", "24 nov", "24/11", "in 2 weeks" and
 * "tomorrow" all work, and the day it read shows under the field as you type. Only a value it
 * truly can't read gets plain words, after the field is left or a save is tried.
 */
import { Plus, X } from 'lucide-react'
import { useId, useState, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { readDueDate } from '@/lib/due-date'
import { cn } from '@/lib/utils'
import type { FollowUpDraft } from './draft'
import {
  ADD_FOLLOW_UP,
  dueWords,
  FOLLOW_UP,
  FOLLOW_UP_WHAT,
  FOLLOW_UP_WHEN,
  REMOVE_FOLLOW_UP,
  WHAT_PLACEHOLDER,
  WHEN_PAST,
  WHEN_PLACEHOLDER,
  WHEN_UNREADABLE,
} from './words'

export interface FollowUpFieldsProps {
  value: FollowUpDraft | null
  onChange: (value: FollowUpDraft | null) => void
  /** What a tried save found wrong, under its field. */
  problem: { field: 'what' | 'when'; words: string } | null
  today: string
  whatRef: RefObject<HTMLInputElement | null>
  whenRef: RefObject<HTMLInputElement | null>
  /** Where focus goes when the follow-up is removed. */
  onRemoved: () => void
}

export function FollowUpFields({
  value,
  onChange,
  problem,
  today,
  whatRef,
  whenRef,
  onRemoved,
}: FollowUpFieldsProps) {
  const titleId = useId()
  const whatId = useId()
  const whenId = useId()
  const whatNoteId = useId()
  const whenNoteId = useId()
  const [whenLeft, setWhenLeft] = useState(false)
  // Opened by a press (not a draft coming back): the first field takes the focus as it mounts.
  const [adding, setAdding] = useState(false)

  if (value === null) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-2 w-fit text-muted-foreground touch:h-11"
        onClick={() => {
          setAdding(true)
          onChange({ subject: '', when: '' })
        }}
      >
        <Plus aria-hidden="true" />
        {ADD_FOLLOW_UP}
      </Button>
    )
  }

  const due = readDueDate(value.when, today)
  const whenProblem =
    problem?.field === 'when'
      ? problem.words
      : whenLeft && due.kind === 'unreadable'
        ? WHEN_UNREADABLE
        : whenLeft && due.kind === 'past'
          ? WHEN_PAST
          : null
  const whatProblem = problem?.field === 'what' ? problem.words : null

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 id={titleId} className="text-ui font-semibold text-foreground">
          {FOLLOW_UP}
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-mr-2 text-muted-foreground touch:h-11"
          onClick={() => {
            setAdding(false)
            onChange(null)
            onRemoved()
          }}
        >
          <X aria-hidden="true" />
          {REMOVE_FOLLOW_UP}
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={whatId} className="text-caption text-muted-foreground">
            {FOLLOW_UP_WHAT}
          </label>
          <Input
            ref={whatRef}
            id={whatId}
            autoFocus={adding}
            value={value.subject}
            placeholder={WHAT_PLACEHOLDER}
            maxLength={200}
            aria-invalid={whatProblem ? true : undefined}
            aria-describedby={whatProblem ? whatNoteId : undefined}
            className="touch:text-body"
            onChange={(event) => {
              onChange({ ...value, subject: event.target.value })
            }}
          />
          {whatProblem ? (
            <p id={whatNoteId} role="alert" className="text-caption text-destructive-ink">
              {whatProblem}
            </p>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={whenId} className="text-caption text-muted-foreground">
            {FOLLOW_UP_WHEN}
          </label>
          <Input
            ref={whenRef}
            id={whenId}
            value={value.when}
            placeholder={WHEN_PLACEHOLDER}
            maxLength={60}
            autoComplete="off"
            aria-invalid={whenProblem ? true : undefined}
            aria-describedby={whenNoteId}
            className="touch:text-body"
            onChange={(event) => {
              setWhenLeft(false)
              onChange({ ...value, when: event.target.value })
            }}
            onBlur={() => {
              setWhenLeft(true)
            }}
          />
          <p
            id={whenNoteId}
            role={whenProblem ? 'alert' : undefined}
            className={cn(
              'min-h-5 text-caption',
              whenProblem ? 'text-destructive-ink' : 'text-muted-foreground',
            )}
          >
            {whenProblem ?? (due.kind === 'date' ? dueWords(due.date, due.moved) : '')}
          </p>
        </div>
      </div>
    </section>
  )
}
