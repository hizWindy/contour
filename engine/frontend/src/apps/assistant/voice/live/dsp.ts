/**
 * Live voice's sound, as plain code (PLAN-V28 T2-1, choice 11). The capture worklet wraps it, so
 * the tests prove it in Node, with no browser.
 *
 * **Sound in** (`CaptureCore`): the mic's sound at the device's own rate (44.1 or 48 kHz: asking
 * the browser for 16 kHz fails in Firefox) becomes 16 kHz, 16-bit, little-endian pieces of exactly
 * 320 samples (20 ms, 640 bytes), each with its loudness for the silence gate (`gate.ts`).
 *
 * - **A real low-pass filter first** (`Resampler`): a windowed-sinc FIR with its cut-off at about
 *   7 kHz (a Blackman window, so what passes 8 kHz is more than 70 dB down). So sound above 8 kHz,
 *   which 16 kHz can't hold, never folds back into speech as a whistle.
 * - **Then fractional resampling:** the filter is worked out at each 16 kHz sample's own place
 *   between the device's samples (bandlimited interpolation: a table of the filter at 256 places
 *   between two samples). For 48 kHz that place is always a whole sample; for 44.1 kHz it moves by
 *   2.75625 samples each time. It is the filter and the move in one pass, with no second
 *   interpolation to add its own noise. The `Resampler` in `on-device/turns.ts` only averages
 *   blocks, so it isn't used here.
 *
 * Nothing here keeps or sends sound: the pieces go where the caller sends them.
 */

/** Sound to the relay: 16-bit PCM, mono, 16 kHz (the relay's `sample_rate_in`). */
export const RATE_IN = 16_000
/** Gemini's sound from the relay: 16-bit PCM, mono, 24 kHz (`sample_rate_out`). */
export const RATE_OUT = 24_000
/** One piece of sound to the relay: 20 ms at 16 kHz. */
export const FRAME_SAMPLES = 320
/** Its size: 16-bit samples, so 640 bytes (the relay's `frame_bytes`). */
export const FRAME_BYTES = FRAME_SAMPLES * 2
/** The capture's cut-off: about 7 kHz, under 16 kHz's limit of 8 kHz (T2-1). */
export const CUTOFF_HZ = 7_000

/** The filter's slope: from passing to stopped over about 2 kHz around the cut-off. */
const TRANSITION_HZ = 2_000
/** Places between two samples the filter is worked out at, ahead of time. */
const PHASES = 256

function sinc(x: number): number {
  if (x === 0) return 1
  const angle = Math.PI * x
  return Math.sin(angle) / angle
}

/** The Blackman window, from -1 to 1: 0 at both ends. */
function blackman(u: number): number {
  if (u <= -1 || u >= 1) return 0
  return 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u)
}

/**
 * A low-pass filter and a change of rate, in one pass: a windowed-sinc FIR worked out at each new
 * sample's own place between the old ones. Feed it sound in pieces of any size: what it gives back
 * is the same as for the whole sound at once. The sound before the first piece counts as silence.
 */
export class Resampler {
  readonly from: number
  readonly to: number
  /** Taps on each side of a new sample's place. */
  private readonly half: number
  private readonly taps: number
  /** The filter at each of `PHASES` places, `taps` values each, each set adding up to 1. */
  private readonly table: Float32Array
  /** The old sound still needed, from absolute sample `start`. */
  private buffer: Float32Array
  private count: number
  private start: number
  /** New samples made so far: the next one sits at old sample `made * from / to`. */
  private made = 0

  /** `cutoff` in Hz: at most 0.45 of the lower rate, so it always stops short of its limit. */
  constructor(from: number, to: number, cutoff: number = CUTOFF_HZ) {
    if (!(from > 0 && to > 0)) throw new RangeError('A rate must be over 0.')
    this.from = from
    this.to = to
    const edge = Math.min(cutoff, 0.45 * Math.min(from, to))
    // A Blackman window needs about 5.5 / N of the rate for its slope.
    this.half = Math.max(2, Math.ceil((5.5 * from) / (2 * TRANSITION_HZ)))
    this.taps = this.half * 2
    this.table = new Float32Array(PHASES * this.taps)
    const scale = (2 * edge) / from
    for (let phase = 0; phase < PHASES; phase += 1) {
      const at = phase / PHASES
      const row = phase * this.taps
      let sum = 0
      for (let tap = 0; tap < this.taps; tap += 1) {
        // How far the new sample's place is from this tap, in old samples.
        const distance = at + (this.half - 1 - tap)
        const value = sinc(scale * distance) * blackman(distance / this.half)
        this.table[row + tap] = value
        sum += value
      }
      // Unity gain: a steady level passes unchanged at every place.
      for (let tap = 0; tap < this.taps; tap += 1) {
        this.table[row + tap] = (this.table[row + tap] ?? 0) / sum
      }
    }
    // Silence before the first sample, so the first new sample has its left side.
    this.count = this.half - 1
    this.start = -(this.half - 1)
    this.buffer = new Float32Array(Math.max(1024, this.count * 2))
  }

