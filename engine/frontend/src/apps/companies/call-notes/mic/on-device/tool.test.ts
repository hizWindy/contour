import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoiceToolEvents } from '../voice-tool'
import type { ToEngine } from './engine'
import { fakeTrack, fakeVoice, sound } from './fake-worker'
import { onDeviceModel, prepareVoice, releaseVoice, TOO_SLOW, VoiceNotReady } from './tool'
import { TURN } from './turns'

/*
  The on-device voice tool (PLAN-V24 T4-2) with a fake worker: the real engine and turn finding,
  made-up models, a made-up mic, and a fake clock. No model, no download, no network.
*/

function events() {
  return {
    onReady: vi.fn<VoiceToolEvents['onReady']>(),
    onWords: vi.fn<VoiceToolEvents['onWords']>(),
    onHearing: vi.fn<VoiceToolEvents['onHearing']>(),
    onFinished: vi.fn<VoiceToolEvents['onFinished']>(),
    onProblem: vi.fn<VoiceToolEvents['onProblem']>(),
  }
}

/** Lets the worker's messages, the engine's steps and the tool's answers all run. */
const settle = () => vi.advanceTimersByTimeAsync(0)

/** A pause long enough to end a turn. */
const PAUSE = TURN.pauseMs + 200

/** A tool listening through a fake voice. */
async function listening(fake = fakeVoice()) {
  const heard = events()
  const tool = onDeviceModel(heard, { env: fake.env })
  tool.start(fakeTrack())
  await settle()
  return { fake, heard, tool }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  releaseVoice()
})

