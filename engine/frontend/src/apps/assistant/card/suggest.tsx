/**
 * The suggestion part (PLAN-V25 T1-2 and T2-2, choices 4 to 7 and 11): one look for everything the
 * command step wasn't sure of: a company, a person, a teammate and a meeting (and, in Part 3, a
 * day). It follows the find's level (choice 1):
 *
 * - **Likely:** one suggestion with its reason in the quieter colour, "Sample Logistics Pty Ltd?
 *   You meet them at 2 pm.", with "Use it" and "Not this one". Enter (`trySend` in `card.tsx`),
 *   "yes" said into the bar (`choose.ts`) or a tap takes it. "Not this one" shows the other choices,
 *   with Search.
 * - **Unsure:** the question ("Which Sample?"), up to 3 choices, each with the one detail that
 *   tells it apart, and Search. The keys 1, 2 and 3 pick (`pickByKey`), and so do "the second one"
 *   or a name said.
 * - **Sure** (`SureLine`): used at once, "Sample Logistics Pty Ltd. On screen.", with Change and
 *   Undo (DESIGN.md "Act at once, undo after").
 *
 * The highlight slides between the choices after the pointer or the keyboard (`layoutId`, on the
 * `snappy` spring); with reduced motion it simply moves. A screen reader hears the suggestion once:
 * it is "Use it"'s description, and the server's own line for it is left out of the card's
 * paragraph (`lines.ts`). Send stays the card's one Navy button: these are outline and ghost.
 * Plain words, no banned icon, the 10px corner (DESIGN.md "Banned").
 */
import { m } from 'motion/react'
import { Check, Search } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react'
import { springs } from '@/components/motion/springs'
import { useStill } from '@/components/motion/use-still'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import type { Box } from './draft'
import { MOST_CHOICES } from './keys'
import { CHANGE, NOT_THIS_ONE, SEARCH, UNDO_PICK, USE_IT } from './words'

export interface SuggestChoice {
  id: string
  title: string
  /** The one detail that tells it apart: a city, an owner, a last call, a company. */
  detail?: string | null
}

export interface SuggestPartProps {
  /** Where Enter goes before a send (`data-box`). */
  box: Box
  /** The quiet label over the suggestion, like "Company" or "Who". */
  label: string
  level: 'likely' | 'unsure'
  /** Likely: the first choice in words, like "Jo Sample at Northwind Sample Pty Ltd". */
  suggestion?: string
  /** Likely: why, like "You meet them at 2 pm.". */
  reason?: string | null
  /** Unsure: the question, like "Which Sample?". It names the choices. */
  question: string
  /** Best first. For likely, the first is the suggestion. At most 3 show. */
  choices: readonly SuggestChoice[]
  /** After the choices, not numbered: "No one in particular". */
  extra?: SuggestChoice | null
  /** The choice that is the card's now (Change on a sure pick): the highlight starts there. */
  current?: string | null
  onPick: (id: string) => void
  /** "Not this one". */
  onTurnDown?: () => void
  /** Search: a search list in this part's place. Null: none here. */
  onSearch?: (() => void) | null
  /** Put the focus in the part as it shows (after Undo, or a suggestion turned down). */
  autoFocus?: boolean
}

/** The part's first thing to focus: its first choice, else Search, else "Use it". */
function firstFocusable(root: HTMLElement | null): HTMLElement | null {
  return (
    root?.querySelector<HTMLElement>('[data-slot=card-choice]') ??
    root?.querySelector<HTMLElement>('[data-slot=suggest-search]') ??
    root?.querySelector<HTMLElement>('[data-slot=suggest-use]') ??
    null
  )
}

