// @vitest-environment node
/**
 * The Assistant's small buffer, as plain code (PLAN-V28 T2-2), with no browser: the sound plays in
 * order once 120 ms are in, `interrupted` empties it within one 20 ms piece, "speaking" ends when
 * the buffer is empty, the voice drops to a third without a click, and the rate changes where the
 * browser refused 24 kHz. Tones are made in code; no sound is ever kept.
 */
import { describe, expect, it } from 'vitest'
import { PLAYBACK, PlaybackCore, RATE_OUT } from './dsp'
import { strength, tone } from './tones'

/** Plays `count` render quanta of 128 samples, and gives back the sound and each change. */
function play(core: PlaybackCore, count: number) {
  const sound: number[] = []
  const changes: { at: number; change: string }[] = []
  for (let quantum = 0; quantum < count; quantum += 1) {
    const out = new Float32Array(128)
    const change = core.pull(out)
    if (change) changes.push({ at: sound.length, change })
    sound.push(...out)
  }
  return { sound, changes }
}

/** Samples numbered 1, 2, 3 ... (as small values), so their order can be read back. */
function numbered(from: number, count: number): Float32Array {
  return Float32Array.from({ length: count }, (_, index) => (from + index) / 100_000)
}

const START = Math.round((RATE_OUT * PLAYBACK.startMs) / 1000)

describe('sound out: the small buffer (T2-2)', () => {
  it('plays the sound in order, once 120 ms are in', () => {
    const core = new PlaybackCore({ rate: RATE_OUT })
    core.push(numbered(1, 1000))

    // Under 120 ms: it waits for more.
    const waiting = play(core, 2)
    expect(waiting.sound.every((sample) => sample === 0)).toBe(true)
    expect(core.isSpeaking).toBe(false)

    core.push(numbered(1001, START))
    const { sound, changes } = play(core, 4)
    expect(changes[0]).toEqual({ at: 0, change: 'speaking' })
    expect(sound.slice(0, 512).map((sample) => Math.round(sample * 100_000))).toEqual(
      Array.from({ length: 512 }, (_, index) => index + 1),
    )
  })

  it('on interrupted, empties within one 20 ms piece, with a short fade', () => {
    const core = new PlaybackCore({ rate: RATE_OUT })
    core.push(new Float32Array(RATE_OUT).fill(0.5))
    play(core, 10)
    expect(core.isSpeaking).toBe(true)

    core.flush()
    const { sound, changes } = play(core, 20)
    const lastSound = sound.findLastIndex((sample) => sample !== 0)

    // A 20 ms piece is 480 samples at 24 kHz: the sound ends well inside it (the 5 ms fade).
    expect(lastSound).toBeLessThan(480)
    expect(lastSound).toBeLessThanOrEqual(Math.round((RATE_OUT * PLAYBACK.fadeMs) / 1000))
    // It fades down, never jumps up.
    expect(Math.abs(sound[1] ?? 0)).toBeLessThan(0.5)
    expect(core.buffered).toBe(0)
    // "Speaking" ends with the first quantum after the flush, the one the fade fits in.
    expect(changes).toEqual([{ at: 0, change: 'quiet' }])
  })

  it('"speaking" ends when the buffer is empty, after Gemini\'s turn ended', () => {
    const core = new PlaybackCore({ rate: RATE_OUT })
    core.push(new Float32Array(1280).fill(0.25))
    core.end()

    // 1,280 samples are 10 quanta: speaking starts at once (the turn is whole), and ends with the
    // tenth, the one that empties it.
    const { changes } = play(core, 12)
    expect(changes).toEqual([
      { at: 0, change: 'speaking' },
      { at: 9 * 128, change: 'quiet' },
    ])
  })

  it('mid-turn, a gap shorter than 200 ms keeps "speaking", so the pill doesn\'t flicker', () => {
    const core = new PlaybackCore({ rate: RATE_OUT })
    core.push(new Float32Array(START).fill(0.25))
    play(core, Math.ceil(START / 128))
    expect(core.isSpeaking).toBe(true)

    // 100 ms of nothing, then more of the same turn.
    play(core, 19)
    expect(core.isSpeaking).toBe(true)
    core.push(new Float32Array(START).fill(0.25))
    expect(play(core, 30).changes).toEqual([])

    // A gap of 200 ms ends it.
    const gap = play(core, 40)
    expect(gap.changes.at(-1)?.change).toBe('quiet')
  })

  it('plays a short turn under 120 ms once the turn has ended', () => {
    const core = new PlaybackCore({ rate: RATE_OUT })
    core.push(new Float32Array(600).fill(0.25))
    expect(play(core, 2).sound.every((sample) => sample === 0)).toBe(true)

    core.end()
    expect(play(core, 1).sound[0]).toBeCloseTo(0.25, 6)
  })

  it('drops the voice to a third over 20 ms while the rep starts to talk, and back', () => {
    const core = new PlaybackCore({ rate: RATE_OUT })
    core.push(new Float32Array(RATE_OUT).fill(0.6))
    play(core, 4)

    core.duck(true)
    const down = play(core, 4).sound
    // A ramp, not a jump: the first sample is still near full.
    expect(down[0]).toBeGreaterThan(0.55)
    // 20 ms is 480 samples: from there on, a third.
    expect(down[480]).toBeCloseTo(0.2, 3)

    core.duck(false)
    const up = play(core, 4).sound
    expect(up[0]).toBeLessThan(0.25)
    expect(up[480]).toBeCloseTo(0.6, 3)
  })

  it('changes the rate first where the browser refused a 24 kHz context', () => {
    const core = new PlaybackCore({ rate: 48_000 })
    core.push(tone(1000, RATE_OUT, 0.5))
    core.end()
    const { sound } = play(core, 180)
    const steady = Float32Array.from(sound.slice(2000, 2000 + 48 * 400))

    expect(strength(steady, 1000, 48_000)).toBeCloseTo(0.5, 2)
  })
})
