import { describe, expect, it } from 'vitest'
import { padded, RATE, Resampler, TURN, TurnFinder, WINDOW, Windows } from './turns'

/*
  Finding turns in the mic's sound (PLAN-V24 choice 24), with made-up chances of speech: no model.
*/

const WINDOW_MS = (WINDOW / RATE) * 1000

/** Feeds `ms` of windows with one chance of speech; returns the turns that ended. */
function feed(finder: TurnFinder, chance: number, ms: number): Float32Array[] {
  const turns: Float32Array[] = []
  for (let done = 0; done < ms; done += WINDOW_MS) {
    const turn = finder.step(new Float32Array(WINDOW).fill(chance), chance)
    if (turn) turns.push(turn)
  }
  return turns
}

const msOf = (turn: Float32Array): number => (turn.length / RATE) * 1000

describe('TurnFinder', () => {
  it('ends a turn after the pause, with a little sound before and after the speech', () => {
    const finder = new TurnFinder()
    expect(feed(finder, 0.1, 1000)).toEqual([])
    expect(feed(finder, 0.9, 1200)).toEqual([])
    const turns = feed(finder, 0.1, TURN.pauseMs + 100)

    expect(turns).toHaveLength(1)
    const turn = turns[0] ?? new Float32Array(0)
    // The speech, the sound kept from before it, and a little of the quiet after.
    expect(msOf(turn)).toBeGreaterThanOrEqual(1200 + TURN.beforeMs - WINDOW_MS)
    expect(msOf(turn)).toBeLessThanOrEqual(1200 + TURN.beforeMs + TURN.afterMs + 2 * WINDOW_MS)
    expect(turn[0]).toBeCloseTo(0.1)
    expect(turn.at(-1)).toBeCloseTo(0.1)
  })

  it('gives each turn once, and nothing in a long quiet', () => {
    const finder = new TurnFinder()
    feed(finder, 0.9, 800)
    expect(feed(finder, 0.1, 5000)).toHaveLength(1)
    expect(feed(finder, 0.1, 5000)).toEqual([])
  })

  it('keeps a turn going through a short dip, and through chances just under the start', () => {
    const finder = new TurnFinder()
    feed(finder, 0.9, 600)
    expect(feed(finder, 0.1, TURN.pauseMs - 100)).toEqual([])
    expect(feed(finder, 0.4, 2000)).toEqual([])
    expect(feed(finder, 0.1, TURN.pauseMs + 100)).toHaveLength(1)
  })

  it('drops a click or a breath', () => {
    const finder = new TurnFinder()
    feed(finder, 0.9, TURN.shortestMs - 2 * WINDOW_MS)
    expect(feed(finder, 0.1, TURN.pauseMs + 100)).toEqual([])
  })

  it('cuts a long talk into turns, so the words come while it carries on', () => {
    const finder = new TurnFinder()
    const turns = feed(finder, 0.9, 2.5 * TURN.longestMs)

    expect(turns).toHaveLength(2)
    for (const turn of turns) expect(msOf(turn)).toBeLessThanOrEqual(TURN.longestMs + WINDOW_MS)
  })

  it('gives the turn in progress at Stop, and nothing when there is none', () => {
    const finder = new TurnFinder()
    expect(finder.flush()).toBeNull()
    feed(finder, 0.9, 700)
    expect(msOf(finder.flush() ?? new Float32Array(0))).toBeGreaterThanOrEqual(700)
    expect(finder.flush()).toBeNull()
  })
})

describe('padded', () => {
  it('puts quiet on each side of a short turn, as the model hears it', () => {
    const turn = new Float32Array(Math.round(0.8 * RATE)).fill(0.5)
    const heard = padded(turn, 300)
    const pad = Math.round(0.3 * RATE)

    expect(heard).toHaveLength(turn.length + 2 * pad)
    expect(heard.subarray(0, pad).every((sample) => sample === 0)).toBe(true)
    expect(heard.subarray(pad, pad + turn.length)).toEqual(turn)
    expect(heard.subarray(pad + turn.length).every((sample) => sample === 0)).toBe(true)
  })

  it('leaves a longer turn, and any turn for a model with no padding, as it is', () => {
    const long = new Float32Array(Math.round((TURN.padUnderMs / 1000) * RATE)).fill(0.5)
    const short = new Float32Array(Math.round(0.5 * RATE)).fill(0.5)

    expect(padded(long, 300)).toBe(long)
    expect(padded(short, 0)).toBe(short)
  })
})

describe('Resampler', () => {
  it('turns 48 kHz into 16 kHz, a chunk at a time, losing nothing at the joins', () => {
    const resampler = new Resampler(48000)
    const parts = [1000, 4801, 3, 4196].map((length) =>
      resampler.push(new Float32Array(length).fill(0.5)),
    )
    const total = parts.reduce((sum, part) => sum + part.length, 0)

    expect(total).toBe(Math.floor(10000 / 3))
    for (const part of parts) for (const sample of part) expect(sample).toBeCloseTo(0.5)
  })

  it('averages what each new sample stands for, so a tone too high for 16 kHz fades', () => {
    const resampler = new Resampler(48000)
    // A tone at 24 kHz: +1, -1, +1, ... Each three samples average to a third or less.
    const tone = Float32Array.from({ length: 4800 }, (_, index) => (index % 2 === 0 ? 1 : -1))
    for (const sample of resampler.push(tone))
      expect(Math.abs(sample)).toBeLessThanOrEqual(1 / 3 + 1e-6)
  })

  it('handles a rate that is not a whole multiple (44.1 kHz)', () => {
    const resampler = new Resampler(44100)
    const out = resampler.push(new Float32Array(44100).fill(0.25))

    expect(Math.abs(out.length - RATE)).toBeLessThanOrEqual(1)
  })

  it('leaves 16 kHz as it is', () => {
    const chunk = new Float32Array(160).fill(0.3)
    expect(new Resampler(RATE).push(chunk)).toBe(chunk)
  })
})

describe('Windows', () => {
  it('cuts sound into the detector windows, keeping the rest for the next chunk', () => {
    const windows = new Windows()
    expect(windows.push(new Float32Array(WINDOW - 1))).toHaveLength(0)
    expect(windows.push(new Float32Array(WINDOW + 2))).toHaveLength(2)
    expect(windows.push(new Float32Array(WINDOW - 1))).toHaveLength(1)
  })
})
