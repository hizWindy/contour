/**
 * The research card (PLAN-V27 T4-2, choices 18 and 19): "Research Northwind", said or typed, after
 * the command step settled it from what we already know, for free.
 *
 * - **Ask** (a new or quiet company): what we know, line by line with its source and link, then
 *   the one question with the cost, "Research Northwind? About US$0.38.", the dialog's title. Enter,
 *   "yes" or a tap on Start research starts a Lead Finder run of one company (`POST
 *   /companies/assistant/research`, with the card's Idempotency-Key), and the card closes at once:
 *   the run goes on in the background (`research-tray.tsx`), and the Assistant takes the next
 *   command. It is the only question the Assistant asks, because it spends money. Enter does
 *   nothing for the first half second, so the Enter that sent the command never starts a run.
 * - **Can't start** (`can_start` false): what we know, and why (`blocked`), with Close only.
 * - **A maybe** (`choose`): the best guess first, in PLAN-V25's suggestion part, and "It's new".
 *   A pick reads the free block for it (`GET /companies/assistant/research`), and the card goes on
 *   from there: ask, or open the lead card or call prep. The keys 1, 2 and 3 pick.
 * - **HubSpot names stay out of Claude:** the rep's words as heard go with every read and with the
 *   start (`said`), never a choice's HubSpot name; the server works out the run's name.
 * - **"yes" by voice:** after a spoken command the card listens 5 seconds for "yes" or "cancel",
 *   as the review card does for "send it"; in a long conversation its ear reads each turn first,
 *   with no AI, and the voice bar shrinks to its pill beside the card.
 * - **A refusal** (403, 409, 422, 503) shows the problem's own plain words, and nothing starts.
 */
import { Search } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { isAbort, newIdempotencyKey, toApiProblem } from '@/api/client'
import { useCallNoteOptions, voiceToolOf } from '@/api/hooks/call-note-counts'
import { readResearch, startResearch } from '@/api/hooks/assistant'
import type {
  AssistantChoice,
  AssistantCommand,
  AssistantResearch,
  AssistantResearchIn,
} from '@/api/types'
import type { MicEnv } from '@/apps/companies/call-notes/mic/session'
import { pickEngine } from '@/apps/companies/call-notes/mic/voice-engine'
import type { VoiceToolMaker } from '@/apps/companies/call-notes/mic/voice-tool'
import { useCan } from '@/auth/can'
import { MicSheet, MicSheetTitle } from '@/components/motion/mic-sheet'
import { SourceLink } from '@/components/source-link'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import type { BarSession, CardTook } from '../voice/bar-session'
import { failed, ok, unsure, type Reply } from '../voice/live/bridge'
import { RESEARCH_CANCELLED } from '../voice/live/words'
import { ListeningPill } from '../voice/pill'
import { micIsOn, type PillActionId, type PillState } from '../voice/pill-state'
import { pickByKey, suggestionIn } from './keys'
import { listenForSendIt } from './listen'
import { ListenStrip, PartProblem } from './parts'
import { placeOf, startOrNot } from './research-flow'
import { addResearch } from './research-store'
import {
  CHECKING,
  CLOSE,
  ITS_NEW,
  NO_NAME,
  SAY_YES,
  sayYesWords,
  START_RESEARCH,
  startedWords,
  WHAT_WE_KNOW,
} from './research-words'
import { SuggestPart } from './suggest'
import { CARD_TIMES, type CardTimes } from './times'
import { CANCEL, COMPANY, PICK_ONE, WHICH_COMPANY, whichWords } from './words'

/** The card's width, as the review card's. */
const WIDTH = 'w-[min(32rem,calc(100vw-2rem))]'

/** "It's new" among the choices: no company key. */
const NEW = '__new__'

export interface ResearchCardProps {
  command: AssistantCommand
  /** How the command came: after a spoken one, the card listens for "yes". */
  source: 'mic' | 'typed'
  open: boolean
  onClose: () => void
  env?: MicEnv
  makeTool?: VoiceToolMaker | null
  times?: Partial<CardTimes>
  conversation?: BarSession | null
  pill?: PillState | null
}

/** Where the card is. */
type Stage =
  | { kind: 'choose'; level: 'likely' | 'unsure' }
  | { kind: 'checking' }
  | { kind: 'settled'; research: AssistantResearch; key: string }

