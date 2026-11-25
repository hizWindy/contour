// @vitest-environment node
/**
 * Live voice's sound in, as plain code (PLAN-V28 T2-1), with no browser: the low-pass filter and
 * the change of rate, and the 20 ms pieces. Tones are made in code; no sound is ever kept.
 */
import { describe, expect, it } from 'vitest'
import {
  CaptureCore,
  FRAME_BYTES,
  FRAME_SAMPLES,
  Framer,
  frameOf,
  fromPcm16,
  RATE_IN,
  Resampler,
} from './dsp'
import { strength, tone } from './tones'

/** Feeds a sound in the audio thread's own pieces of 128 samples. */
function inQuanta(resampler: Resampler, sound: Float32Array): Float32Array {
  const parts: number[] = []
  for (let at = 0; at < sound.length; at += 128) {
    parts.push(...resampler.push(sound.subarray(at, at + 128)))
  }
  return Float32Array.from(parts)
}

/** The steady middle: past the filter's start, a whole number of cycles of `hz`. */
function middle(sound: Float32Array, rate: number, hz: number): Float32Array {
  const cycle = rate / hz
  const length = Math.floor((sound.length - 400) / cycle) * cycle
  return sound.subarray(200, 200 + Math.round(length))
}

describe('sound in: the low-pass filter, then the change of rate (T2-1)', () => {
  it('a 1 kHz tone at 48 kHz comes out at 1 kHz at 16 kHz', () => {
    const out = inQuanta(new Resampler(48_000, RATE_IN), tone(1000, 48_000, 1))
    const steady = middle(out, RATE_IN, 1000)

    expect(out.length).toBeGreaterThan(15_900)
    expect(strength(steady, 1000, RATE_IN)).toBeCloseTo(0.5, 2)
    // Nothing else: the other frequencies are as good as silent.
    for (const other of [500, 2000, 3000, 4000, 7000]) {
      expect(strength(steady, other, RATE_IN)).toBeLessThan(0.002)
    }
  })

  it('a 1 kHz tone at 44.1 kHz comes out at 1 kHz too: the place moves by a fraction', () => {
    const out = inQuanta(new Resampler(44_100, RATE_IN), tone(1000, 44_100, 1))
    const steady = middle(out, RATE_IN, 1000)

    expect(out.length).toBeGreaterThan(15_900)
    expect(strength(steady, 1000, RATE_IN)).toBeCloseTo(0.5, 2)
    for (const other of [500, 2000, 3000, 4000, 7000]) {
      expect(strength(steady, other, RATE_IN)).toBeLessThan(0.003)
    }
  })

  it('stops high sounds folding into speech: 12 kHz would fold to 4 kHz, and is gone', () => {
    // At 16 kHz, a 12 kHz tone can't exist: without the filter it would come out as 4 kHz.
    const out = inQuanta(new Resampler(48_000, RATE_IN), tone(12_000, 48_000, 1))
    const steady = out.subarray(200, out.length - 200)

    expect(strength(steady, 4000, RATE_IN)).toBeLessThan(0.0005)
  })

  it('stops 9 kHz at 44.1 kHz too, which would fold to 7 kHz', () => {
    const out = inQuanta(new Resampler(44_100, RATE_IN), tone(9000, 44_100, 1))
    const steady = out.subarray(200, out.length - 200)

    expect(strength(steady, 7000, RATE_IN)).toBeLessThan(0.001)
  })

  it('gives the same sound in pieces of any size as all at once', () => {
    const sound = tone(440, 48_000, 0.25)
    const whole = new Resampler(48_000, RATE_IN).push(sound)
    const pieces = new Resampler(48_000, RATE_IN)
    const parts: number[] = []
    let at = 0
    const sizes = [1, 37, 128, 500, 3, 1000, 64]
    for (let turn = 0; at < sound.length; turn += 1) {
      const size = sizes[turn % sizes.length] ?? 128
      parts.push(...pieces.push(sound.subarray(at, at + size)))
      at += size
    }

    expect(parts).toHaveLength(whole.length)
    expect(Math.max(...parts.map((value, index) => Math.abs(value - (whole[index] ?? 0))))).toBe(0)
  })

  it('passes a steady level unchanged', () => {
    const out = new Resampler(44_100, RATE_IN).push(new Float32Array(44_100).fill(0.25))
    const steady = out.subarray(200, out.length - 10)

    for (const value of steady) expect(value).toBeCloseTo(0.25, 5)
  })
})

describe('the 20 ms pieces (T2-1)', () => {
  it('cuts 16 kHz sound into pieces of exactly 640 bytes, keeping a part piece for the rest', () => {
    const framer = new Framer()

    const first = framer.push(new Float32Array(1000))
    expect(first).toHaveLength(3)
    for (const frame of first) expect(frame.pcm.byteLength).toBe(FRAME_BYTES)

    // 40 samples wait; 280 more make the fourth piece, with none over.
    expect(framer.push(new Float32Array(279))).toHaveLength(0)
    expect(framer.push(new Float32Array(1))).toHaveLength(1)
    expect(FRAME_BYTES).toBe(640)
    expect(FRAME_SAMPLES).toBe(320)
  })

  it('writes 16-bit little-endian samples, clipped, and says how loud the piece is', () => {
    const samples = new Float32Array(FRAME_SAMPLES).fill(0.5)
    samples[0] = 1
    samples[1] = -1
    samples[2] = 2
    samples[3] = Number.NaN
    const frame = frameOf(samples)
    const view = new DataView(frame.pcm)

    expect(view.getInt16(0, true)).toBe(32767)
    expect(view.getInt16(2, true)).toBe(-32768)
    expect(view.getInt16(4, true)).toBe(32767)
    expect(view.getInt16(6, true)).toBe(0)
    expect(view.getInt16(8, true)).toBe(16384)
    // Little-endian: the low byte first.
    expect(new Uint8Array(frame.pcm, 8, 2)).toEqual(new Uint8Array([0x00, 0x40]))
    expect(frameOf(new Float32Array(FRAME_SAMPLES).fill(0.5)).level).toBeCloseTo(0.5, 6)
    expect(frameOf(new Float32Array(FRAME_SAMPLES)).level).toBe(0)
  })

  it('reads 16-bit little-endian sound back, as the player does', () => {
    const frame = frameOf(new Float32Array([0, 0.5, -0.5, 1]))

    expect([...fromPcm16(frame.pcm)].map((value) => Number(value.toFixed(3)))).toEqual([
      0, 0.5, -0.5, 1,
    ])
  })

  it('makes a second of a 48 kHz mic into 20 ms pieces at 16 kHz, each 640 bytes', () => {
    const core = new CaptureCore(48_000)
    const sound = tone(1000, 48_000, 1)
    const frames = []
    for (let at = 0; at < sound.length; at += 128) {
      frames.push(...core.push(sound.subarray(at, at + 128)))
    }

    // A second is 50 pieces; the filter holds back its last few milliseconds.
    expect(frames.length).toBeGreaterThanOrEqual(49)
    expect(frames.length).toBeLessThanOrEqual(50)
    for (const frame of frames) expect(frame.pcm.byteLength).toBe(640)
    // The tone's RMS is its amplitude over the square root of 2.
    expect(frames[10]?.level).toBeCloseTo(0.5 / Math.SQRT2, 2)
  })
})
