/**
 * The Assistant's voice on the page (PLAN-V28 T2-2), with a fake `AudioContext` and a fake
 * `AudioWorkletNode`: the two contexts (24 kHz for the Assistant's voice where the browser allows,
 * the device's own rate for the mic), made inside the tap or key press that opened the bar for an
 * iPhone's sake; and the playback worklet's messages both ways. The worklet's own buffer is plain
 * code, proved in `playback.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeAudio, primeAudio, takeAudio } from './audio'
import { FakeContext, FussyContext, installAudio, type FakeAudio } from './fake-audio'
import { openPlayer } from './player'

let audio: FakeAudio

beforeEach(() => {
  audio = installAudio()
})

describe('the two audio contexts', () => {
  it("plays the Assistant at 24 kHz, and hears the mic at the device's own rate", () => {
    const made = makeAudio()

    expect(made?.playback.sampleRate).toBe(24_000)
    expect(audio.contexts[0]?.options?.sampleRate).toBeUndefined()
    expect(made?.capture.sampleRate).toBe(48_000)
    // Both are asked to run, inside the tap or key press that made them.
    expect(audio.contexts.map((context) => context.resumed)).toEqual([1, 1])
  })

  it("plays at the device's rate where the browser refuses 24 kHz: the worklet changes it", () => {
    installAudio(FussyContext)

    expect(makeAudio()?.playback.sampleRate).toBe(48_000)
  })

  it('has none where the browser has no Web Audio', () => {
    vi.stubGlobal('AudioContext', undefined)

    expect(makeAudio()).toBeNull()
  })

  it('gives the talk the contexts made inside the tap that opened the bar', () => {
    primeAudio()
    const made = audio.contexts.slice()
    const taken = takeAudio()

    expect(taken?.capture).toBe(made[0])
    expect(taken?.playback).toBe(made[1])
    // Taken once: the next talk makes its own.
    takeAudio()
    expect(audio.contexts).toHaveLength(4)
  })

  it('lets go of contexts made in a tap that no talk took, after 10 seconds', () => {
    vi.useFakeTimers()
    primeAudio()
    vi.advanceTimersByTime(10_000)

    expect(audio.contexts.map((context) => context.closed)).toEqual([true, true])
    takeAudio()
    expect(audio.contexts).toHaveLength(4)
  })
})

describe('the player (T2-2)', () => {
  it('loads its worklet, plays through the speakers, and asks a waiting context to run', async () => {
    const context = new FakeContext({ sampleRate: 24_000 })
    await openPlayer(context.asContext, () => undefined)
    const node = audio.nodes[0]

    expect(context.modules).toHaveLength(1)
    expect(context.modules[0]).toMatch(/playback\.worklet/)
    expect(node?.name).toBe('contour-live-playback')
    expect(node?.options).toMatchObject({ numberOfInputs: 0, numberOfOutputs: 1 })
    expect(node?.connected).toEqual([context.destination])
    expect(context.resumed).toBe(1)
  })

  it('hands the worklet the sound as it comes, its flush, its duck and its end', async () => {
    const context = new FakeContext({ sampleRate: 24_000 })
    const player = await openPlayer(context.asContext, () => undefined)
    const sound = new ArrayBuffer(4800)
    player.push(sound)
    player.duck(true)
    player.flush()
    player.end()
    const node = audio.nodes[0]

    expect(node?.posted.map((one) => one.message)).toEqual([
      { type: 'sound', pcm: sound },
      { type: 'duck', on: true },
      { type: 'flush' },
      { type: 'end' },
    ])
    // The sound moves to the audio thread, not copied.
    expect(node?.posted[0]?.transfer).toEqual([sound])
  })

  it('says when it is speaking, as its worklet tells it, and nothing once closed', async () => {
    const context = new FakeContext({ sampleRate: 24_000 })
    const said: boolean[] = []
    const player = await openPlayer(context.asContext, (on) => said.push(on))
    const node = audio.nodes[0]
    node?.tell({ type: 'speaking' })
    node?.tell({ type: 'quiet' })

    expect(said).toEqual([true, false])
    player.close()
    expect(node?.disconnected).toBe(true)
    node?.tell({ type: 'speaking' })
    expect(said).toEqual([true, false])
  })
})
