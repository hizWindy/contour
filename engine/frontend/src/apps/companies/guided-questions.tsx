/**
 * Guided questions on the prep card (PLAN-V10 F1): the questions to ask on the call, in order,
 * each with why it is asked and what to ask next for each likely answer.
 *
 * - **One at a time.** The first question not asked yet shows its follow-ups. Ticking it ("Asked")
 *   folds it away and opens the next one. Any question opens with a click.
 * - **Motion:** the follow-ups open and fold in 250 ms on the one curve, and fade in 150 ms. A
 *   ticked question dims in 150 ms. Nothing moves with reduced motion.
 * - **Nothing is saved.** The ticks are for this call only, and start again with the next card.
 */
import { ChevronDown, CornerDownRight } from 'lucide-react'
import { useId, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { GuideWhy } from './guide-parts'
import type { GuideQuestion } from './playbook'
import { lineSlot } from './script-layers'

function FollowUps({ id, question, open }: { id: string; question: GuideQuestion; open: boolean }) {
  return (
    <div
      id={id}
      inert={!open}
      className={cn(
        'grid transition-[grid-template-rows] duration-250',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
      )}
    >
      <div className="min-h-0 overflow-hidden">
        <ul
          aria-label="What to ask next"
          className={cn(
            'mt-2 flex flex-col gap-1.5 border-l pl-3 transition-opacity',
            open ? 'opacity-100' : 'opacity-0',
          )}
        >
          {question.followUps.map((follow) => (
            <li key={follow.answer} className="flex items-start gap-2 text-ui">
              <CornerDownRight
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              />
              <span className="min-w-0">
                <span className="text-muted-foreground">If they say </span>
                <span className="font-semibold">"{follow.answer}"</span>
                <span className="text-muted-foreground">, ask: </span>
                {follow.ask}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function QuestionRow({
  question,
  index,
  asked,
  open,
  onAsked,
  onOpen,
}: {
  question: GuideQuestion
  index: number
  asked: boolean
  open: boolean
  onAsked: (asked: boolean) => void
  onOpen: () => void
}) {
  const id = useId()
  const hasFollowUps = question.followUps.length > 0
  return (
    <li
      data-asked={asked || undefined}
      data-open={open || undefined}
      className={cn(
        'grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 rounded-md border-l-2 py-2 pr-2 pl-2.5 transition-colors',
        open && !asked ? 'border-primary bg-card' : 'border-transparent',
      )}
    >
      <div className="flex h-6 items-center">
        <Checkbox
          checked={asked}
          onCheckedChange={(next) => {
            onAsked(next === true)
          }}
          aria-label={`Asked: ${question.text}`}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <button
          type="button"
          aria-expanded={hasFollowUps ? open : undefined}
          aria-controls={hasFollowUps ? `${id}-next` : undefined}
          onClick={onOpen}
          className={cn(
            'group flex w-full items-start gap-2 rounded-sm text-left text-body transition-colors',
            asked ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="sr-only">Question {index + 1}: </span>
            {question.text}
          </span>
          {hasFollowUps ? (
            <ChevronDown
              aria-hidden="true"
              className={cn(
                'mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-250',
                open && 'rotate-180',
              )}
            />
          ) : null}
        </button>
        <GuideWhy line={question} />
        {hasFollowUps ? <FollowUps id={`${id}-next`} question={question} open={open} /> : null}
      </div>
    </li>
  )
}

/** The guided questions, one open at a time. Ticks last for this card only. */
export function GuidedQuestions({ questions }: { questions: GuideQuestion[] }) {
  const [asked, setAsked] = useState<ReadonlySet<number>>(() => new Set())
  // null: the first question not asked yet is open.
  const [chosen, setChosen] = useState<number | null>(null)
  const next = questions.findIndex((_, index) => !asked.has(index))
  const open = chosen ?? (next === -1 ? null : next)
  const done = asked.size

  if (questions.length === 0) {
    return <p className="text-ui text-muted-foreground">No questions with a source.</p>
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-caption text-muted-foreground tabular-nums" aria-live="polite">
        {done === 0
          ? 'Tick each one as you ask it.'
          : done === questions.length
            ? `All ${String(done)} asked.`
            : `${String(done)} of ${String(questions.length)} asked.`}
      </p>
      <ol className="flex flex-col gap-1">
        {questions.map((question, index) => (
          <QuestionRow
            key={lineSlot('question', index, question)}
            question={question}
            index={index}
            asked={asked.has(index)}
            open={open === index}
            onAsked={(isAsked) => {
              const changed = new Set(asked)
              if (isAsked) changed.add(index)
              else changed.delete(index)
              setAsked(changed)
              // Ticking the open one moves on to the next question not asked.
              if (isAsked && open === index) setChosen(null)
            }}
            onOpen={() => {
              setChosen(open === index ? -1 : index)
            }}
          />
        ))}
      </ol>
    </div>
  )
}
