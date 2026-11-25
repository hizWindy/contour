/**
 * Live voice's sound, as plain code (PLAN-V28 T2-1, T2-2, choice 11). The two worklets wrap it,
 * so the tests prove it in Node, with no browser.
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
 * **Sound out** (`PlaybackCore`): Gemini's 24 kHz sound plays through a small buffer.
 *
 * - **It starts once about 120 ms are in** (TBC), or once the sound has paused that long, or at
 *   the end of Gemini's turn, so a short "Sure." still plays.
 * - **On `interrupted` it empties** within one 20 ms piece: the next 5 ms fade out, the rest goes.
 * - **The voice drops to a third** while the rep starts to talk over it, and comes back, each over
 *   20 ms, so it never clicks (TBC at T5-2).
 * - **"Speaking" ends when the buffer is empty:** at once after Gemini's turn ended or a flush;
 *   mid-turn, after 200 ms of nothing (TBC), so a late piece doesn't make the pill flicker.
 * - At a device rate other than 24 kHz (a browser that refused a 24 kHz context), the same
 *   `Resampler` changes the rate first.
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

// --- Sound out ------------------------------------------------------------------------------------

/** The player's numbers (all TBC at T5-2). */
export const PLAYBACK = {
  /** Sound buffered before it starts to play: enough for a late piece, short enough to answer fast. */
  startMs: 120,
  /** A flush fades this long, inside one 20 ms piece, so it never clicks. */
  fadeMs: 5,
  /** While the rep starts to talk over it: a third. */
  duckGain: 1 / 3,
  /** Down to a third, or back, over this long. */
  duckMs: 20,
  /** Mid-turn, the buffer empty this long ends "speaking". */
  graceMs: 200,
} as const

/** What the player says as it changes: it started speaking, or it went quiet. */
export type PlaybackChange = 'speaking' | 'quiet'

/** What the page sends the playback worklet. `sound` is 16-bit little-endian PCM at 24 kHz. */
export type ToPlayer =
  | { type: 'sound'; pcm: ArrayBuffer }
  | { type: 'flush' }
  | { type: 'duck'; on: boolean }
  | { type: 'end' }

/** What the playback worklet tells the page. */
export interface FromPlayer {
  type: PlaybackChange
}

export interface PlaybackOptions {
  /** The rate it plays at: the audio context's. */
  rate: number
  /** The rate of the sound it is given. Left out: Gemini's 24 kHz. */
  sourceRate?: number
}

/** The playback worklet's whole job: a small buffer, the flush, the duck and "speaking". */
export class PlaybackCore {
  private readonly resampler: Resampler | null
  private readonly startSamples: number
  private readonly fadeSamples: number
  private readonly graceSamples: number
  private readonly duckStep: number
  /** The sound waiting to play, at the playing rate. */
  private queue: Float32Array[] = []
  private head = 0
  private queued = 0
  /** Sound is going out now (it had its start, and hasn't run dry since). */
  private playing = false
  /** What it says: from the first sound out until the buffer is empty (see the file's notes). */
  private speaking = false
  /** Gemini's turn ended: what is left plays out, however short, and the end is at once. */
  private ended = false
  /** A flush is fading out: samples left of it, of `fadeTotal`. */
  private fadeLeft = 0
  private fadeTotal = 0
  /** Sound waited this long without playing, or ran dry this long mid-turn. */
  private waited = 0
  private dry = 0
  private gain = 1
  private target = 1

  constructor({ rate, sourceRate = RATE_OUT }: PlaybackOptions) {
    this.resampler =
      rate === sourceRate
        ? null
        : new Resampler(sourceRate, rate, 0.45 * Math.min(sourceRate, rate))
    this.startSamples = Math.round((rate * PLAYBACK.startMs) / 1000)
    this.fadeSamples = Math.max(1, Math.round((rate * PLAYBACK.fadeMs) / 1000))
    this.graceSamples = Math.round((rate * PLAYBACK.graceMs) / 1000)
    this.duckStep = 1 / Math.max(1, Math.round((rate * PLAYBACK.duckMs) / 1000))
  }

