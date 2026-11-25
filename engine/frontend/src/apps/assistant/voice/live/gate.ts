/**
 * The silence gate (PLAN-V28 T2-1, choice 13): sound goes to Google only while someone talks.
 * Google bills listening by the minute, and each new turn bills the earlier talk again, so silence
 * would cost twice. Plain code: it reads each 20 ms piece (`dsp.ts`) and says what to send.
 *
 * - **It opens** on two loud pieces in a row (40 ms), and sends the 0.5 s from before the speech
 *   first, so the first word is whole. Then every piece goes as it comes.
 * - **It closes** 1.5 s after the last loud piece: those 1.5 s go too, then one `pause` (Google's
 *   `audioStreamEnd`), so Google may answer. Silence after that sends nothing at all.
 * - **Loud follows the room:** the quietest moment of the last 3 seconds is the room's noise, and
 *   speech is 3 times that, never under a floor. A noisy room raises it; a quiet one can't take
 *   it under the floor. For its first half second it assumes a quiet room, so a rep who talks at
 *   once is heard. A noisy room may send its first 2 seconds, then the gate learns it.
 * - **While the Assistant speaks** it is stricter (`strict`), so its own voice coming back through
 *   laptop speakers neither opens the gate nor holds it open (TBC at T5-2).
 * - **No piece goes twice:** what it sent is never in the next opening's 0.5 s.
 *
 * All the numbers are TBC at T5-2.
 */
import type { Frame } from './dsp'

export const GATE = {
  /** One piece of sound. */
  frameMs: 20,
  /** Sent from before the speech, as the gate opens (choice 13). */
  preRollMs: 500,
  /** Sent after the last loud piece, before the pause (choice 13). */
  hangMs: 1500,
  /** Loud pieces in a row that open it: a click or a tap on the desk doesn't. */
  openFrames: 2,
  /** The room's noise is the quietest moment this far back. */
  noiseMs: 3000,
  /** Until it has heard the room this long, it assumes a quiet one. */
  quietStartMs: 500,
  /** Speech is this many times the room's noise (about 10 dB over it). */
  aboveNoise: 3,
  /** The threshold's floor: an RMS of 0.006 is about 44 dB under full scale. */
  floor: 0.006,
  /** While the Assistant speaks: this many times the noise, */
  strictAboveNoise: 6,
  /** and never under this (about 30 dB under full scale). */
  strictFloor: 0.03,
  /** How fast the level the noise is read from follows each piece (0 to 1). */
  smoothing: 0.3,
} as const

export type GateNumbers = { -readonly [Key in keyof typeof GATE]: number }

/** What to do with one piece. */
export interface GateStep {
  /** The pieces to send now, oldest first: the 0.5 s from before, as it opens. */
  send: ArrayBuffer[]
  /** One `pause` after them: the rep went quiet. */
  pause: boolean
  /** It opened on this piece: the rep started talking. */
  opened: boolean
  /** It closed on this piece. */
  closed: boolean
}

const NOTHING: GateStep = { send: [], pause: false, opened: false, closed: false }

function frames(ms: number, frameMs: number): number {
  return Math.max(1, Math.round(ms / frameMs))
}

export class Gate {
  private readonly numbers: GateNumbers
  /** The pieces kept while it is shut: the 0.5 s before speech, and the loud ones that open it. */
  private readonly kept: ArrayBuffer[] = []
  private readonly keepMost: number
  private readonly hangFrames: number
  /** The smoothed level of the last 3 seconds, for the room's noise. */
  private readonly levels: number[] = []
  private readonly levelsMost: number
  private readonly quietStart: number
  private smooth = -1
  private shut = true
  private loudRun = 0
  private quietRun = 0
  private strict = false

  constructor(numbers: Partial<GateNumbers> = {}) {
    this.numbers = { ...GATE, ...numbers }
    const { frameMs } = this.numbers
    // The 0.5 s before the first loud piece, and the loud pieces that open it.
    this.keepMost = frames(this.numbers.preRollMs, frameMs) + this.numbers.openFrames
    this.hangFrames = frames(this.numbers.hangMs, frameMs)
    this.levelsMost = frames(this.numbers.noiseMs, frameMs)
    this.quietStart = frames(this.numbers.quietStartMs, frameMs)
  }

  /** True while sound goes to Google. */
  get open(): boolean {
    return !this.shut
  }

  /** The room's noise now: the quietest moment of the last 3 seconds. */
  get noise(): number {
    // Its first half second assumes a quiet room (see the file's notes).
    if (this.levels.length < this.quietStart) return 0
    return Math.min(...this.levels)
  }

  /** The level a piece must be over to count as speech. */
  get threshold(): number {
    const { floor, aboveNoise, strictFloor, strictAboveNoise } = this.numbers
    return this.strict
      ? Math.max(strictFloor, this.noise * strictAboveNoise)
      : Math.max(floor, this.noise * aboveNoise)
  }

  /** Stricter while the Assistant speaks. */
  setStrict(on: boolean): void {
    this.strict = on
  }

  /** One piece in: what to send now. */
  push(frame: Frame): GateStep {
    const loud = frame.level > this.threshold
    this.hear(frame.level)
    if (this.shut) {
      this.kept.push(frame.pcm)
      if (this.kept.length > this.keepMost) this.kept.shift()
      this.loudRun = loud ? this.loudRun + 1 : 0
      if (this.loudRun < this.numbers.openFrames) return NOTHING
      this.shut = false
      this.quietRun = 0
      return { send: this.kept.splice(0), pause: false, opened: true, closed: false }
    }
    this.quietRun = loud ? 0 : this.quietRun + 1
    if (this.quietRun < this.hangFrames) {
      return { send: [frame.pcm], pause: false, opened: false, closed: false }
    }
    this.shut = true
    this.loudRun = 0
    return { send: [frame.pcm], pause: true, opened: false, closed: true }
  }

  /**
   * One piece while nothing may go yet (before `ready`, or while the socket opens again): it learns
   * the room and keeps the last 0.5 s, but never opens. So a sentence begun while it connects
   * goes from its last 0.5 s, the one burst the relay allows, once it is ready.
   */
  listen(frame: Frame): void {
    const loud = frame.level > this.threshold
    this.hear(frame.level)
    this.shut = true
    this.quietRun = 0
    this.kept.push(frame.pcm)
    if (this.kept.length > this.keepMost) this.kept.shift()
    this.loudRun = loud ? this.loudRun + 1 : 0
  }

  /**
   * Shuts it now (Mute): one `pause` if it was open, and nothing kept, so no sound from before
   * goes when it opens again.
   */
  close(): GateStep {
    const wasOpen = !this.shut
    this.shut = true
    this.loudRun = 0
    this.quietRun = 0
    this.kept.length = 0
    return wasOpen ? { send: [], pause: true, opened: false, closed: true } : NOTHING
  }

  private hear(level: number): void {
    const value = Number.isFinite(level) ? Math.max(0, level) : 0
    this.smooth =
      this.smooth < 0 ? value : this.smooth + this.numbers.smoothing * (value - this.smooth)
    this.levels.push(this.smooth)
    if (this.levels.length > this.levelsMost) this.levels.shift()
  }
}
