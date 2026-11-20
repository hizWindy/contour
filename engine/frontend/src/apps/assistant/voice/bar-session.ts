/**
 * One opening of the voice bar (PLAN-V22 T3-1 and T3-2): the mic, the words, when the talk ends,
 * the text line, the command step, and where its answer goes. Plain code, like the mic card's
 * `MicSession`, which it uses for the mic itself. The bar shows its snapshot and calls its methods,
 * so the tests run it with a fake mic, a fake voice tool and a fake clock.
 *
 * - **It listens** through `MicSession`: the mic check (each line passed by its real result), the
 *   bars, the voice tool and the name fix. The words count from the moment the mic is allowed.
 * - **The talk ends** after about 1.5 seconds with no new words (S1 may change it), at 60 seconds
 *   (TBC), or on V: the words are kept and go to the command step. Esc throws them away. With no
 *   word at all 6 seconds after the mic opened (TBC), it heard nothing.
 * - **Typing always works.** "Type instead" stops the mic and puts the words so far in the text
 *   line. Where the voice can't work (no speech service in this browser, a voice tool that isn't
 *   built, or a mic that can't be used), the bar opens on the text line and says why.
 * - **Working it out:** the words go to the command step with what is on screen (`on_page`). Its
 *   answer goes to `handOver` (`hand-over.ts`), the seam the review card fills (T3-3).
 * - **The mic is let go** as soon as the talk is over: on Esc at once, and after V or a silence as
 *   soon as the last words are written out. Our code never keeps or sends the sound: only the
 *   words go to the server.
 * - **Hold V** (PLAN-V23 choice 6): the V that started listening, still down after 0.4 seconds
 *   (TBC), is a hold. While it is held, no silence ends the talk; letting go does. A tap works as
 *   before. The bar tells the session about the key (`vDown`, `vUp`).
 * - **The names** (PLAN-V23 T1-5): the names on screen and the hint list, for the name fix, and
 *   the hint list for the speech service (on-device mode only). The hint list may come in after
 *   the bar opened (`setNames`).
 * - **Unclear words** (PLAN-V23 T1-6): the answer `unclear` stops before the card. The words wait
 *   in the text line, with the stop line and "Say it again".
 *
 * PLAN-V24 Part 2, **a long conversation** (`conversation`, from "Keep listening"):
 *
 * - **One mic for the whole conversation** (choice 5): a tap of V starts it, and the mic, the bars
 *   and the voice tool run until it ends. Each turn is handed over (`MicSession.handOver`), and the
 *   next starts at once, with no check and no second mic.
 * - **A turn ends after a smart pause** (choice 8, T2-2, `pauses.ts`): 1.2 seconds when the words
 *   sound finished, 3 seconds when they end on a joining word or a half command ("log a call
 *   with"), both TBC at S1. While V is held, no pause ends it. A turn also ends at 2 minutes
 *   (choice 9, TBC). Over the server's 2,000 characters, the words wait in the text line with the
 *   plan's line, and listening stops.
 * - **Turns are read in order** (choice 12): a turn said while the last is worked out waits for it.
 *   What each answer does is `handOver`'s, as with one command. A page opens and the conversation
 *   goes on; a card that can't hear the conversation (a pre-read's, `cardOpen`) ends it.
 * - **The review card hears it** (choice 13, T2-3): while a card is open, its ear (`attachCard`)
 *   reads each turn first, with no AI ("send it", "later", its choice), and anything else goes to
 *   the command step with the card's boxes, as a change. A turn said while the card is on its way
 *   waits for it. After the card closes, the next turn is a new command.
 * - **The code reads some turns itself** (choices 10, 11): "stop listening" or "that's all" ends
 *   the conversation and sends nothing, and fewer than 2 real words are dropped quietly.
 * - **It ends** on V or Stop (the turn in progress goes first), "stop listening" or "that's all",
 *   or 2 minutes with no words (TBC: "Stopped listening after 2 minutes of quiet.", with Start
 *   again). Turns already said are still worked out. Esc throws away the turn and everything still
 *   on its way, and closes the bar, as it did. A problem ends it too, with its words and buttons.
 * - **Hold V is one turn** (choice 7): held, it is today's one command, up to 2 minutes.
 * - **Phones and windows** (choices 15, 16, T2-5, `screen.ts`): the screen is kept on while it
 *   listens (the wake lock), and let go at every end; a refused one changes nothing else. On a
 *   phone, leaving the page ends it with the words kept ("The mic stopped when you left the page.",
 *   with Carry on); on a laptop, another window in front doesn't (TBC at S1).
 */
import { isAbort, toApiProblem } from '@/api/client'
import type {
  AssistantCardIn,
  AssistantCommand,
  AssistantCommandIn,
  AssistantOnPage,
  CommandSource,
  VoiceToolKind,
} from '@/api/types'
import {
  browserEnv,
  MicSession,
  type MicEnv,
  type MicSnapshot,
} from '@/apps/companies/call-notes/mic/session'
import type { NameFix } from '@/apps/companies/call-notes/mic/name-fix'
import type { VoiceToolMaker } from '@/apps/companies/call-notes/mic/voice-tool'
import type { MicProblem } from '@/apps/companies/call-notes/mic/words'
import type { AfterAnswer, Heard } from './hand-over'
import { pauseFor } from './pauses'
import { browserScreen, type KeptOn, type ScreenEnv } from './screen'
import { endsConversation, isShortTurn } from './turns'