  /** Sound in, at the source rate. A new piece after Gemini's turn ended starts its next turn. */
  push(samples: Float32Array): void {
    const sound = this.resampler ? this.resampler.push(samples) : samples
    if (sound.length === 0) return
    this.ended = false
    this.queue.push(sound)
    this.queued += sound.length
  }

  /** Gemini's turn ended: what is left plays out, even under the start's 120 ms. */
  end(): void {
    this.ended = true
  }

  /** `interrupted`: the next 5 ms fade out, the rest goes, and "speaking" ends with it. */
  flush(): void {
    this.fadeTotal = this.playing ? Math.min(this.fadeSamples, this.queued) : 0
    this.fadeLeft = this.fadeTotal
    this.keepOnly(this.fadeTotal)
    this.ended = true
    this.waited = 0
    this.dry = 0
  }

  /** Down to a third (the rep started to talk over it), or back, over 20 ms. */
  duck(on: boolean): void {
    this.target = on ? PLAYBACK.duckGain : 1
  }

  /** How much is waiting to play, in samples at the playing rate. */
  get buffered(): number {
    return this.queued
  }

  get isSpeaking(): boolean {
    return this.speaking
  }

  /** Fills one render quantum. Gives back a change of "speaking", or null. */
  pull(out: Float32Array): PlaybackChange | null {
    const before = this.speaking
    if (
      !this.playing &&
      this.queued > 0 &&
      (this.queued >= this.startSamples || this.ended || this.waited >= this.startSamples)
    ) {
      this.playing = true
      this.waited = 0
    }
    let filled = 0
    if (this.playing) {
      while (filled < out.length && this.queued > 0) {
        out[filled] = this.next() * this.nextGain() * this.nextFade()
        filled += 1
      }
    }
    out.fill(0, filled)
    if (filled > 0) {
      this.speaking = true
      this.dry = 0
    }
    if (!this.playing && this.queued > 0) this.waited += out.length
    if (this.playing && this.queued === 0) {
      // Run dry: it waits for its start again, so a late piece doesn't play in bits.
      this.playing = false
      this.fadeLeft = 0
      this.fadeTotal = 0
      if (this.ended) this.speaking = false
    }
    if (!this.playing && this.queued === 0 && this.speaking && !this.ended) {
      this.dry += out.length - filled
      if (this.dry >= this.graceSamples) this.speaking = false
    }
    if (this.queued === 0 && this.ended) this.speaking = false
    return before === this.speaking ? null : this.speaking ? 'speaking' : 'quiet'
  }

  private next(): number {
    const chunk = this.queue[0]
    if (!chunk) return 0
    const sample = chunk[this.head] ?? 0
    this.head += 1
    this.queued -= 1
    if (this.head >= chunk.length) {
      this.queue.shift()
      this.head = 0
    }
    return sample
  }

  private nextGain(): number {
    if (this.gain < this.target) this.gain = Math.min(this.target, this.gain + this.duckStep)
    else if (this.gain > this.target) this.gain = Math.max(this.target, this.gain - this.duckStep)
    return this.gain
  }

  private nextFade(): number {
    if (this.fadeTotal === 0) return 1
    const left = this.fadeLeft
    this.fadeLeft = Math.max(0, left - 1)
    return left / this.fadeTotal
  }

  /** Keeps the next `count` samples and lets the rest go. */
  private keepOnly(count: number): void {
    const kept: Float32Array[] = []
    let need = count
    let head = this.head
    for (const chunk of this.queue) {
      if (need <= 0) break
      const take = Math.min(need, chunk.length - head)
      kept.push(chunk.subarray(head, head + take))
      need -= take
      head = 0
    }
    this.queue = kept
    this.head = 0
    this.queued = count - Math.max(0, need)
  }
}