  /** Feeds old samples in, and gives back every new sample they complete. */
  push(input: Float32Array): Float32Array {
    this.append(input)
    const end = this.start + this.count
    const most = Math.ceil(((input.length + this.half) * this.to) / this.from) + 2
    const out = new Float32Array(most)
    let made = 0
    for (;;) {
      // Exact, as both are whole numbers well under 2^53, even after hours.
      const place = (this.made * this.from) / this.to
      let whole = Math.floor(place)
      let phase = Math.round((place - whole) * PHASES)
      if (phase === PHASES) {
        phase = 0
        whole += 1
      }
      const first = whole - this.half + 1
      if (whole + this.half >= end || made >= most) break
      const row = phase * this.taps
      const from = first - this.start
      let sum = 0
      for (let tap = 0; tap < this.taps; tap += 1) {
        sum += (this.buffer[from + tap] ?? 0) * (this.table[row + tap] ?? 0)
      }
      out[made] = sum
      made += 1
      this.made += 1
    }
    this.drop()
    return out.subarray(0, made)
  }

  private append(input: Float32Array): void {
    if (this.count + input.length > this.buffer.length) {
      this.drop()
      if (this.count + input.length > this.buffer.length) {
        const grown = new Float32Array(Math.max(this.buffer.length * 2, this.count + input.length))
        grown.set(this.buffer.subarray(0, this.count))
        this.buffer = grown
      }
    }
    this.buffer.set(input, this.count)
    this.count += input.length
  }

  /** Lets go of the old samples no new sample needs any more. */
  private drop(): void {
    const place = Math.floor((this.made * this.from) / this.to)
    const needed = place - this.half + 1
    const gone = needed - this.start
    if (gone <= 0) return
    const kept = Math.max(0, this.count - gone)
    this.buffer.copyWithin(0, Math.min(gone, this.count), this.count)
    this.count = kept
    this.start = needed
  }
}

/** A 20 ms piece for the relay, and how loud it is. */
export interface Frame {
  /** Exactly 640 bytes: 320 16-bit samples, little-endian. */
  pcm: ArrayBuffer
  /** Its loudness: the RMS of its wave, from 0 to 1. */
  level: number
}

/** One piece: the samples as 16-bit little-endian PCM, and their RMS. */
export function frameOf(samples: Float32Array): Frame {
  const pcm = new ArrayBuffer(samples.length * 2)
  const view = new DataView(pcm)
  let sum = 0
  for (let index = 0; index < samples.length; index += 1) {
    const raw = samples[index] ?? 0
    const sample = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0
    sum += sample * sample
    view.setInt16(index * 2, Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), true)
  }
  return { pcm, level: samples.length === 0 ? 0 : Math.sqrt(sum / samples.length) }
}

/** 16-bit little-endian PCM as samples from -1 to 1. An odd last byte is left out. */
export function fromPcm16(bytes: ArrayBuffer): Float32Array {
  const view = new DataView(bytes)
  const count = Math.floor(bytes.byteLength / 2)
  const samples = new Float32Array(count)
  for (let index = 0; index < count; index += 1) {
    samples[index] = view.getInt16(index * 2, true) / 0x8000
  }
  return samples
}

/** Cuts 16 kHz sound into pieces of exactly 320 samples. A part piece waits for the rest. */
export class Framer {
  private readonly samples = new Float32Array(FRAME_SAMPLES)
  private filled = 0

  push(sound: Float32Array): Frame[] {
    const frames: Frame[] = []
    let at = 0
    while (at < sound.length) {
      const count = Math.min(sound.length - at, FRAME_SAMPLES - this.filled)
      this.samples.set(sound.subarray(at, at + count), this.filled)
      this.filled += count
      at += count
      if (this.filled === FRAME_SAMPLES) {
        frames.push(frameOf(this.samples))
        this.filled = 0
      }
    }
    return frames
  }
}

/** The capture worklet's whole job: the device's sound in, 20 ms pieces at 16 kHz out. */
export class CaptureCore {
  private readonly resampler: Resampler
  private readonly framer = new Framer()

  constructor(rate: number) {
    this.resampler = new Resampler(rate, RATE_IN, CUTOFF_HZ)
  }

  push(sound: Float32Array): Frame[] {
    return this.framer.push(this.resampler.push(sound))
  }
}
