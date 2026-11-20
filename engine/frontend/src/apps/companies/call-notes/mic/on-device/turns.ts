/**
 * Turns, found in the mic's sound (PLAN-V24 choice 24). A turn is what you say before a pause. The
 * voice detector (Silero VAD) gives each 32 ms window of sound a chance that it is speech; this file
 * decides from those chances where a turn starts and ends, and hands the turn's sound on to be
 * turned into words. It is plain code with no model inside, so the tests give it made-up chances.
 *
 * The bar's smart pause (choice 8) sits on top: it waits longer when the words sound unfinished. The
 * pause here is the short one that makes words show soon after you stop talking.
 */

/** The models hear sound at 16 kHz. */
export const RATE = 16000
/** The voice detector's window: 512 samples, 32 ms. */
export const WINDOW = 512
const WINDOW_MS = (WINDOW / RATE) * 1000

/** The numbers that find a turn. All TBC at S2, on a phone. */
export const TURN = {
  /** A window is speech when its chance is above this (Silero's own default). */
  start: 0.5,
  /** Speech carries on while the chance stays at or above this (Silero's: 0.15 below start). */
  keep: 0.35,
  /** This much quiet after speech ends the turn. */
  pauseMs: 500,
  /** Sound kept from before the first speech window, so the first word isn't clipped. */
  beforeMs: 192,
  /** Quiet kept after the last speech window. */
  afterMs: 96,
  /** A turn with less speech than this is a click or a breath, and is dropped. */
  shortestMs: 250,
  /** A turn this long goes on to be written while the talk carries on. */
  longestMs: 20000,
  /** A turn shorter than this may get quiet on each side before the model hears it (`padded`). */
  padUnderMs: 1500,
}

const windows = (ms: number): number => Math.round(ms / WINDOW_MS)

/** One array from many. */
function joined(parts: readonly Float32Array[]): Float32Array {
  const all = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    all.set(part, at)
    at += part.length
  }
  return all
}

/**
 * Finds turns in a stream of windows. `step` takes each window with its chance of speech, and gives
 * back a turn's sound when one has ended. `flush` gives the turn in progress (at Stop).
 */
export class TurnFinder {
  private speaking = false
  private sound: Float32Array[] = []
  private before: Float32Array[] = []
  /** Speech windows in this turn, and quiet windows since the last one. */
  private voiced = 0
  private quiet = 0

  step(window: Float32Array, chance: number): Float32Array | null {
    if (!this.speaking) {
      if (chance <= TURN.start) {
        this.before.push(window)
        if (this.before.length > windows(TURN.beforeMs)) this.before.shift()
        return null
      }
      this.speaking = true
      this.sound = [...this.before, window]
      this.before = []
      this.voiced = 1
      this.quiet = 0
      return null
    }
    this.sound.push(window)
    if (chance >= TURN.keep) {
      this.voiced += 1
      this.quiet = 0
    } else {
      this.quiet += 1
    }
    if (this.quiet >= windows(TURN.pauseMs)) return this.end()
    if (this.sound.length >= windows(TURN.longestMs)) return this.end()
    return null
  }

  flush(): Float32Array | null {
    return this.speaking ? this.end() : null
  }

  private end(): Float32Array | null {
    // The quiet at the end goes, but for a little: a model can hear words in a long silence.
    const keep = this.sound.length - Math.max(0, this.quiet - windows(TURN.afterMs))
    const sound = this.voiced >= windows(TURN.shortestMs) ? joined(this.sound.slice(0, keep)) : null
    this.speaking = false
    this.sound = []
    this.voiced = 0
    this.quiet = 0
    return sound
  }
}

/**
 * A short turn with `padMs` of quiet on each side, as the model will hear it; a longer one as it is.
 * Moonshine Base hears a short command better so ("Send it." was "Senator," without), Tiny worse:
 * each model has its own (models.ts).
 */
export function padded(turn: Float32Array, padMs: number): Float32Array {
  if (padMs <= 0 || (turn.length / RATE) * 1000 >= TURN.padUnderMs) return turn
  const pad = Math.round((padMs / 1000) * RATE)
  const out = new Float32Array(turn.length + 2 * pad)
  out.set(turn, pad)
  return out
}

/**
 * From the mic's own rate (often 48 kHz) to 16 kHz, a chunk at a time. Each new sample is the
 * average of the ones it stands for, which also takes out most of the sound too high for 16 kHz.
 */
export class Resampler {
  private carry = new Float32Array(0)
  /** Where the next new sample starts, in the carried samples. */
  private at = 0
  private readonly from: number

  constructor(from: number) {
    this.from = from
  }

  push(chunk: Float32Array): Float32Array {
    if (this.from === RATE) return chunk
    const step = this.from / RATE
    const input = joined([this.carry, chunk])
    const out: number[] = []
    while (this.at + step <= input.length) {
      const first = Math.floor(this.at)
      const last = Math.max(first + 1, Math.floor(this.at + step))
      let sum = 0
      for (let index = first; index < last; index += 1) sum += input[index] ?? 0
      out.push(sum / (last - first))
      this.at += step
    }
    const used = Math.floor(this.at)
    this.carry = input.slice(used)
    this.at -= used
    return Float32Array.from(out)
  }
}

/** Cuts a stream of 16 kHz sound into the detector's windows, keeping the rest for next time. */
export class Windows {
  private rest = new Float32Array(0)

  push(sound: Float32Array): Float32Array[] {
    const all = joined([this.rest, sound])
    const found: Float32Array[] = []
    let at = 0
    for (; at + WINDOW <= all.length; at += WINDOW) found.push(all.slice(at, at + WINDOW))
    this.rest = all.slice(at)
    return found
  }
}