export const TIMES = {
  /** No new words for this long ends the talk (PLAN-V22 T3-1: about 1.5 seconds, S1 may change it). */
  silence: 1500,
  /** No word at all this long after the mic opened: nothing was heard (TBC). */
  firstWords: 6000,
  /** The longest talk (TBC). */
  limit: 60_000,
  /** V still down this long is a hold: letting go ends the talk (PLAN-V23 choice 6, TBC). */
  hold: 400,
  /** A conversation's turn ends after this pause, when its words sound finished (choice 8, TBC). */
  pause: 1200,
  /**
   * The pause when they sound unfinished: a joining word at the end, or a half command, like "log a
   * call with" (choice 8, TBC at S1).
   */
  longPause: 3000,
  /** The longest turn of a conversation, and of a held V while it keeps listening (choice 9, TBC). */
  turn: 120_000,
  /** No words this long ends a conversation: the quiet stop (choice 10, TBC). */
  quiet: 120_000,
}

export type Times = typeof TIMES

/** The longest command the server takes, in characters. */
export const MAX_CHARS = 2000

/**
 * starting   the mic is opening: "Looking for a mic", "Asking to use the mic"
 * listening  "Listening": the bars and the words as they come
 * working    "Working it out": the last words, then the command step
 * typing     the text line
 * problem    what went wrong, with its buttons
 * answer     a line from the command step (until the review card, T3-3)
 */
export type BarPhase = 'starting' | 'listening' | 'working' | 'typing' | 'problem' | 'answer'

export type BarProblem =
  /** The talk ended with no words. */
  | { kind: 'nothing_heard' }
  /** Over the command step's limit of commands a minute. */
  | { kind: 'too_many' }
  /** Claude was slow or down, or the answer didn't come in time. The words are kept. */
  | { kind: 'too_slow' }
  /** The mic's own problem, with PLAN-V18's words. */
  | { kind: 'mic'; problem: MicProblem }
  /** The voice tool isn't built here (Whisper waits for S1): the text line only. */
  | { kind: 'no_voice' }
  /** Anything else, in the server's own words or the website's. */
  | { kind: 'other'; title: string; detail: string | null; resend: boolean }
  /**
   * The command step couldn't make a command of the words (PLAN-V23 T1-6): its stop line. The
   * words wait in the text line.
   */
  | { kind: 'unclear'; line: string }
  /** A conversation heard no words for 2 minutes and stopped (PLAN-V24 choice 10). */
  | { kind: 'quiet' }
  /** The words are over the server's 2,000 characters: they wait in the text line (choice 9). */
  | { kind: 'too_long' }
  /** A phone left the page (locked, or another app in front): the words so far are kept (T2-5). */
  | { kind: 'left' }

export interface ShownAnswer {
  line: string
  unsure: string | null
  /** Offer Try again: the command step didn't find an action in the words. */
  again: boolean
}

/** A conversation while it listens (PLAN-V24 Part 2). */
export interface ConversationSnapshot {
  /** The words of the turn the command step is working out, or null. */
  working: string | null
  /** Turns said since, waiting for it (choice 12). */
  waiting: number
  /** What the conversation said last, like a read-back: shown until the next one. */
  line: string | null
  /** How many turns it has taken: the examples of what to say are for the first only. */
  turns: number
}

export interface BarSnapshot {
  phase: BarPhase
  /** The mic while it is in use: the check, the bars, the words as they come. */
  mic: MicSnapshot | null
  /** The words, once the talk is over or the text line was sent. */
  words: string
  /** The text line. */
  draft: string
  problem: BarProblem | null
  answer: ShownAnswer | null
  /** The voice can work here. False: the bar is the text line only. */
  voice: boolean
  /** Names the mic heard nearly right and the name fix put right, kept once the talk is over. */
  fixes: readonly NameFix[]
  /** The conversation, while one listens (PLAN-V24 Part 2). Null: one command per V. */
  conversation: ConversationSnapshot | null
}

/** The review card open now: one that hears the conversation, another kind, or none. */
export type CardShown = 'hears' | 'other' | null

/** What the card says back to a turn it read itself: a line ("Sent."), or none. */
export interface CardTook {
  line: string | null
}

/** A review card open in the conversation (T2-3): it hears each turn first. */
export interface CardEar {
  /**
   * The card's own reading of a turn, with no AI: "send it", "later" or "cancel", or its choice
   * (T2-4). Null: the turn isn't one of those, and goes to the command step.
   */
  take: (words: string) => CardTook | null
  /** The card's action and the names of its boxes, for the command step. */
  card: () => AssistantCardIn
  /** The command step's answer to a turn said to the card: a change, a send, a new command. */
  answer: (heard: Heard) => AfterAnswer | Promise<AfterAnswer>
}