/** One choice: its key cap, its name and its detail, over the sliding highlight. */
function ChoiceButton({
  choice,
  n,
  lit,
  current,
  layoutId,
  onPick,
  onLight,
}: {
  choice: SuggestChoice
  /** 1, 2 or 3: its key. Null: no key (the extra). */
  n: number | null
  lit: boolean
  current: boolean
  layoutId: string
  onPick: () => void
  onLight: () => void
}) {
  const still = useStill()
  const highlight = 'pointer-events-none absolute inset-0 rounded-[inherit] bg-muted'
  return (
    <Button
      type="button"
      variant="outline"
      data-slot="card-choice"
      data-choice={choice.id}
      data-n={n ?? undefined}
      aria-current={current ? 'true' : undefined}
      aria-keyshortcuts={n ? String(n) : undefined}
      // The highlight is the hover: it slides from choice to choice.
      className="relative h-auto min-h-11 justify-start gap-3 py-2 text-left whitespace-normal hover:bg-card"
      onClick={onPick}
      onPointerEnter={onLight}
      onFocus={onLight}
    >
      {lit ? (
        still ? (
          <span aria-hidden="true" data-slot="choice-highlight" className={highlight} />
        ) : (
          <m.span
            aria-hidden="true"
            data-slot="choice-highlight"
            layoutId={layoutId}
            transition={springs.snappy}
            className={highlight}
          />
        )
      ) : null}
      {n ? (
        <Kbd aria-hidden="true" className="relative touch:hidden">
          {n}
        </Kbd>
      ) : null}
      <span className="relative flex min-w-0 flex-1 flex-col items-start">
        <span className="font-semibold">{choice.title}</span>
        {choice.detail ? (
          <span className="text-caption font-normal text-muted-foreground">{choice.detail}</span>
        ) : null}
      </span>
      {/* The one in use (Change): a tick as well as the highlight, never colour alone. A screen
          reader hears it from aria-current. */}
      {current ? <Check aria-hidden="true" className="relative text-muted-foreground" /> : null}
    </Button>
  )
}

