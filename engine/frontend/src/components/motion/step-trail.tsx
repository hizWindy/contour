/**
 * Steps in a row, each with a dot that fills when the page says its state has arrived (PLAN-V18
 * T2-2): the pre-read's "Reading HubSpot", "Writing the summaries" and "Ready for you to check"
 * while the AI drafts it. Nothing fills on a timer: `reached` is how many steps have arrived, read
 * from the server, and the newest of them is where things stand now.
 *
 * - **A dot fills** as its step arrives: the dot inside the ring grows from its centre on the
 *   `soft` spring (350ms, bounce 0.1, a tick's spring), and the line from the step before fills
 *   along to it on `snappy`. Only `transform` moves (a scale), never a width. A step that had
 *   arrived before the trail first showed is simply filled.
 * - **The look:** the fill is the accent, as progress is (DESIGN.md "The accent"). Steps still to
 *   come are empty rings with quiet words, and the newest step reads in the text's full colour.
 * - **A failure** stops the trail at its step: that dot becomes a Terracotta cross, and the steps
 *   after it stay empty. The page says why beside it, in plain words.
 * - **Screen readers** hear each step with its state ("done", "in progress", "not yet", "stopped
 *   here"), and a step that arrives is said once, politely. The dots are hidden from them.
 *
 * With reduced motion the dots are simply filled and the words change.
 */
import { CircleX } from 'lucide-react'
import { m } from 'motion/react'
import { cn } from '@/lib/utils'
import { springs } from './springs'
import { useStill } from './use-still'

export type StepState = 'done' | 'now' | 'waiting' | 'stopped'

/** What a screen reader hears after each step's words. */
const STEP_STATE_WORDS: Readonly<Record<StepState, string>> = {
  done: 'done',
  now: 'in progress',
  waiting: 'not yet',
  stopped: 'stopped here',
}

export interface StepTrailProps {
  /** The steps' words, in order, like "Reading HubSpot". */
  steps: readonly string[]
  /** How many steps have arrived, from 0 to all of them. */
  reached: number
  /** The newest step that arrived failed: the trail stops there. */
  failed?: boolean
  /** Names the list for a screen reader. */
  'aria-label': string
  className?: string
}

/** How many steps have arrived, held to 0 and the number of steps. */
function heldReached(count: number, reached: number): number {
  return Number.isFinite(reached) ? Math.min(count, Math.max(0, Math.floor(reached))) : 0
}

/**
 * Each step's state for a count of steps reached. The newest step reached is in progress, unless
 * it is the last one (the trail is done) or it failed.
 */
function stepStates(count: number, reached: number, failed = false): StepState[] {
  const held = heldReached(count, reached)
  return Array.from({ length: count }, (_, index) => {
    if (index >= held) return 'waiting'
    if (index < held - 1) return 'done'
    if (failed) return 'stopped'
    return held === count ? 'done' : 'now'
  })
}

function arrived(state: StepState | undefined): boolean {
  return state === 'done' || state === 'now'
}

/** A ring, with a dot in it once the step has arrived. Hidden from screen readers. */
function Dot({ state, still }: { state: StepState; still: boolean }) {
  if (state === 'stopped') {
    return (
      <CircleX
        aria-hidden="true"
        data-slot="step-dot"
        data-state={state}
        className="size-4 shrink-0 text-destructive"
      />
    )
  }
  const filled = arrived(state)
  return (
    <svg
      aria-hidden="true"
      data-slot="step-dot"
      data-state={state}
      viewBox="0 0 16 16"
      className={cn(
        'size-4 shrink-0 transition-colors',
        filled ? 'text-progress' : 'text-muted-foreground',
      )}
    >
      <circle cx={8} cy={8} r={7} fill="none" stroke="currentColor" strokeWidth={1.5} />
      {still ? (
        filled ? (
          <circle data-slot="step-fill" cx={8} cy={8} r={4} fill="currentColor" />
        ) : null
      ) : (
        <m.circle
          data-slot="step-fill"
          cx={8}
          cy={8}
          r={4}
          fill="currentColor"
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          initial={false}
          animate={{ scale: filled ? 1 : 0 }}
          transition={springs.soft}
        />
      )}
    </svg>
  )
}

/** The line from a step to the next: it fills along once the next step has arrived. */
function Line({ full, still }: { full: boolean; still: boolean }) {
  const fill = 'absolute inset-0 origin-left bg-progress'
  return (
    <span
      aria-hidden="true"
      data-slot="step-line"
      className="relative mx-1.5 h-0.5 min-w-2 flex-1 overflow-hidden bg-border"
    >
      {still ? (
        <span className={cn(fill, full ? 'scale-x-100' : 'scale-x-0')} />
      ) : (
        <m.span
          className={fill}
          initial={false}
          animate={{ scaleX: full ? 1 : 0 }}
          transition={springs.snappy}
        />
      )}
    </span>
  )
}

export function StepTrail({
  steps,
  reached,
  failed = false,
  className,
  'aria-label': label,
}: StepTrailProps) {
  const still = useStill()
  const states = stepStates(steps.length, reached, failed)
  const newest = heldReached(steps.length, reached) - 1
  // Said once as a step arrives. A failure is said by the page, with why.
  const heard = !failed && newest >= 0 ? (steps[newest] ?? '') : ''
  return (
    <div data-slot="step-trail" className={cn('flex flex-col', className)}>
      <ol aria-label={label} className="grid auto-cols-fr grid-flow-col">
        {steps.map((step, index) => {
          const state = states[index] ?? 'waiting'
          const next = states[index + 1]
          return (
            <li key={step} data-state={state} className="flex min-w-0 flex-col gap-2">
              <span className="flex items-center">
                <Dot state={state} still={still} />
                {index < steps.length - 1 ? (
                  <Line full={arrived(next) || next === 'stopped'} still={still} />
                ) : null}
              </span>
              <span
                className={cn(
                  'pr-3 text-caption text-pretty',
                  index === newest ? 'font-semibold text-foreground' : null,
                  index < newest ? 'text-foreground' : null,
                  index > newest ? 'text-muted-foreground' : null,
                )}
              >
                {step}
                <span className="sr-only">{`, ${STEP_STATE_WORDS[state]}`}</span>
              </span>
            </li>
          )
        })}
      </ol>
      <p role="status" className="sr-only">
        {heard}
      </p>
    </div>
  )
}