export interface BarSessionOptions {
  /** What is on screen, for a command that names no company. */
  onPage?: AssistantOnPage | null
  /**
   * What is on screen now, read at each turn of a conversation, which may cross pages. Left out:
   * `onPage`, as the bar opened.
   */
  where?: () => AssistantOnPage | null
  /** The names on screen and the hint list's, for the name fix. */
  names?: readonly string[]
  /** The hint list, for the speech service (on-device mode only, PLAN-V23 T1-5). */
  hints?: readonly string[]
  /** Reads a command: the command step, or a test's fake. */
  read: (body: AssistantCommandIn, signal: AbortSignal) => Promise<AssistantCommand>
  /**
   * Where an answer goes (`handOver`, or the review card's own). A promise keeps "Working it out"
   * on until it settles, like a pre-read that has to start first.
   */
  hand: (heard: Heard) => AfterAnswer | Promise<AfterAnswer>
  /**
   * The review card that is open, while the rep speaks a change to it (T3-3): its action and the
   * names of its boxes go with the words, so the command step answers change, send or cancel.
   */
  card?: AssistantCardIn | null
  /**
   * "Keep listening" (PLAN-V24 choice 6): a V starts a conversation that listens across commands.
   * Left out or false: one command per V, as before.
   */
  conversation?: boolean
  /** The review card open now. A card that can't hear the conversation ends it. */
  cardOpen?: () => CardShown
  /** The bar is done with: it closes. */
  onClose: () => void
  /** For tests: the browser, the voice tool and the clock's waits. */
  env?: MicEnv
  makeTool?: VoiceToolMaker | null
  times?: Partial<Times>
  /** For tests: the screen (the wake lock, a hidden page, a phone). */
  screen?: ScreenEnv
}

const STARTING: BarSnapshot = {
  phase: 'starting',
  mic: null,
  words: '',
  draft: '',
  problem: null,
  answer: null,
  voice: true,
  fixes: [],
  conversation: null,
}

const NEW_CONVERSATION: ConversationSnapshot = { working: null, waiting: 0, line: null, turns: 0 }

/** The words alone, for telling new words from the same words written out ("Log a call."). */
function wordsOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

type TimerName = 'silence' | 'first' | 'limit' | 'turn' | 'quiet'
type Listener = () => void

/** The V that started listening: not down, down for less than the hold, or held. */
type Hold = 'none' | 'down' | 'held'

/** A turn of a conversation, or a command typed while its turns are still worked out. */
interface Turn {
  text: string
  source: CommandSource
}

/**
 * After a conversation stops listening, the turns already said are still worked out: in the bar
 * (`shown`: after V, Stop or "that's all", the last answer shows as one command's did), or behind
 * another view (`quiet`: a problem or the text line, which stays; a card or a page still opens).
 */
type Drain = 'shown' | 'quiet'

export class BarSession {
  private readonly onPage: AssistantOnPage | null
  private readonly where: (() => AssistantOnPage | null) | null
  private readonly card: AssistantCardIn | null
  private names: readonly string[]
  private hints: readonly string[]
  private readonly read: BarSessionOptions['read']
  private readonly hand: BarSessionOptions['hand']
  private readonly onClose: () => void
  private readonly cardOpen: () => CardShown
  private readonly env: MicEnv
  private readonly makeTool: VoiceToolMaker | null | undefined
  private readonly times: Times
  private readonly listeners = new Set<Listener>()
  private snapshot: BarSnapshot = STARTING
  private mic: MicSession | null = null
  private unsubscribe: (() => void) | null = null
  private readonly timers = new Map<TimerName, number>()
  /** The words heard so far, as `wordsOf` gives them: a change is a new word. */
  private heardWords = ''
  /**
   * The talk is over, and the last words are on their way: as one command's talk (`talk`), or as
   * a conversation's last turn (`stop`).
   */
  private finishing: 'talk' | 'stop' | null = null
  /** The mic whose words are due a look, once the tool's updates of this moment are all in. */
  private lookingAt: MicSession | null = null
  private request: AbortController | null = null
  private source: CommandSource = 'mic'
  private over = false
  private hold: Hold = 'none'
  private holdTimer = 0

  // --- A conversation (PLAN-V24 Part 2) ---------------------------------------------------------

  /** "Keep listening": each listening is a conversation, unless V is held. */
  readonly keepsListening: boolean
  /** The conversation listens now: the mic stays on across turns. */
  private live = false
  /** Turns said and not yet worked out, in order (choice 12). */
  private queue: Turn[] = []
  /** A turn is with the command step, or its answer is still settling. */
  private busy = false
  private turnRequest: AbortController | null = null
  private drain: Drain = 'shown'
  /** The last words the command step found unclear: Type instead offers them. */
  private lastUnclear = ''
  /** The review card that hears the turns (T2-3). */
  private ear: CardEar | null = null
  /** A turn waits for the card the last one opened, to hear it first. */
  private waitingForCard = false
  private readonly screen: ScreenEnv
  /** The wake lock while the conversation listens, and which ask for it is the newest. */
  private kept: KeptOn | null = null
  private keepAsk = 0
  private unwatchPage: (() => void) | null = null

  constructor(options: BarSessionOptions) {
    this.onPage = options.onPage ?? null
    this.where = options.where ?? null
    this.card = options.card ?? null
    this.names = options.names ?? []
    this.hints = options.hints ?? []
    this.read = options.read
    this.hand = options.hand
    this.onClose = options.onClose
    this.cardOpen = options.cardOpen ?? (() => null)
    this.keepsListening = options.conversation === true
    this.env = options.env ?? browserEnv()
    this.makeTool = options.makeTool
    this.times = { ...TIMES, ...options.times }
    this.screen = options.screen ?? browserScreen()
  }