describe('the on-device voice tool', () => {
  it('is ready once the model is, and hears the mic it was given', async () => {
    const { fake, heard } = await listening()

    expect(heard.onReady).toHaveBeenCalledTimes(1)
    expect(fake.state.capturing).toBe(true)
    expect(fake.workers[0]?.sent.map((message) => message.type)).toEqual(['prepare', 'start'])
  })

  it('gives the words once, after speech and a pause', async () => {
    const { fake, heard } = await listening()

    fake.hear(sound('speech', 1500))
    await settle()
    expect(heard.onWords).not.toHaveBeenCalled()

    fake.hear(sound('quiet', PAUSE))
    await settle()
    expect(heard.onWords.mock.calls).toEqual([['turn 1']])

    fake.hear(sound('quiet', 5000))
    await settle()
    expect(heard.onWords).toHaveBeenCalledTimes(1)
    expect(heard.onProblem).not.toHaveBeenCalled()
  })

  it('gives a long talk turn by turn, in order, from a 48 kHz mic', async () => {
    const { fake, heard } = await listening()

    for (let turn = 0; turn < 3; turn += 1) {
      fake.hear(sound('speech', 1200, 48000), 48000)
      fake.hear(sound('quiet', PAUSE, 48000), 48000)
    }
    // And one turn longer than the longest: its words come while it carries on.
    fake.hear(sound('speech', TURN.longestMs + 3000, 48000), 48000)
    await settle()

    expect(heard.onWords.mock.calls).toEqual([['turn 1'], ['turn 2'], ['turn 3'], ['turn 4']])
  })

  it('gives the last words at Stop, then finishes, and lets the mic go', async () => {
    const { fake, heard, tool } = await listening()
    fake.hear(sound('speech', 1500))
    await settle()

    tool.stop()
    expect(fake.state.capturing).toBe(false)
    await settle()

    expect(heard.onWords.mock.calls).toEqual([['turn 1']])
    expect(heard.onFinished).toHaveBeenCalledTimes(1)
    expect(heard.onWords.mock.invocationCallOrder[0]).toBeLessThan(
      heard.onFinished.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('finishes at Stop with nothing to say, and says nothing more after an abort', async () => {
    const first = await listening()
    first.tool.stop()
    await settle()
    expect(first.heard.onFinished).toHaveBeenCalledTimes(1)
    expect(first.heard.onWords).not.toHaveBeenCalled()

    const second = await listening(first.fake)
    first.fake.hear(sound('speech', 1500))
    second.tool.abort()
    first.fake.hear(sound('quiet', PAUSE))
    await settle()
    expect(second.heard.onWords).not.toHaveBeenCalled()
    expect(second.heard.onFinished).not.toHaveBeenCalled()
    expect(first.fake.state.capturing).toBe(false)
  })

  it('finishes anyway when the last words never come', async () => {
    const { fake, heard, tool } = await listening()
    const worker = fake.workers[0]
    if (!worker) throw new Error('no worker')
    worker.onmessage = null

    tool.stop()
    await vi.advanceTimersByTimeAsync(15_000)

    expect(heard.onFinished).toHaveBeenCalledTimes(1)
  })

  it("says the voice tool didn't load when the model can't get ready", async () => {
    for (const why of ['download', 'load'] as const) {
      releaseVoice()
      const { heard } = await listening(fakeVoice({ unready: why }))

      expect(heard.onReady).not.toHaveBeenCalled()
      expect(heard.onProblem.mock.calls).toEqual([['tool_failed']])
    }
  })

  it("says the voice tool didn't load when the worker breaks, or the model fails a turn", async () => {
    const crashed = await listening()
    crashed.fake.workers[0]?.crash()
    await settle()
    expect(crashed.heard.onProblem.mock.calls).toEqual([['tool_failed']])
    expect(crashed.fake.state.capturing).toBe(false)

    releaseVoice()
    const broken = await listening(fakeVoice({ breaksOn: 1 }))
    broken.fake.hear(sound('speech', 1500))
    broken.fake.hear(sound('quiet', PAUSE))
    await settle()
    expect(broken.heard.onProblem.mock.calls).toEqual([['tool_failed']])
  })

  it('says there is no mic when it gets no track', () => {
    const heard = events()
    onDeviceModel(heard, { env: fakeVoice().env }).start(null)

    expect(heard.onProblem.mock.calls).toEqual([['no_mic']])
  })

  it('says the device is too slow when the first turns take longer to write than they last', async () => {
    const slow = await listening(fakeVoice({ workMs: (soundMs) => 1.3 * soundMs }))
    for (let turn = 0; turn < TOO_SLOW.turns; turn += 1) {
      slow.fake.hear(sound('speech', 1500))
      slow.fake.hear(sound('quiet', PAUSE))
    }
    await settle()

    expect(slow.heard.onWords).toHaveBeenCalledTimes(TOO_SLOW.turns)
    expect(slow.heard.onProblem.mock.calls).toEqual([['too_slow']])
    expect(slow.fake.state.capturing).toBe(false)
  })

  it('is not too slow when the model keeps up, or for short turns it can only time roughly', async () => {
    const quick = await listening(fakeVoice({ workMs: (soundMs) => 0.8 * soundMs }))
    for (let turn = 0; turn < TOO_SLOW.turns + 2; turn += 1) {
      quick.fake.hear(sound('speech', 1500))
      quick.fake.hear(sound('quiet', PAUSE))
    }
    await settle()
    expect(quick.heard.onProblem).not.toHaveBeenCalled()

    releaseVoice()
    const short = await listening(fakeVoice({ workMs: () => 2000 }))
    for (let turn = 0; turn < TOO_SLOW.turns; turn += 1) {
      short.fake.hear(sound('speech', 400))
      short.fake.hear(sound('quiet', PAUSE))
    }
    await settle()
    expect(short.heard.onWords).toHaveBeenCalledTimes(TOO_SLOW.turns)
    expect(short.heard.onProblem).not.toHaveBeenCalled()
  })

  it('runs where it is told, and tells each turn its length and the model its time', async () => {
    const fake = fakeVoice({ workMs: () => 300 })
    const heard = events()
    const turns: { text: string; soundMs: number; workMs: number }[] = []
    onDeviceModel(heard, {
      env: fake.env,
      device: 'webgpu',
      onTurn: (turn) => turns.push(turn),
    }).start(fakeTrack())
    await settle()
    fake.hear(sound('speech', 1500))
    fake.hear(sound('quiet', PAUSE))
    await settle()

    expect(fake.workers[0]?.sent[0]).toEqual({
      type: 'prepare',
      model: 'moonshine-base',
      device: 'webgpu',
    })
    expect(turns).toHaveLength(1)
    expect(turns[0]?.text).toBe('turn 1')
    expect(turns[0]?.workMs).toBe(300)
    expect(turns[0]?.soundMs).toBeGreaterThanOrEqual(1500)
  })

  it('says it writes names in any case, so the name fix reads them by their words', () => {
    expect(onDeviceModel(events(), { env: fakeVoice().env }).nameCase).toBe('any')
  })

  it('keeps one worker for every tool, so the model loads once', async () => {
    const fake = fakeVoice()
    await listening(fake)
    await listening(fake)

    expect(fake.workers).toHaveLength(1)
    expect(fake.workers[0]?.sent.filter((message) => message.type === 'prepare')).toHaveLength(1)
  })
})

describe('getting the model ready ahead (for T4-3)', () => {
  it('reports the download, and resolves with where the model runs', async () => {
    const fake = fakeVoice()
    const progress: { loaded: number; total: number }[] = []

    const ready = prepareVoice((step) => progress.push(step), { env: fake.env })
    await settle()

    await expect(ready).resolves.toBe('wasm')
    expect(progress.at(-1)).toEqual({ loaded: 100, total: 100 })
  })

  it('says why it failed, and can be tried again', async () => {
    const fake = fakeVoice({ unready: 'download' })

    const failed = prepareVoice(undefined, { env: fake.env })
    const checked = expect(failed).rejects.toEqual(new VoiceNotReady('download'))
    await settle()
    await checked

    const again = prepareVoice(undefined, { env: fake.env })
    const checkedAgain = expect(again).rejects.toBeInstanceOf(VoiceNotReady)
    await settle()
    await checkedAgain
    expect(fake.workers[0]?.sent.filter((message) => message.type === 'prepare')).toHaveLength(2)
  })
})

describe('the voice stays on the device (choice 26)', () => {
  it('sends no request while it listens: the sound goes to the worker and nowhere else', async () => {
    const fetch = vi.fn()
    const beacon = vi.fn()
    const opened = vi.fn()
    const sockets = vi.fn()
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('WebSocket', sockets)
    vi.stubGlobal('EventSource', sockets)
    vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(opened)
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true })

    const { fake, heard, tool } = await listening()
    fake.hear(sound('speech', 1500))
    fake.hear(sound('quiet', PAUSE))
    fake.hear(sound('speech', 900))
    tool.stop()
    await settle()

    expect(heard.onWords).toHaveBeenCalledTimes(2)
    expect(heard.onFinished).toHaveBeenCalledTimes(1)
    for (const network of [fetch, beacon, opened, sockets]) expect(network).not.toHaveBeenCalled()
    // Every sample went to the worker, in the messages the tool sent it.
    const sent =
      fake.workers[0]?.sent.filter(
        (message): message is Extract<ToEngine, { type: 'sound' }> => message.type === 'sound',
      ) ?? []
    expect(sent.reduce((sum, message) => sum + message.samples.length, 0)).toBe(
      sound('speech', 1500).length + sound('quiet', PAUSE).length + sound('speech', 900).length,
    )
  })
})
