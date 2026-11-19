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

export const TIMES = {
  /** No new words for this long ends the talk (PLAN-V22 T3-1: about 1.5 seconds, S1 may change it). */
  silence: 1500,
  /** No word at all this long after the mic opened: nothing was heard (TBC). */
  firstWords: 6000,
  /** The longest talk (TBC). */
  limit: 60_000,
  /** V still down this long is a hold: letting go ends the talk (PLAN-V23 choice 6, TBC). */
  hold: 400,
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

export interface ShownAnswer {
  line: string
  unsure: string | null
  /** Offer Try again: the command step didn't find an action in the words. */
  again: boolean
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
}

export interface BarSessionOptions {
  /** What is on screen, for a command that names no company. */
  onPage?: AssistantOnPage | null
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
  /** The bar is done with: it closes. */
  onClose: () => void
  /** For tests: the browser, the voice tool and the clock's waits. */
  env?: MicEnv
  makeTool?: VoiceToolMaker | null
  times?: Partial<Times>
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
}

/** The words alone, for telling new words from the same words written out ("Log a call."). */
function wordsOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

type TimerName = 'silence' | 'first' | 'limit'
type Listener = () => void

/** The V that started listening: not down, down for less than the hold, or held. */
type Hold = 'none' | 'down' | 'held'

export class BarSession {
  private readonly onPage: AssistantOnPage | null
  private readonly card: AssistantCardIn | null
  private names: readonly string[]
  private hints: readonly string[]
  private readonly read: BarSessionOptions['read']
  private readonly hand: BarSessionOptions['hand']
  private readonly onClose: () => void
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
  /** The talk is over, and the last words are on their way. */
  private finishing = false
  /** The mic whose words are due a look, once the tool's updates of this moment are all in. */
  private lookingAt: MicSession | null = null
  private request: AbortController | null = null
  private source: CommandSource = 'mic'
  private over = false
  private hold: Hold = 'none'
  private holdTimer = 0

  constructor(options: BarSessionOptions) {
    this.onPage = options.onPage ?? null
    this.card = options.card ?? null
    this.names = options.names ?? []
    this.hints = options.hints ?? []
    this.read = options.read
    this.hand = options.hand
    this.onClose = options.onClose
    this.env = options.env ?? browserEnv()
    this.makeTool = options.makeTool
    this.times = { ...TIMES, ...options.times }
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

  /** Listens, from the start: the mic check, then the words. */
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
    this.unsubscribe = mic.subscribe(() => {
      this.onMic(mic)
    })
    this.set({ ...STARTING, mic: mic.getSnapshot() })
    mic.start()
  }

  /** V or Done while listening: the talk is over, and the words go to the command step. */
  done(): void {
    const { phase } = this.snapshot
    const mic = this.mic
    if ((phase !== 'starting' && phase !== 'listening') || !mic) return
    this.clearTimers()
    if (mic.getSnapshot().phase === 'listening' && mic.text().trim() !== '') {
      // The tool writes out its last words first ("Working it out" meanwhile).
      this.finishing = true
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

  /** Type instead (or Carry on): the mic stops, and the words so far go in the text line. */
  typeInstead(): void {
    if (this.snapshot.phase === 'typing') return
    const said = this.mic ? this.mic.text() : this.snapshot.words
    this.keepFixes()
    this.stopListening()
    this.abortRequest()
    this.set({
      phase: 'typing',
      mic: null,
      draft: said.slice(0, MAX_CHARS),
      problem: null,
      answer: null,
    })
  }

  setDraft(text: string): void {
    this.set({ draft: text.slice(0, MAX_CHARS) })
  }

  /** Enter in the text line. An empty line sends nothing. */
  sendTyped(): void {
    if (this.snapshot.phase !== 'typing') return
    const text = this.snapshot.draft.trim()
    if (text === '') return
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
   * A plain V while the bar is open: while it listens, the talk is over; while it shows a problem
   * or a line, it listens again. True when V did something.
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
  }

  // --- Hold V (PLAN-V23 choice 6) -----------------------------------------------------------------

  /**
   * V went down, and started (or is) the listening: held past `times.hold`, it is a hold, and no
   * silence ends the talk while it is. Anywhere else, nothing.
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
    }, this.times.hold)
  }

  /** V came up: after a hold, the talk is over, as with Done. After a tap, nothing changes. */
  vUp(): void {
    window.clearTimeout(this.holdTimer)
    const held = this.hold === 'held'
    this.hold = 'none'
    if (held) this.done()
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
      if (snap.phase === 'done') this.talkOver()
      else this.set({ mic: snap })
      return
    }
    if (this.snapshot.phase === 'starting' && snap.steps.allowed === 'pass') {
      // The mic is open and the tool listens: the words count from now. While V is held, only
      // letting go ends the talk.
      this.set({ phase: 'listening', mic: snap })
      if (this.hold !== 'held') {
        this.restart('first', this.times.firstWords, () => {
          this.done()
        })
      }
      this.restart('limit', this.times.limit, () => {
        this.done()
      })
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

  /** New words: the talk goes on, and the silence counts from now (not while V is held). */
  private heard(text: string): void {
    const words = wordsOf(text)
    if (words === '' || words === this.heardWords) return
    this.heardWords = words
    this.clear('first')
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
    this.send(text, 'mic')
  }

  /** The names the mic put right stay on show once the mic is let go. */
  private keepFixes(): void {
    const fixes = this.mic?.getSnapshot().fixes ?? []
    if (fixes.length > 0) this.set({ fixes })
  }

  /**
   * The mic can't go on. Words said so far are kept, with the problem and its buttons. With no
   * words, the bar opens on the text line and says why.
   */
  private micFailed(problem: MicProblem): void {
    const said = (this.mic?.text() ?? '').trim()
    this.keepFixes()
    this.stopListening()
    if (said === '') {
      this.set({ phase: 'typing', mic: null, draft: '', problem: { kind: 'mic', problem } })
      return
    }
    // Words came, so the mic worked: one gone now (unplugged, or taken) has stopped. The mic
    // card's check calls it "no mic" while its own check runs, which may still be the case here.
    const shown: MicProblem = problem === 'no_mic' ? 'cut_off' : problem
    this.set({ phase: 'problem', mic: null, words: said, problem: { kind: 'mic', problem: shown } })
  }

  private stopListening(): void {
    this.clearTimers()
    this.finishing = false
    this.unsubscribe?.()
    this.unsubscribe = null
    this.mic?.close()
    this.mic = null
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
