/**
 * The soft tone (PLAN-V24 T5-1, choice 30), with a fake sound: two quiet sine notes, rising as
 * listening starts and falling as it stops, under a fifth of a second; nothing before a user's
 * gesture, nothing late, and no error where there is no Web Audio.
 */
import { describe, expect, it } from 'vitest'
import { makeTone, TONE, TONE_NOTES, type ToneAudio } from './tone'

class FakeParam {
  readonly calls: { kind: 'set' | 'ramp'; value: number; at: number }[] = []
  setValueAtTime(value: number, at: number): this {
    this.calls.push({ kind: 'set', value, at })
    return this
  }
  exponentialRampToValueAtTime(value: number, at: number): this {
    this.calls.push({ kind: 'ramp', value, at })
    return this
  }
}

class FakeNode {
  readonly to: unknown[] = []
  disconnected = false
  connect(to: unknown): unknown {
    this.to.push(to)
    return to
  }
  disconnect(): void {
    this.disconnected = true
  }
}

class FakeOscillator extends FakeNode {
  type = ''
  readonly frequency = new FakeParam()
  startAt = -1
  stopAt = -1
  onended: (() => void) | null = null
  start(at: number): void {
    this.startAt = at
  }
  stop(at: number): void {
    this.stopAt = at
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam()
}

/** A made-up audio context: it keeps every node, and resumes as the test says. */
class FakeContext {
  state: AudioContextState = 'running'
  readonly currentTime = 10
  readonly destination = { name: 'speakers' }
  readonly oscillators: FakeOscillator[] = []
  readonly gains: FakeGain[] = []
  resumes = 0
  /** What `resume` does: let it run, or keep it waiting. */
  resumeTo: AudioContextState = 'running'
  /** Before `resume` answers, the clock moves this far (a browser that took its time). */
  resumeTakes = 0
  refuse = false
  private readonly clock: { now: number }
  constructor(clock: { now: number }) {
    this.clock = clock
  }
  createOscillator(): FakeOscillator {
    const oscillator = new FakeOscillator()
    this.oscillators.push(oscillator)
    return oscillator
  }
  createGain(): FakeGain {
    const gain = new FakeGain()
    this.gains.push(gain)
    return gain
  }
  resume(): Promise<void> {
    this.resumes += 1
    if (this.refuse) return Promise.reject(new Error('not allowed'))
    this.clock.now += this.resumeTakes
    this.state = this.resumeTo
    return Promise.resolve()
  }
}

function fakeAudio({ activated = true, noAudio = false } = {}) {
  const clock = { now: 1_000 }
  const context = new FakeContext(clock)
  let asked = 0
  const audio: ToneAudio = {
    activated: () => activated,
    context: () => {
      asked += 1
      return noAudio ? null : (context as unknown as AudioContext)
    },
    now: () => clock.now,
  }
  return { audio, context, asked: () => asked }
}

/** Lets the promise answers run. */
async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('the tone (choice 30)', () => {
  it('starting rises and stopping falls: two quiet sine notes, under a fifth of a second', () => {
    const { audio, context } = fakeAudio()
    const tone = makeTone(audio)
    tone('start')
    expect(context.oscillators.map((note) => note.type)).toEqual(['sine', 'sine'])
    expect(context.oscillators.map((note) => note.frequency.calls[0]?.value)).toEqual([
      ...TONE_NOTES.start,
    ])
    expect(TONE_NOTES.start[0]).toBeLessThan(TONE_NOTES.start[1] ?? 0)
    // Quiet: each note rises to the peak and fades back to silence.
    for (const gain of context.gains) {
      const ramps = gain.gain.calls.filter((call) => call.kind === 'ramp')
      expect(Math.max(...ramps.map((ramp) => ramp.value))).toBe(TONE.peak)
      expect(ramps.at(-1)?.value).toBeLessThan(0.001)
    }
    expect(TONE.peak).toBeLessThanOrEqual(0.05)
    // Short: from the first note's start to the last one's end.
    const first = Math.min(...context.oscillators.map((note) => note.startAt))
    const last = Math.max(...context.oscillators.map((note) => note.stopAt))
    expect(last - first).toBeLessThan(0.2)
    // Each note goes through its own gain to the speakers.
    expect(context.gains.every((gain) => gain.to.includes(context.destination))).toBe(true)

    tone('stop')
    expect(context.oscillators.slice(2).map((note) => note.frequency.calls[0]?.value)).toEqual([
      ...TONE_NOTES.stop,
    ])
    expect(TONE_NOTES.stop[0]).toBeGreaterThan(TONE_NOTES.stop[1] ?? 0)
  })

  it('each note lets the sound go once it has played', () => {
    const { audio, context } = fakeAudio()
    makeTone(audio)('start')
    for (const note of context.oscillators) note.onended?.()
    expect(context.oscillators.every((note) => note.disconnected)).toBe(true)
    expect(context.gains.every((gain) => gain.disconnected)).toBe(true)
  })

  it('plays nothing before a user’s gesture, and makes no audio context', () => {
    const { audio, context, asked } = fakeAudio({ activated: false })
    makeTone(audio)('start')
    expect(asked()).toBe(0)
    expect(context.oscillators).toHaveLength(0)
  })

  it('with no Web Audio, plays nothing and fails nothing', () => {
    const { audio } = fakeAudio({ noAudio: true })
    expect(() => {
      makeTone(audio)('stop')
    }).not.toThrow()
  })

  it('a context the browser keeps waiting plays once it may run, and never late', async () => {
    // Let run at once: the tone plays.
    const soon = fakeAudio()
    soon.context.state = 'suspended'
    makeTone(soon.audio)('start')
    expect(soon.context.oscillators).toHaveLength(0)
    await settle()
    expect(soon.context.resumes).toBe(1)
    expect(soon.context.oscillators).toHaveLength(2)

    // Let run only later, at the next gesture: a tone that late plays nothing.
    const late = fakeAudio()
    late.context.state = 'suspended'
    late.context.resumeTakes = 2_000
    makeTone(late.audio)('stop')
    await settle()
    expect(late.context.oscillators).toHaveLength(0)

    // Kept waiting, or refused: nothing, and no error.
    const waiting = fakeAudio()
    waiting.context.state = 'suspended'
    waiting.context.resumeTo = 'suspended'
    makeTone(waiting.audio)('start')
    await settle()
    expect(waiting.context.oscillators).toHaveLength(0)

    const refused = fakeAudio()
    refused.context.state = 'suspended'
    refused.context.refuse = true
    makeTone(refused.audio)('start')
    await settle()
    expect(refused.context.oscillators).toHaveLength(0)
  })
})
