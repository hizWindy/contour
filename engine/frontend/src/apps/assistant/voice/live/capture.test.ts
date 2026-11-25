/**
 * The mic's tap on the page (PLAN-V28 T2-1), with a fake `AudioContext` and a fake
 * `AudioWorkletNode`: it loads the capture worklet, hears the mic in one channel at the device's
 * own rate, hands each 20 ms piece on, follows another mic in the same tap, and lets go at the end.
 * The worklet's own work (the filter, the rate, the pieces) is plain code, proved in `dsp.test.ts`.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { openCapture } from './capture'
import type { Frame } from './dsp'
import { FakeContext, installAudio, type FakeAudio } from './fake-audio'

let audio: FakeAudio

beforeEach(() => {
  audio = installAudio()
})

describe("the mic's tap (T2-1)", () => {
  it('loads its worklet, hears the mic in one channel, and hands its pieces on', async () => {
    const context = new FakeContext()
    const stream = { kind: 'stream' } as unknown as MediaStream
    const frames: Frame[] = []
    const tap = await openCapture(context.asContext, stream, (frame) => frames.push(frame))
    const node = audio.nodes[0]

    expect(context.modules[0]).toMatch(/capture\.worklet/)
    expect(node?.name).toBe('contour-live-capture')
    expect(node?.options).toMatchObject({
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: 'explicit',
    })
    // The mic's sound goes into the tap and the bars' analyser, never to the speakers.
    expect(context.sources[0]?.stream).toBe(stream)
    expect(context.sources[0]?.connected).toHaveLength(2)
    expect(context.sources[0]?.connected).toContain(node)
    expect(context.sources[0]?.connected).not.toContain(context.destination)
    expect(tap.bars).not.toBeNull()
    // A context the browser keeps waiting is asked to run.
    expect(context.resumed).toBe(1)

    const frame: Frame = { pcm: new ArrayBuffer(640), level: 0.2 }
    node?.tell(frame)
    expect(frames).toEqual([frame])
  })

  it('hears another mic in the same tap, and lets go at the end', async () => {
    const context = new FakeContext()
    const tap = await openCapture(
      context.asContext,
      { id: 1 } as unknown as MediaStream,
      () => undefined,
    )
    const headset = { id: 2 } as unknown as MediaStream
    tap.swap(headset)

    expect(context.sources[0]?.disconnected).toBe(true)
    expect(context.sources[1]?.stream).toBe(headset)
    expect(context.sources[1]?.connected).toContain(audio.nodes[0])

    tap.close()
    expect(context.sources[1]?.disconnected).toBe(true)
    expect(audio.nodes[0]?.disconnected).toBe(true)
  })
})
