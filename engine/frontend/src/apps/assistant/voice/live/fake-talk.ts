/**
 * A fake live talk for the tests (PLAN-V28 Part 2): the voice bar's session uses a talk through
 * `Talk`, so its tests drive one by hand. Only tests import it; the app never does.
 *
 *   const talks = new FakeTalks()
 *   const session = new BarSession({ ..., live: { on: () => true, talk: talks.make } })
 *   talks.last().ready()                         // Google is ready: "Listening"
 *   talks.last().hear('Log a call with Jo')      // the rep's words, as Google heard them
 *   talks.last().finish({ kind: 'failed' })      // it ended by itself
 */
import type { Talk, TalkEnd, TalkOptions, TalkSnapshot, ToolAnswer } from './talk'
import { NO_CAPTIONS } from './talk'

const STARTING: TalkSnapshot = {
  phase: 'connecting',
  ready: false,
  speaking: false,
  working: 0,
  muted: false,
  captions: NO_CAPTIONS,
  words: 0,
  bars: null,
  device: null,
  movedTo: null,
  end: null,
}

export class FakeTalk implements Talk {
  readonly options: TalkOptions
  started = false
  stopped = false
  readonly mutes: boolean[] = []
  readonly answers: ToolAnswer[] = []
  private snapshot: TalkSnapshot = STARTING
  private readonly listeners = new Set<() => void>()

  constructor(options: TalkOptions) {
    this.options = options
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): TalkSnapshot => this.snapshot

  start(): void {
    this.started = true
  }

  stop(): void {
    if (this.snapshot.end) return
    this.stopped = true
    this.set({ phase: 'ended', end: { kind: 'stopped' }, speaking: false, working: 0 })
  }

  mute(on: boolean): void {
    this.mutes.push(on)
    this.set({ muted: on })
  }

  answer(answer: ToolAnswer): void {
    this.answers.push(answer)
    this.set({ working: Math.max(0, this.snapshot.working - 1) })
  }

  text(): string {
    const { rep, hearing } = this.snapshot.captions
    return [rep, hearing].filter((part) => part !== '').join(' ')
  }

  unsent(): string {
    return this.left
  }

  /** The rep's words no tool call took yet (`leave`): they go to the text line (T4-1). */
  private left = ''

  // --- The test's own moves ------------------------------------------------------------------------

  /** The rep said words no tool call took yet. */
  leave(words: string): void {
    this.left = words
  }

  /** Gemini asks Contour, with the rep's own words since the last call (PLAN-V28 T3-1). */
  call(id: string, request: string, heard = ''): void {
    this.set({ working: this.snapshot.working + 1 })
    this.options.onToolCall?.({ id, request, heard })
  }

  /** Google cancelled tool calls (T3-3). */
  cancel(...ids: string[]): void {
    this.set({ working: Math.max(0, this.snapshot.working - ids.length) })
    this.options.onToolCancel?.(ids)
  }

  /** The rep's whole turn is over (T3-4). */
  turn(words: string): void {
    this.options.onRepTurn?.(words)
  }

  /** The answers given, by tool call id. */
  answerTo(id: string): ToolAnswer | undefined {
    return this.answers.find((answer) => answer.id === id)
  }

  set(change: Partial<TalkSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...change }
    for (const listener of this.listeners) listener()
  }

  /** Google is ready. */
  ready(): void {
    this.set({ phase: 'live', ready: true })
  }

  /** The rep's words this exchange, as Google heard them. */
  hear(rep: string, hearing = ''): void {
    this.set({
      captions: { ...this.snapshot.captions, rep, hearing },
      words: this.snapshot.words + 1,
    })
  }

  /** The Assistant's words, as it says them. */
  say(assistant: string): void {
    this.set({
      captions: { ...this.snapshot.captions, assistant },
      words: this.snapshot.words + 1,
    })
  }

  /** It ended by itself. */
  finish(end: TalkEnd): void {
    this.set({ phase: 'ended', end, speaking: false, working: 0 })
  }
}

/** Every talk made, newest last. */
export class FakeTalks {
  readonly made: FakeTalk[] = []

  readonly make = (options: TalkOptions): Talk => {
    const talk = new FakeTalk(options)
    this.made.push(talk)
    return talk
  }

  last(): FakeTalk {
    const talk = this.made.at(-1)
    if (!talk) throw new Error('No talk was made.')
    return talk
  }
}