/** The choices as buttons: the arrow keys move, 1 to 3, Enter or a tap picks. */
function Choices({
  question,
  choices,
  extra,
  current,
  box,
  onPick,
}: {
  question: string
  choices: readonly SuggestChoice[]
  extra: SuggestChoice | null
  current: string | null
  box: Box
  onPick: (id: string) => void
}) {
  const questionId = useId()
  const layoutId = `choice-highlight-${useId()}`
  const group = useRef<HTMLDivElement>(null)
  const [lit, setLit] = useState<string | null>(null)
  const shown = choices.slice(0, MOST_CHOICES)
  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? -1
          : 0
    if (step === 0) return
    const buttons = [...(group.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    if (buttons.length === 0) return
    const at = buttons.findIndex((button) => button === document.activeElement)
    event.preventDefault()
    buttons[at === -1 ? 0 : (at + step + buttons.length) % buttons.length]?.focus()
  }
  // The pointer gone, the highlight goes back to the focus, or to the card's pick now.
  const settle = (): void => {
    const focused = group.current?.querySelector<HTMLElement>(':focus')
    setLit(focused?.dataset.choice ?? null)
  }
  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget)) setLit(null)
  }
  const all = extra ? [...shown, extra] : shown
  const showing = lit ?? current
  return (
    <div className="flex flex-col gap-2">
      <p id={questionId} className="text-ui font-semibold text-pretty text-foreground">
        {question}
      </p>
      <div
        ref={group}
        role="group"
        aria-labelledby={questionId}
        data-box={box}
        className="flex flex-col gap-1"
        onKeyDown={move}
        onPointerLeave={settle}
        onBlur={onBlur}
      >
        {all.map((choice, index) => (
          <ChoiceButton
            key={choice.id}
            choice={choice}
            n={index < shown.length ? index + 1 : null}
            lit={showing === choice.id}
            current={current === choice.id}
            layoutId={layoutId}
            onPick={() => {
              onPick(choice.id)
            }}
            onLight={() => {
              setLit(choice.id)
            }}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * The suggestion part: one suggestion with its reason (likely), or up to 3 choices and Search
 * (unsure). "Not this one" makes it unsure, through `onTurnDown`, and the focus goes to the first
 * choice left, or to Search.
 */
export function SuggestPart({
  box,
  label,
  level,
  suggestion,
  reason,
  question,
  choices,
  extra = null,
  current = null,
  onPick,
  onTurnDown,
  onSearch = null,
  autoFocus = false,
}: SuggestPartProps) {
  const root = useRef<HTMLDivElement>(null)
  const labelId = useId()
  const lineId = useId()
  const [first] = choices
  const likely = level === 'likely' && first !== undefined
  // Turned down: the focus goes on to what shows next, so the keyboard carries on from there. As
  // it shows after Undo, or once a suggestion was turned down to Search, the same.
  const wasLikely = useRef(likely)
  useEffect(() => {
    const was = wasLikely.current
    wasLikely.current = likely
    if (was && !likely) firstFocusable(root.current)?.focus()
  }, [likely])
  useEffect(() => {
    if (autoFocus) firstFocusable(root.current)?.focus()
  }, [autoFocus])

  if (likely) {
    const why = reason?.trim()
    return (
      <div
        ref={root}
        role="group"
        aria-labelledby={labelId}
        data-slot="suggest"
        data-level="likely"
        data-box={box}
        className="flex flex-col gap-2"
      >
        <span id={labelId} className="text-caption text-muted-foreground">
          {label}
        </span>
        <p id={lineId} data-slot="suggestion" className="text-ui text-pretty text-foreground">
          {`${suggestion ?? first.title}?`}
          {why ? <span className="text-muted-foreground">{` ${why}`}</span> : null}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-slot="suggest-use"
            className="touch:h-11"
            aria-describedby={lineId}
            onClick={() => {
              onPick(first.id)
            }}
          >
            {USE_IT}
            <Kbd aria-hidden="true" className="touch:hidden">
              Enter
            </Kbd>
          </Button>
          {onTurnDown ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-slot="suggest-not"
              className="touch:h-11"
              onClick={onTurnDown}
            >
              {NOT_THIS_ONE}
            </Button>
          ) : null}
        </div>
      </div>
    )
  }
  return (
    <div ref={root} data-slot="suggest" data-level="unsure" className="flex flex-col gap-2">
      {choices.length > 0 || extra ? (
        <Choices
          question={question}
          choices={choices}
          extra={extra}
          current={current}
          box={box}
          onPick={onPick}
        />
      ) : (
        <p className="text-ui font-semibold text-pretty text-foreground">{question}</p>
      )}
      {onSearch ? (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-slot="suggest-search"
            // With no choice left, Enter comes here.
            data-box={choices.length > 0 || extra ? undefined : box}
            className="touch:h-11"
            onClick={onSearch}
          >
            <Search aria-hidden="true" />
            {SEARCH}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * A sure pick, used at once (choice 1): its name, its reason in the quieter colour ("Sample
 * Logistics Pty Ltd. On screen."), Change (which opens `children`, the choices) and Undo.
 */
export function SureLine({
  label,
  name,
  reason,
  note = null,
  changing,
  onChange,
  onUndo,
  changeRef,
  children = null,
}: {
  label: string
  name: string
  reason?: string | null
  /** A line under it, like "Northwind is new in HubSpot. We'll use it." */
  note?: ReactNode
  changing: boolean
  onChange: () => void
  onUndo: () => void
  changeRef?: Ref<HTMLButtonElement>
  children?: ReactNode
}) {
  const why = reason?.trim()
  return (
    <div data-slot="sure" className="flex flex-col gap-1">
      <span className="text-caption text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p data-slot="sure-line" className="min-w-0 flex-1 text-ui text-pretty text-foreground">
          {why ? `${name}.` : name}
          {why ? <span className="text-muted-foreground">{` ${why}`}</span> : null}
        </p>
        <div className="flex items-center gap-1">
          <Button
            ref={changeRef}
            type="button"
            variant="ghost"
            size="sm"
            data-slot="sure-change"
            className="touch:h-11"
            aria-expanded={changing}
            onClick={onChange}
          >
            {CHANGE}
            <span className="sr-only">{`: ${label}`}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-slot="sure-undo"
            className="touch:h-11"
            onClick={onUndo}
          >
            {UNDO_PICK}
            <span className="sr-only">{`: ${name}`}</span>
          </Button>
        </div>
      </div>
      {note}
      {changing ? <div className="pt-2">{children}</div> : null}
    </div>
  )
}