  // --- For React (useSyncExternalStore) ---------------------------------------------------------

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): BarSnapshot => this.snapshot

  private set(change: Partial<BarSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...change }
    for (const listener of this.listeners) listener()
  }

  /** The conversation's part of the snapshot, while it listens. */
  private setConversation(change: Partial<ConversationSnapshot>): void {
    const now = this.snapshot.conversation
    if (now) this.set({ conversation: { ...now, ...change } })
  }

  /** True while a conversation listens. */
  isLive(): boolean {
    return this.live
  }

  // --- The review card (T2-3) -------------------------------------------------------------------

  /**
   * A review card opened: it hears each turn first, until the returned function lets go (it
   * closed). A turn that waited for it goes on.
   */
  attachCard(ear: CardEar): () => void {
    this.ear = ear
    this.goOn()
    return () => {
      if (this.ear !== ear) return
      this.ear = null
      this.goOn()
    }
  }

  /** The open card changed: a turn that waited for a card that won't hear it goes on. */
  cardChanged(): void {
    this.goOn()
  }

  /** The card says something as the conversation's line: "Sent." */
  say(line: string): void {
    this.setConversation({ line })
  }

  private goOn(): void {
    if (!this.waitingForCard) return
    this.waitingForCard = false
    this.next()
  }

  /** The card that hears the turns, while it is still open. */
  private hearing(): CardEar | null {
    return this.ear !== null && this.cardOpen() === 'hears' ? this.ear : null
  }

  // --- What the bar asks ------------------------------------------------------------------------

  /**
   * The bar opened: it listens, or opens on the text line where the voice can't work. `tool` is the
   * voice tool setting. Only the browser's speech service is built (choice 10); Whisper waits for
   * S1 (choice 11), and `typing` means no mic at all.
   */
  start(tool: VoiceToolKind): void {
    this.over = false
    if (tool !== 'browser_service') {
      this.set({
        ...STARTING,
        phase: 'typing',
        voice: false,
        problem: tool === 'typing' ? null : { kind: 'no_voice' },
      })
      return
    }
    if (!this.env.speech()) {
      // No speech service in this browser (Firefox): don't open the mic for nothing.
      this.set({
        ...STARTING,
        phase: 'typing',
        voice: false,
        problem: { kind: 'mic', problem: 'no_speech_tool' },
      })
      return
    }
    this.listen()
  }

  /**
   * Listens, from the start: the mic check, then the words. With "Keep listening", a conversation;
   * turns of an earlier one that are still worked out go on, and come first.
   */
  listen(): void {
    this.stopListening()
    this.abortRequest()
    const mic = new MicSession({
      mode: 'note',
      tool: 'browser_service',
      names: this.names,
      hints: this.hints,
      env: this.env,
      ...(this.makeTool === undefined ? {} : { makeTool: this.makeTool }),
    })
    this.mic = mic
    this.heardWords = ''
    this.lastUnclear = ''
    this.live = this.keepsListening
    this.unsubscribe = mic.subscribe(() => {
      this.onMic(mic)
    })
    this.set({
      ...STARTING,
      mic: mic.getSnapshot(),
      conversation: this.live ? { ...NEW_CONVERSATION, waiting: this.queue.length } : null,
    })
    if (this.live) {
      // The screen stays on while it listens, and a hidden page is seen (T2-5).
      this.keepScreenOn()
      this.unwatchPage = this.screen.onVisibility(this.pageChanged)
    }
    mic.start()
  }

  /**
   * V or Done while listening: the talk is over, and the words go to the command step. In a
   * conversation, V or Stop ends it: the turn in progress goes first.
   */
  done(): void {
    const { phase } = this.snapshot
    const mic = this.mic
    if ((phase !== 'starting' && phase !== 'listening') || !mic) return
    this.clearTimers()
    if (this.live) {
      this.stop(mic)
      return
    }
    if (mic.getSnapshot().phase === 'listening' && mic.text().trim() !== '') {
      // The tool writes out its last words first ("Working it out" meanwhile).
      this.finishing = 'talk'
      this.set({ phase: 'working', words: mic.text() })
      mic.finish()
      return
    }
    this.talkOver()
  }

  /** Esc: everything stops, the words are thrown away, and the bar closes. */
  cancel(): void {
    this.dispose()
    this.onClose()
  }

  /**
   * Type instead (or Carry on): the mic stops, and the words so far go in the text line. In a
   * conversation with no words in progress, the last words found unclear go there. Turns already
   * said are still worked out, behind the text line.
   */
  typeInstead(): void {
    if (this.snapshot.phase === 'typing') return
    const heard = this.mic?.text() ?? ''
    const said = this.mic ? (heard.trim() !== '' ? heard : this.lastUnclear) : this.snapshot.words
    this.keepFixes()
    this.drain = 'quiet'
    this.stopListening()
    this.abortRequest()
    this.set({
      phase: 'typing',
      mic: null,
      draft: said.slice(0, MAX_CHARS),
      problem: null,
      answer: null,
      conversation: null,
    })
  }

  /**
   * The text line changed. It holds the longest command the server takes, but for words that came
   * in longer (choice 9): they stay whole, to be shortened.
   */
  setDraft(text: string): void {
    this.set({ draft: text.slice(0, Math.max(MAX_CHARS, this.snapshot.draft.length)) })
  }

  /**
   * Enter in the text line. An empty line sends nothing, nor one over the server's limit. While a
   * conversation's turns are still worked out, it waits for them.
   */
  sendTyped(): void {
    if (this.snapshot.phase !== 'typing') return
    const text = this.snapshot.draft.trim()
    if (text === '' || text.length > MAX_CHARS) return
    if (this.busy || this.queue.length > 0) {
      this.drain = 'shown'
      this.queue.push({ text, source: 'typed' })
      this.set({ phase: 'working', mic: null, words: text, problem: null, answer: null })
      return
    }
    this.send(text, 'typed')
  }

  /** Try again: listen again, or send the same words again, as the problem asks. */
  tryAgain(): void {
    const { phase, problem, words, voice } = this.snapshot
    if (phase === 'problem' && (problem?.kind === 'too_slow' || problem?.kind === 'other')) {
      if (words) this.send(words, this.source)
      return
    }
    if (phase === 'typing' || phase === 'problem' || phase === 'answer') {
      if (voice) this.listen()
      else this.typeInstead()
    }
  }

  /**
   * A plain V while the bar is open: while it listens, the talk is over (in a conversation, it
   * ends); while it shows a problem or a line, it listens again. True when V did something.
   */
  pressV(): boolean {
    const { phase, voice } = this.snapshot
    if (phase === 'starting' || phase === 'listening') {
      this.done()
      return true
    }
    if ((phase === 'problem' || phase === 'answer') && voice) {
      this.listen()
      return true
    }
    return false
  }

  /**
   * The hint list came in, or changed (PLAN-V23 T1-5): the name fix uses it from the next words,
   * and the speech service from its next start.
   */
  setNames(names: readonly string[], hints: readonly string[]): void {
    this.names = names
    this.hints = hints
    this.mic?.setNames(names, hints)
  }

  /** The bar is gone: the mic is let go and nothing more comes. */
  dispose(): void {
    this.over = true
    window.clearTimeout(this.holdTimer)
    this.stopListening()
    this.abortRequest()
    this.queue = []
    this.busy = false
    this.turnRequest?.abort()
    this.turnRequest = null
    this.ear = null
    this.waitingForCard = false
  }

  // --- Hold V (PLAN-V23 choice 6) -----------------------------------------------------------------

  /**
   * V went down, and started (or is) the listening: held past `times.hold`, it is a hold, and no
   * silence ends the talk while it is. In a conversation, a hold is one turn (PLAN-V24 choice 7).
   * Anywhere else, nothing.
   */
  vDown(): void {
    const { phase } = this.snapshot
    if (this.over || (phase !== 'starting' && phase !== 'listening')) return
    window.clearTimeout(this.holdTimer)
    this.hold = 'down'
    this.holdTimer = window.setTimeout(() => {
      if (this.hold !== 'down') return
      this.hold = 'held'
      this.clear('silence')
      this.clear('first')
      if (this.live) this.oneTurn()
    }, this.times.hold)
  }

  /** V came up: after a hold, the talk is over, as with Done. After a tap, nothing changes. */
  vUp(): void {
    window.clearTimeout(this.holdTimer)
    const held = this.hold === 'held'
    this.hold = 'none'
    if (held) this.done()
  }

  /**
   * V held as a conversation starts (choice 7): this listening is one turn, as before PLAN-V24.
   * Letting go ends it and lets the mic go, up to the 2 minutes of a turn.
   */
  private oneTurn(): void {
    this.live = false
    this.letScreenGo()
    this.clear('quiet')
    this.clear('turn')
    if (this.snapshot.phase === 'listening') {
      this.restart('limit', this.times.turn, () => {
        this.done()
      })
    }
    this.set({ conversation: null })
  }

  // --- The mic ----------------------------------------------------------------------------------

  private onMic(mic: MicSession): void {
    if (mic !== this.mic || this.over) return
    const snap = mic.getSnapshot()
    if (snap.phase === 'failed' && snap.problem && snap.problem !== 'silent') {
      // "Silent" only says no voice came yet: the mic stays open, and the words may still come.
      this.micFailed(snap.problem)
      return
    }
    if (this.finishing) {
      if (snap.phase !== 'done') this.set({ mic: snap })
      else if (this.finishing === 'stop') this.lastTurn()
      else this.talkOver()
      return
    }
    if (this.snapshot.phase === 'starting' && snap.steps.allowed === 'pass') {
      // The mic is open and the tool listens: the words count from now. While V is held, only
      // letting go ends the talk.
      this.set({ phase: 'listening', mic: snap })
      if (this.live) {
        // A conversation: no first-words wait, only the quiet stop (choice 10).
        this.restart('quiet', this.times.quiet, () => {
          this.quietStop()
        })
      } else {
        if (this.hold !== 'held') {
          this.restart('first', this.times.firstWords, () => {
            this.done()
          })
        }
        this.restart('limit', this.keepsListening ? this.times.turn : this.times.limit, () => {
          this.done()
        })
      }
    } else {
      this.set({ mic: snap })
    }
    if (this.snapshot.phase === 'listening') this.lookAtWords(mic)
  }

  /**
   * The speech service makes words final and clears the words still being heard in one go, as two
   * updates. Between them the words read twice, so they are read once both are in.
   */
  private lookAtWords(mic: MicSession): void {
    if (this.lookingAt === mic) return
    this.lookingAt = mic
    queueMicrotask(() => {
      if (this.lookingAt === mic) this.lookingAt = null
      if (mic === this.mic && !this.over && this.snapshot.phase === 'listening') {
        this.heard(mic.text())
      }
    })
  }

  /**
   * New words: the talk goes on, and the silence counts from now (not while V is held). In a
   * conversation, the turn ends after a smart pause (longer when the words sound unfinished), the
   * quiet stop counts from now, and a turn's 2 minutes from its first word.
   */
  private heard(text: string): void {
    const words = wordsOf(text)
    if (words === '' || words === this.heardWords) return
    this.heardWords = words
    this.clear('first')
    if (this.live) {
      this.restart('quiet', this.times.quiet, () => {
        this.quietStop()
      })
      if (!this.timers.has('turn')) {
        this.restart('turn', this.times.turn, () => {
          this.endTurn()
        })
      }
      this.restart('silence', pauseFor(text, this.times), () => {
        this.endTurn()
      })
      return
    }
    if (this.hold === 'held') return
    this.restart('silence', this.times.silence, () => {
      this.done()
    })
  }

  /** The talk is over, the last words in: the mic is let go, and the words go on. */
  private talkOver(): void {
    const text = (this.mic?.text() ?? '').trim()
    this.keepFixes()
    this.stopListening()
    if (text === '') {
      this.set({ phase: 'problem', mic: null, words: '', problem: { kind: 'nothing_heard' } })
      return
    }
    if (text.length > MAX_CHARS) {
      this.tooLong(text)
      return
    }
    this.send(text, 'mic')
  }

  /** The names the mic put right stay on show once the mic is let go. */
  private keepFixes(): void {
    const fixes = this.mic?.getSnapshot().fixes ?? []
    if (fixes.length > 0) this.set({ fixes })
  }

  /**
   * The mic can't go on. Words said so far are kept, with the problem and its buttons. With no
   * words, the bar opens on the text line and says why, but for a mic another app holds: muted
   * there, it works again, so Try again comes first, with Type instead beside it (PLAN-V24 T1-4).
   * A conversation's turns already said are still worked out, behind the problem.
   */
  private micFailed(problem: MicProblem): void {
    const said = (this.mic?.text() ?? '').trim()
    this.keepFixes()
    this.drain = 'quiet'
    this.stopListening()
    if (said === '' && problem === 'busy') {
      this.set({
        phase: 'problem',
        mic: null,
        words: '',
        problem: { kind: 'mic', problem },
        conversation: null,
      })
      return
    }
    if (said === '') {
      this.set({
        phase: 'typing',
        mic: null,
        draft: '',
        problem: { kind: 'mic', problem },
        conversation: null,
      })
      return
    }
    // Words came, so the mic worked: one gone now (unplugged, or taken) has stopped. The mic
    // card's check calls it "no mic" while its own check runs, which may still be the case here.
    const shown: MicProblem = problem === 'no_mic' ? 'cut_off' : problem
    this.set({
      phase: 'problem',
      mic: null,
      words: said,
      problem: { kind: 'mic', problem: shown },
      conversation: null,
    })
  }

  /** The mic is let go, and every wait with it. A conversation stops listening, and the screen. */
  private stopListening(): void {
    this.clearTimers()
    this.finishing = null
    this.live = false
    this.letScreenGo()
    this.unwatchPage?.()
    this.unwatchPage = null
    this.unsubscribe?.()
    this.unsubscribe = null
    this.mic?.close()
    this.mic = null
  }

  /**
   * Words over the server's limit wait in the text line, to shorten (choice 9). A conversation's
   * turns already said are still worked out, behind it.
   */
  private tooLong(text: string): void {
    this.drain = 'quiet'
    this.stopListening()
    this.set({
      phase: 'typing',
      mic: null,
      draft: text,
      problem: { kind: 'too_long' },
      answer: null,
      conversation: null,
    })
  }

  // --- A conversation's turns (PLAN-V24 Part 2) ---------------------------------------------------

  /** A pause, or a turn's 2 minutes: the turn goes, and the mic listens on. */
  private endTurn(): void {
    const mic = this.mic
    if (!mic || !this.live) return
    this.clear('silence')
    this.clear('turn')
    const { text } = mic.handOver()
    this.heardWords = ''
    this.take({ text: text.trim(), source: 'mic' })
  }

  /** A turn is said: the code reads the end words itself, and the rest waits its turn. */
  private take(turn: Turn): void {
    if (turn.text === '') return
    this.setConversation({ turns: (this.snapshot.conversation?.turns ?? 0) + 1 })
    if (endsConversation(turn.text)) {
      // "Stop listening", "that's all": nothing is sent, and the mic stops at once (choice 10).
      if (this.live) this.stopConversation()
      return
    }
    this.queue.push(turn)
    this.setConversation({ waiting: this.queue.length })
    this.next()
  }

  /**
   * V or Stop in a conversation: the turn in progress is the last (once the tool has written it
   * out), then the conversation is over. Turns already said are still worked out, in the bar.
   */
  private stop(mic: MicSession): void {
    this.live = false
    this.drain = 'shown'
    const said = mic.getSnapshot().phase === 'listening' ? mic.text().trim() : ''
    if (said !== '') {
      this.finishing = 'stop'
      this.set({ phase: 'working', words: said, conversation: null })
      mic.finish()
      return
    }
    this.lastTurn()
  }

  /** The conversation's last words are in: the mic is let go, and they take their turn. */
  private lastTurn(): void {
    const text = (this.mic?.text() ?? '').trim()
    this.keepFixes()
    // "That's all" said last sends nothing either.
    const said = text !== '' && !endsConversation(text)
    if (said) this.queue.push({ text, source: 'mic' })
    this.stopConversation(said)
  }

  /**
   * The conversation stops listening (V, Stop, "that's all"): the mic is let go, and the turns
   * already said are worked out in the bar. With none, the bar closes, or says it heard nothing.
   */
  private stopConversation(said = false): void {
    const heardAny = said || (this.snapshot.conversation?.turns ?? 0) > 0
    const working = this.busy ? (this.snapshot.conversation?.working ?? '') : null
    this.drain = 'shown'
    this.stopListening()
    if (this.busy || this.queue.length > 0) {
      const head = working ?? this.queue[0]?.text ?? ''
      this.set({ phase: 'working', mic: null, words: head, conversation: null })
      this.next()
      return
    }
    this.finishShown(heardAny)
  }

  /** Everything said is worked out: the bar closes, or says it heard nothing at all. */
  private finishShown(heardAny: boolean): void {
    if (heardAny) {
      this.cancel()
      return
    }
    this.set({
      phase: 'problem',
      mic: null,
      words: '',
      problem: { kind: 'nothing_heard' },
      conversation: null,
    })
  }

  // --- Phones and windows (T2-5) ---------------------------------------------------------------

  /** The screen stays on while the conversation listens (choice 15). A refusal changes nothing. */
  private keepScreenOn(): void {
    this.keepAsk += 1
    const ask = this.keepAsk
    void this.screen.keepOn().then(
      (kept) => {
        if (!kept) return
        // It ended meanwhile: let the lock go at once.
        if (ask !== this.keepAsk || !this.live) void kept.release().catch(() => undefined)
        else this.kept = kept
      },
      () => undefined,
    )
  }

  private letScreenGo(): void {
    this.keepAsk += 1
    const kept = this.kept
    this.kept = null
    if (kept) void kept.release().catch(() => undefined)
  }

  /**
   * The page was hidden or shown. On a phone, hidden ends the conversation, with the words kept.
   * On a laptop it goes on (TBC at S1). Shown again, the wake lock the browser let go is asked for
   * again.
   */
  private readonly pageChanged = (): void => {
    if (!this.live || this.over) return
    if (!this.screen.hidden()) {
      this.letScreenGo()
      this.keepScreenOn()
      return
    }
    if (!this.screen.phone()) return
    const said = (this.mic?.text() ?? '').trim()
    if (said === '') {
      // Nothing to keep: it stops, as "that's all" does.
      this.stopConversation()
      return
    }
    this.keepFixes()
    this.drain = 'quiet'
    this.stopListening()
    this.set({
      phase: 'problem',
      mic: null,
      words: said,
      problem: { kind: 'left' },
      conversation: null,
    })
  }

  /** No words for 2 minutes (choice 10): the conversation stops, with Start again. */
  private quietStop(): void {
    if (!this.live) return
    this.drain = 'quiet'
    this.stopListening()
    this.set({
      phase: 'problem',
      mic: null,
      words: '',
      problem: { kind: 'quiet' },
      conversation: null,
    })
  }

  /**
   * The next turn, once the last is worked out. An open card reads it first (T2-3), and fewer
   * than 2 real words are dropped quietly.
   */
  private next(): void {
    if (this.busy || this.over) return
    if (this.queue.length > 0 && this.hearing() === null && this.cardOpen() === 'hears') {
      // The card the last turn opened is on its way: it hears this one first.
      this.waitingForCard = true
      return
    }
    const turn = this.queue.shift()
    if (!turn) {
      this.idle()
      return
    }
    this.setConversation({ waiting: this.queue.length })
    const ear = turn.source === 'mic' ? this.hearing() : null
    const took = ear?.take(turn.text) ?? null
    if (took) {
      this.setConversation({ line: took.line })
      this.next()
      return
    }
    if (turn.source === 'mic' && isShortTurn(turn.text)) {
      // A cough or an "um" never asks the AI (choice 11).
      this.next()
      return
    }
    if (turn.text.length > MAX_CHARS) {
      this.tooLong(turn.text)
      this.next()
      return
    }
    this.ask(turn, ear)
  }

  /** Nothing is waiting. A conversation that has stopped, in the bar, is over. */
  private idle(): void {
    if (this.live) {
      this.setConversation({ working: null, waiting: 0 })
      return
    }
    if (this.drain === 'shown' && this.snapshot.phase === 'working') this.finishShown(true)
  }

  /** A turn goes to the command step, with what is on screen now, and the open card's boxes. */
  private ask(turn: Turn, ear: CardEar | null): void {
    this.busy = true
    const request = new AbortController()
    this.turnRequest = request
    if (this.live) {
      this.setConversation({ working: turn.text })
    } else if (this.drain === 'shown') {
      this.set({ phase: 'working', mic: null, words: turn.text, problem: null, answer: null })
    }
    const onPage = this.where ? this.where() : this.onPage
    const body: AssistantCommandIn = {
      text: turn.text,
      source: turn.source,
      ...(onPage ? { on_page: onPage } : {}),
      ...(ear ? { card: ear.card() } : {}),
    }
    this.read(body, request.signal).then(
      (command) => {
        if (this.turnRequest !== request || this.over) return
        this.turnRequest = null
        this.turnAnswered({ kind: 'command', command, words: turn.text, source: turn.source }, ear)
      },
      (error: unknown) => {
        if (this.turnRequest !== request || this.over || isAbort(error)) return
        this.turnRequest = null
        this.turnFailed(error, turn, ear)
      },
    )
  }

  /** The answer goes to the card the turn was said to, or where one command's would. */
  private turnAnswered(heard: Heard, ear: CardEar | null): void {
    if (ear !== null && this.hearing() !== ear) {
      // The card closed meanwhile: its change has nowhere to go.
      this.turnSettled({ kind: 'close' })
      return
    }
    const after = ear ? ear.answer(heard) : this.hand(heard)
    if (after instanceof Promise) {
      // A pre-read starting first: the turns wait for it.
      const request = new AbortController()
      this.turnRequest = request
      void after.then((settled) => {
        if (this.turnRequest !== request || this.over) return
        this.turnRequest = null
        this.turnSettled(settled)
      })
      return
    }
    this.turnSettled(after)
  }

  /**
   * A turn's answer has gone where it belongs. While the conversation listens, a line shows and
   * it goes on; a card that can't hear it ends it, as one command did. After it stopped, the last
   * answer shows as one command's would.
   */
  private turnSettled(after: AfterAnswer): void {
    this.busy = false
    if (this.live) {
      this.setConversation({ working: null })
      if (after.kind === 'close' && this.cardOpen() === 'other') {
        // A card that can't hear the conversation (a pre-read's): it ends, as one command did.
        this.stopListening()
        this.queue = []
        this.settle(after)
        return
      }
      if (after.kind === 'show') this.setConversation({ line: after.line })
      else if (after.kind === 'unclear') {
        this.lastUnclear = after.words
        this.setConversation({ line: after.line })
      }
      this.next()
      return
    }
    if (this.drain === 'shown' && this.queue.length === 0) {
      this.settle(after)
      return
    }
    this.next()
  }

  /**
   * A turn the command step refused. Behind another view, nothing shows. Said to a card with the
   * AI off, the card says so, and the conversation goes on (the card's own words still work).
   * Otherwise the conversation ends with the problem, as one command's did, and later turns are
   * dropped.
   */
  private turnFailed(error: unknown, turn: Turn, ear: CardEar | null): void {
    this.busy = false
    if (!this.live && this.drain === 'quiet') {
      this.next()
      return
    }
    const problem = toApiProblem(error)
    if (ear !== null && problem.status === 409 && problem.code === 'assistant_off') {
      this.busy = true
      this.turnAnswered({ kind: 'dictation', words: turn.text, source: turn.source }, ear)
      return
    }
    this.stopListening()
    this.queue = []
    this.source = turn.source
    this.set({ phase: 'working', mic: null, words: turn.text, conversation: null })
    this.failed(error, turn.text, turn.source)
  }

  // --- The command step -------------------------------------------------------------------------

  private send(text: string, source: CommandSource): void {
    this.abortRequest()
    const request = new AbortController()
    this.request = request
    this.source = source
    this.set({ phase: 'working', mic: null, words: text, problem: null, answer: null })
    const body: AssistantCommandIn = {
      text,
      source,
      ...(this.onPage ? { on_page: this.onPage } : {}),
      ...(this.card ? { card: this.card } : {}),
    }
    this.read(body, request.signal).then(
      (command) => {
        if (this.request !== request || this.over) return
        this.request = null
        this.answered({ kind: 'command', command, words: text, source })
      },
      (error: unknown) => {
        if (this.request !== request || this.over || isAbort(error)) return
        this.request = null
        this.failed(error, text, source)
      },
    )
  }

  private answered(heard: Heard): void {
    const after = this.hand(heard)
    if (after instanceof Promise) {
      // Still working: the words stay, and nothing spins, until it settles.
      const request = new AbortController()
      this.request = request
      void after.then((settled) => {
        if (this.request !== request || this.over) return
        this.request = null
        this.settle(settled)
      })
      return
    }
    this.settle(after)
  }

  private settle(after: AfterAnswer): void {
    if (after.kind === 'close') {
      this.cancel()
      return
    }
    if (after.kind === 'unclear') {
      // The words wait in the text line, to fix and send with Enter, or to say again.
      this.set({
        phase: 'typing',
        mic: null,
        draft: after.words.slice(0, MAX_CHARS),
        problem: { kind: 'unclear', line: after.line },
        answer: null,
      })
      return
    }
    this.set({
      phase: 'answer',
      answer: { line: after.line, unsure: after.unsure, again: after.again },
    })
  }

  /**
   * The command step said no, or didn't answer. The words stay in each case, so Try again or Type
   * instead can use them.
   */
  private failed(error: unknown, text: string, source: CommandSource): void {
    const problem = toApiProblem(error)
    if (problem.status === 409 && problem.code === 'assistant_off') {
      // The AI that reads commands is off: the words are dictation (choice 17).
      this.answered({ kind: 'dictation', words: text, source })
      return
    }
    if (problem.status === 429) {
      // Over 20 commands in a minute (choice 18).
      this.set({ phase: 'problem', problem: { kind: 'too_many' } })
      return
    }
    if (
      (problem.status === 503 && problem.code === 'claude_unavailable') ||
      problem.code === 'timeout'
    ) {
      // Claude took over 15 seconds or is down, or the answer didn't come in time.
      this.set({ phase: 'problem', problem: { kind: 'too_slow' } })
      return
    }
    if (problem.status === 422 && problem.code === 'command_empty') {
      // Only spaces or marks reached the server: nothing to read.
      this.set({ phase: 'problem', words: '', problem: { kind: 'nothing_heard' } })
      return
    }
    this.set({
      phase: 'problem',
      problem: {
        kind: 'other',
        title: problem.title,
        detail: problem.detail,
        resend: problem.status !== 422,
      },
    })
  }

  private abortRequest(): void {
    this.request?.abort()
    this.request = null
  }

  // --- Timers -----------------------------------------------------------------------------------

  private restart(name: TimerName, ms: number, run: () => void): void {
    this.clear(name)
    this.timers.set(
      name,
      window.setTimeout(() => {
        this.timers.delete(name)
        run()
      }, ms),
    )
  }

  private clear(name: TimerName): void {
    const timer = this.timers.get(name)
    if (timer !== undefined) window.clearTimeout(timer)
    this.timers.delete(name)
  }

  private clearTimers(): void {
    for (const timer of this.timers.values()) window.clearTimeout(timer)
    this.timers.clear()
  }
}