/** The problem's own plain words: its title, then what to do. */
function problemLine(error: unknown): string {
  const problem = toApiProblem(error)
  return [problem.title, problem.detail].filter(Boolean).join('. ')
}

/** What we know, each line as the server wrote it, with its source's link where there is one. */
function KnownLines({ research }: { research: AssistantResearch }) {
  if (research.known.length === 0) return null
  return (
    <ul
      aria-label={WHAT_WE_KNOW}
      data-slot="research-known"
      className="flex flex-col gap-1.5 text-ui text-foreground"
    >
      {research.known.map((fact) => (
        <li key={`${fact.kind}:${fact.text}`} className="text-pretty">
          {fact.text}
          {fact.url ? (
            <>
              {' '}
              <SourceLink href={fact.url} className="text-caption" />
            </>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

export function ResearchCard({
  command,
  source,
  open,
  onClose,
  env,
  makeTool,
  times,
  conversation = null,
  pill = null,
}: ResearchCardProps) {
  const t: CardTimes = { ...CARD_TIMES, ...times }
  const navigate = useNavigate()
  const canPrep = useCan('companies.call_prep')
  const options = useCallNoteOptions()
  const first = command.research
  const company = command.company
  // The rep's words as heard: they go with every read and with the start, never a HubSpot name.
  const said = (company?.heard ?? '').trim()
  const choices: readonly AssistantChoice[] = company?.choices ?? []

  const [stage, setStage] = useState<Stage>(() =>
    first?.next === 'choose' && choices.length > 0
      ? { kind: 'choose', level: company?.level === 'likely' ? 'likely' : 'unsure' }
      : first
        ? { kind: 'settled', research: first, key: newIdempotencyKey() }
        : { kind: 'checking' },
  )
  // The name the card shows: the company found, the choice picked, or the words as said.
  const [name, setName] = useState(() => company?.found?.name ?? (said || first?.company || ''))
  const [problem, setProblem] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const armed = useRef(false)
  const root = useRef<HTMLDivElement>(null)
  const startButton = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const listenId = useId()
  const reading = useRef<AbortController | null>(null)

  const research = stage.kind === 'settled' ? stage.research : null
  const canStart = research?.next === 'ask' && research.can_start
  const startRef = useRef<() => void>(() => undefined)
  /** The start on its way, and how it went (PLAN-V28 T3-2, for live voice's answer). */
  const startedRef = useRef<Promise<Reply> | null>(null)

  // Enter starts nothing for the first half second (the review card's guard, choice 19).
  useEffect(() => {
    if (!open) return undefined
    const timer = window.setTimeout(() => {
      armed.current = true
    }, t.guard)
    return () => {
      window.clearTimeout(timer)
    }
  }, [open, t.guard])

  useEffect(
    () => () => {
      reading.current?.abort()
    },
    [],
  )

  // Settled after a pick: the choice that had the focus is gone, so it goes to the next step.
  const settledOnce = stage.kind === 'settled' ? stage.research : null
  useEffect(() => {
    if (!settledOnce || settledOnce === first) return
    ;(startButton.current ?? closeButton.current)?.focus()
  }, [settledOnce, first])

  /** A page this research opens (a lead card, call prep): it goes, and the card closes. */
  const goTo = (settled: AssistantResearch, shown: string): boolean => {
    const place = placeOf(settled, shown, canPrep)
    if (!place) return false
    onClose()
    toast(place.line)
    void navigate(place.to)
    return true
  }

  /** A choice picked, or "It's new": the free block for it, then on from there. */
  const pick = (id: string): void => {
    const picked = id === NEW ? null : (choices.find((choice) => choice.key === id) ?? null)
    const shown = picked?.name ?? said
    setName(shown)
    setProblem(null)
    setStage({ kind: 'checking' })
    reading.current?.abort()
    const request = new AbortController()
    reading.current = request
    // The rep's words only: a choice's HubSpot name never leaves for the server's run name
    readResearch(said, picked?.key ?? null, request.signal).then(
      (settled) => {
        if (request.signal.aborted) return
        if (goTo(settled, shown)) return
        setStage({ kind: 'settled', research: settled, key: newIdempotencyKey() })
      },
      (error: unknown) => {
        if (isAbort(error) || request.signal.aborted) return
        setProblem(problemLine(error))
        setStage({
          kind: 'choose',
          level: 'unsure',
        })
      },
    )
  }

  /** Enter, "yes" or a tap: the run starts, and the card closes once the server has it. */
  const start = (): void => {
    if (stage.kind !== 'settled' || !canStart || starting) return
    const { research: settled, key } = stage
    const body: AssistantResearchIn = {
      company: settled.company,
      ...(settled.company_key ? { company_key: settled.company_key } : {}),
      ...(settled.city ? { city: settled.city } : {}),
      ...(said ? { said } : {}),
    }
    setStarting(true)
    setProblem(null)
    // How it went, for live voice's answer (PLAN-V28 T3-2): started, or why not.
    startedRef.current = startResearch(body, key).then(
      (started) => {
        const shown = name || started.company
        addResearch(started.run_id, shown)
        onClose()
        return ok(startedWords(shown))
      },
      (error: unknown) => {
        setStarting(false)
        const line = problemLine(error)
        setProblem(line)
        return failed(line, true)
      },
    )
  }
  useLayoutEffect(() => {
    startRef.current = start
  })

  // After a spoken command, the card listens 5 seconds for "yes" or "cancel" (as the review
  // card's "send it", choice 23), once the voice tool is known and can run here. Never while a
  // conversation listens: its ear reads the turns instead (below).
  const tool = voiceToolOf(options.data)
  const [inConversation] = useState(() => conversation?.isLive() === true)
  const [listenOver, setListenOver] = useState(false)
  const canListen =
    source === 'mic' &&
    open &&
    canStart &&
    !options.isPending &&
    tool !== 'typing' &&
    pickEngine(tool, env) !== null &&
    !inConversation
  const listening = canListen && !listenOver
  const stopListen = useRef<((quietly?: boolean) => void) | null>(null)
  useEffect(() => {
    if (!canListen) return undefined
    const stop = listenForSendIt({
      onSend: () => {
        startRef.current()
      },
      onCancel: onClose,
      onEnd: () => {
        setListenOver(true)
      },
      tool,
      ...(env ? { env } : {}),
      ...(makeTool === undefined ? {} : { makeTool }),
      ms: t.listen,
      read: (text) => {
        const answer = startOrNot(text)
        return answer === 'start' ? 'send' : answer
      },
    })
    stopListen.current = stop
    return () => {
      stopListen.current = null
      stop(true)
    }
    // Once, as the card can listen: a key or a click ends it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canListen])
  const stopListening = (): void => {
    stopListen.current?.()
  }

  // In a long conversation, the card hears each turn first, with no AI (as the review card,
  // PLAN-V24 T2-3): "yes" starts, "cancel" closes, and anything else is asked again, so a new
  // command waits for this one. In live voice it reads the rep's own words only, never Gemini's
  // (PLAN-V28 choice 7), and says what it did back (`reply`): a research starts on the rep's "yes".
  const takeRef = useRef<(words: string) => CardTook>(() => ({ line: null }))
  useLayoutEffect(() => {
    takeRef.current = (words) => {
      const answer = startOrNot(words)
      if (stage.kind === 'choose') {
        const suggestion = suggestionIn(root.current, 'company')
        if (answer === 'start' && suggestion) {
          suggestion.click()
          return { line: null, reply: ok(CHECKING) }
        }
        if (answer === 'cancel') {
          onClose()
          return { line: null, reply: ok(RESEARCH_CANCELLED) }
        }
        return { line: PICK_ONE, reply: unsure(PICK_ONE) }
      }
      if (answer === 'cancel') {
        onClose()
        return { line: null, reply: ok(RESEARCH_CANCELLED) }
      }
      if (answer === 'start' && canStart) {
        startRef.current()
        return { line: null, reply: startedRef.current ?? ok(CHECKING) }
      }
      if (canStart) return { line: sayYesWords(name), reply: unsure(sayYesWords(name)) }
      // Still reading what we know about a pick: it says so, and asks nothing yet.
      if (stage.kind === 'checking') return { line: null, reply: unsure(CHECKING) }
      return { line: null, reply: failed(research?.blocked ?? NO_NAME) }
    }
  })
  useEffect(() => {
    if (!conversation || !open) return undefined
    return conversation.attachCard({
      take: (words) => takeRef.current(words),
      // Never asked: the card answers every turn itself, above.
      card: () => ({ action: 'task', boxes: [] }),
      answer: () => ({ kind: 'close' }),
      every: true,
    })
  }, [conversation, open])

  const pillShown = pill !== null && micIsOn(pill.snapshot)
  const backToCard = (): void => {
    ;(startButton.current ?? closeButton.current)?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    stopListening()
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
    if (plain && pickByKey(root.current, event.key)) {
      event.preventDefault()
      return
    }
    if (event.key !== 'Enter' || !plain) return
    if (event.repeat || !armed.current) {
      // The Enter that sent the command, or one held down: it starts nothing.
      event.preventDefault()
      return
    }
    const target = event.target instanceof Element ? event.target : null
    // On another button or a link, Enter does what that does.
    if (target?.closest('button, a') && target.closest('button') !== startButton.current) return
    if (stage.kind === 'settled' && canStart) {
      event.preventDefault()
      start()
      return
    }
    if (stage.kind === 'choose') {
      const suggestion = suggestionIn(root.current, 'company')
      if (suggestion) {
        event.preventDefault()
        suggestion.click()
      }
    }
  }

  // The dialog's title: the question with the cost, why it can't start, or where it is.
  const title =
    stage.kind === 'checking'
      ? CHECKING
      : stage.kind === 'choose'
        ? command.read_back || whichWords(said, WHICH_COMPANY)
        : stage.research.next === 'needs_name'
          ? command.read_back || NO_NAME
          : stage.research.question && canStart
            ? stage.research.question
            : (stage.research.blocked ?? stage.research.known[0]?.text ?? NO_NAME)

  return (
    <MicSheet
      open={open}
      opener={null}
      className={WIDTH}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      onKeyDown={onKeyDown}
      describedBy={listening ? listenId : undefined}
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        const choice =
          root.current?.querySelector<HTMLElement>('[data-slot=suggest-use]') ??
          root.current?.querySelector<HTMLElement>('[data-slot=card-choice]')
        ;(startButton.current ?? choice ?? closeButton.current)?.focus()
      }}
      aside={
        <ListeningPill
          shown={pillShown}
          state={pill}
          hint={SAY_YES}
          hintId={listenId}
          onStop={() => {
            backToCard()
            pill?.stop()
          }}
          onAct={(id: PillActionId) => {
            backToCard()
            pill?.act(id)
          }}
        />
      }
    >
      <div
        ref={root}
        data-slot="review-card"
        data-action="research"
        className="flex min-h-0 flex-col"
        onPointerDown={stopListening}
      >
        <div className="flex flex-col gap-4 p-5">
          {stage.kind === 'settled' && stage.research.next !== 'needs_name' ? (
            <KnownLines research={stage.research} />
          ) : null}
          <MicSheetTitle
            data-slot="research-question"
            className={stage.kind === 'checking' ? 'text-ui text-muted-foreground' : 'text-body'}
          >
            {title}
          </MicSheetTitle>
          {stage.kind === 'choose' && company ? (
            <SuggestPart
              box="company"
              label={COMPANY}
              level={stage.level}
              suggestion={choices[0]?.name}
              reason={company.reason}
              question={whichWords(said, WHICH_COMPANY)}
              choices={choices.map((choice) => ({
                id: choice.key,
                title: choice.name,
                detail: choice.detail ?? choice.city,
              }))}
              extra={{ id: NEW, title: ITS_NEW }}
              extraBeside
              onPick={pick}
              onTurnDown={() => {
                setStage({ kind: 'choose', level: 'unsure' })
              }}
            />
          ) : null}
          {problem ? <PartProblem>{problem}</PartProblem> : null}
          {listening ? <ListenStrip id={listenId} ms={t.listen} words={SAY_YES} /> : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
          <Button
            ref={canStart ? undefined : closeButton}
            type="button"
            variant="outline"
            size="sm"
            className="touch:h-11"
            aria-keyshortcuts="Escape"
            onClick={onClose}
          >
            {canStart || stage.kind !== 'settled' ? CANCEL : CLOSE}
          </Button>
          {canStart ? (
            <Button
              ref={startButton}
              type="button"
              size="sm"
              className="touch:h-11"
              aria-keyshortcuts="Enter"
              disabled={starting}
              onClick={start}
            >
              <Search aria-hidden="true" />
              {START_RESEARCH}
              <Kbd aria-hidden="true" className="touch:hidden">
                Enter
              </Kbd>
            </Button>
          ) : null}
        </div>
      </div>
    </MicSheet>
  )
}
