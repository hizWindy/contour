// @vitest-environment node
/**
 * The silence gate (PLAN-V28 T2-1, choice 13), with made-up pieces of sound: speech after a silence
 * keeps its 0.5 s from before, 2 s of silence send one pause, the threshold follows the room's
 * noise with a floor, it is stricter while the Assistant speaks, and no piece goes twice.
 */
import { describe, expect, it } from 'vitest'
import type { Frame } from './dsp'
import { Gate, GATE, type GateStep } from './gate'

/** Each piece carries its own number, so what was sent can be read back in order. */
let made = 0
function piece(level: number): Frame {
  made += 1
  const pcm = new ArrayBuffer(640)
  new DataView(pcm).setUint32(0, made, true)
  return { pcm, level }
}

function numberOf(pcm: ArrayBuffer): number {
  return new DataView(pcm).getUint32(0, true)
}

const QUIET = 0.001
const SPEECH = 0.2

/** Pushes `count` pieces at a level, and gives back every step. */
function feed(gate: Gate, count: number, level: number): GateStep[] {
  return Array.from({ length: count }, () => gate.push(piece(level)))
}

function sent(steps: readonly GateStep[]): number[] {
  return steps.flatMap((step) => step.send.map(numberOf))
}

function pauses(steps: readonly GateStep[]): number {
  return steps.filter((step) => step.pause).length
}

/** 4 seconds of a quiet room: the gate knows the room from then on. */
function settled(): Gate {
  const gate = new Gate()
  feed(gate, 200, QUIET)
  return gate
}

describe('the silence gate (T2-1)', () => {
  it('sends nothing in silence, and no pause', () => {
    const gate = new Gate()
    const steps = feed(gate, 500, QUIET)

    expect(sent(steps)).toEqual([])
    expect(pauses(steps)).toBe(0)
    expect(gate.open).toBe(false)
  })

  it('keeps the 0.5 s from before the speech, and sends it first, in order', () => {
    const gate = settled()
    feed(gate, 40, QUIET)
    const lastQuiet = made
    const opening = feed(gate, 2, SPEECH)

    // The first loud piece alone doesn't open it; the second does.
    expect(opening[0]?.send).toEqual([])
    expect(opening[1]?.opened).toBe(true)
    // 0.5 s is 25 pieces from before the speech, then the two loud ones, oldest first.
    const numbers = sent(opening)
    expect(numbers).toHaveLength(25 + 2)
    expect(numbers.slice(0, 25)).toEqual(
      Array.from({ length: 25 }, (_, index) => lastQuiet - 24 + index),
    )
    expect(numbers.slice(25)).toEqual([lastQuiet + 1, lastQuiet + 2])
  })

  it('sends each piece as it comes while it is open', () => {
    const gate = settled()
    feed(gate, 2, SPEECH)
    const talking = feed(gate, 30, SPEECH)

    expect(talking.every((step) => step.send.length === 1 && !step.pause)).toBe(true)
    const numbers = sent(talking)
    expect(numbers).toEqual(Array.from({ length: 30 }, (_, index) => (numbers[0] ?? 0) + index))
  })

  it('sends one pause after 2 s of silence: the 1.5 s after the speech go first', () => {
    const gate = settled()
    feed(gate, 2, SPEECH)
    feed(gate, 50, SPEECH)
    const after = feed(gate, 100, QUIET)

    expect(pauses(after)).toBe(1)
    // The pause comes with the 75th quiet piece (1.5 s), which is sent too, and nothing after.
    const at = after.findIndex((step) => step.pause)
    expect(at).toBe(74)
    expect(after[at]?.closed).toBe(true)
    expect(sent(after)).toHaveLength(75)
    expect(gate.open).toBe(false)
  })

  it('never sends a piece twice: an opening soon after a close holds only what is new', () => {
    const gate = settled()
    feed(gate, 2, SPEECH)
    const first = feed(gate, 80, QUIET)
    const quick = feed(gate, 5, QUIET)
    const again = feed(gate, 2, SPEECH)

    const before = new Set(sent(first))
    const reopened = sent(again)
    // The 5 quiet pieces after the pause, the 5 quick ones and the 2 loud ones: none sent before.
    expect(sent(first)).toHaveLength(75)
    expect(reopened).toHaveLength(12)
    expect(reopened.some((number) => before.has(number))).toBe(false)
    expect(sent(quick)).toEqual([])
  })

  it('follows the room: a noisy room raises the threshold, and speech still opens it', () => {
    const gate = new Gate()
    // Its first half second assumes a quiet room, so the noise opens it; it learns the room, and
    // shuts within 2 seconds.
    const start = feed(gate, 200, 0.02)
    expect(start.findIndex((step) => step.pause)).toBeLessThan(100)
    expect(gate.open).toBe(false)

    expect(gate.threshold).toBeCloseTo(0.06, 3)
    // A little louder than the room is still the room.
    expect(sent(feed(gate, 5, 0.04))).toEqual([])
    // Speech, well over it, opens it.
    expect(feed(gate, 2, 0.15).at(-1)?.opened).toBe(true)
  })

  it('never puts the threshold under its floor in a silent room', () => {
    const gate = new Gate()
    feed(gate, 200, 0.0002)

    expect(gate.threshold).toBe(GATE.floor)
    expect(sent(feed(gate, 5, GATE.floor * 0.9))).toEqual([])
  })

  it('hears a rep who talks at once: its first 3 seconds assume a quiet room', () => {
    const gate = new Gate()

    expect(feed(gate, 2, SPEECH).at(-1)?.opened).toBe(true)
  })

  it('is stricter while the Assistant speaks, so its own voice from the speakers stays out', () => {
    const gate = settled()
    gate.setStrict(true)

    expect(gate.threshold).toBe(GATE.strictFloor)
    // Its voice coming back faintly through the mic doesn't open it.
    expect(sent(feed(gate, 10, 0.02))).toEqual([])
    // The rep talking over it does.
    expect(feed(gate, 2, SPEECH).at(-1)?.opened).toBe(true)

    gate.setStrict(false)
    expect(gate.threshold).toBe(GATE.floor)
  })

  it('shuts at once for Mute: one pause if it was open, and nothing from before goes later', () => {
    const gate = settled()
    feed(gate, 2, SPEECH)

    expect(gate.close()).toEqual({ send: [], pause: true, opened: false, closed: true })
    expect(gate.close().pause).toBe(false)
    // After Mute, the pieces kept while it was shut are gone: an opening sends only new ones.
    const reopened = sent(feed(gate, 2, SPEECH))
    expect(reopened).toHaveLength(2)
  })
})
