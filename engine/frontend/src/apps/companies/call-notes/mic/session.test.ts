/**
 * The mic session on its own (PLAN-V24 Part 1), with the fake mic, the fake voice tool and an
 * exact clock: the clean sound and one check a conversation (T1-1), following the mic (T1-2), and
 * "Reconnecting" (T1-3). T4-3: the engine picks itself, the move to the model after 5 seconds, the
 * model's download before the mic opens, and the name fix on its words. Made-up names only:
 * Vitera Pty Ltd, Jo Sample, North Wind, Sample Logistics Pty Ltd. No sound is ever kept.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultMic, MIC_KEY } from './devices'
import {
  CHROME_ANDROID,
  CHROME_LAPTOP,
  FakeMic,
  FIREFOX_LAPTOP,
  HEADSET,
  IPHONE,
  IPHONE_APP,
  LAPTOP_MIC,
  type FakeDevice,
  type FakeMicOptions,
} from './fake-mic'
import {
  afterHanded,
  DEAF_LEVEL,
  DEAF_VOICE_MS,
  lettersOf,
  MicSession,
  SOUND,
  TOO_SLOW_FLOOR_MS,
  TOOL_START_MS,
  type MicSessionOptions,
} from './session'
import { ENGINE_KEY, type BrowserFacts } from './voice-engine'
import { browserService, NETWORK } from './voice-tool'
import { nowUsing } from './words'

/** A USB mic, made up, for a third mic on the desk. */
const DESK_MIC: FakeDevice = { id: 'mic-desk', label: 'Desk Microphone (USB)' }

const HEADSET_NAME = 'Headset Microphone (Jabra Evolve2 65)'
const LAPTOP_NAME = 'Microphone Array (Realtek)'

function open(options: FakeMicOptions = {}, more: Partial<MicSessionOptions> = {}) {
  const mic = new FakeMic(options)
  const session = new MicSession({
    mode: 'note',
    tool: 'browser_service',
    env: mic.env(),
    makeTool: mic.tool,
    ...more,
  })
  return { mic, session, now: () => session.getSnapshot() }
}

/** Moves the clock, and lets every promise the move freed settle. */
async function tick(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

/** Opens the mic and waits until it listens. */
async function listening(options: FakeMicOptions = {}, more: Partial<MicSessionOptions> = {}) {
  const set = open(options, more)
  set.session.start()
  await tick(100)
  expect(set.now().phase).toBe('listening')
  return set
}

beforeEach(() => {
  vi.useFakeTimers()
})

describe('clean sound (T1-1, choice 1)', () => {
  it('asks for echo cancellation, noise suppression and auto gain, in one channel', async () => {
    const { mic } = await listening()
    expect(mic.asked).toEqual([
      {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      },
    ])
  })

  it('a mic picked by hand keeps its exact id, with the same clean sound', async () => {
    const mic = new FakeMic({ devices: [HEADSET, LAPTOP_MIC] })
    mic.storage.set(MIC_KEY, LAPTOP_MIC.id)
    const session = new MicSession({
      mode: 'note',
      tool: 'browser_service',
      env: mic.env(),
      makeTool: mic.tool,
    })
    session.start()
    await tick(100)
    expect(mic.asked).toEqual([{ audio: { deviceId: { exact: 'mic-laptop' }, ...SOUND } }])
    expect(session.getSnapshot().device).toEqual({
      id: 'mic-laptop',
      name: 'Microphone Array (Realtek)',
    })
  })

  it('asks for voice isolation too, only where the browser has it', async () => {
    const { mic } = await listening({ voiceIsolation: true })
    expect(mic.asked).toEqual([{ audio: { ...SOUND, voiceIsolation: true } }])
  })

  it('a check only asks for the same clean sound', async () => {
    const { mic, session, now } = open({}, { mode: 'check' })
    session.start()
    await tick(100)
    expect(now().phase).toBe('checked')
    expect(mic.asked).toEqual([{ audio: SOUND }])
  })
})

describe('the voice tool hears the mic’s own track (T1-1, choice 2)', () => {
  it('is handed the track the mic opened, the one the bars follow', async () => {
    const { mic } = await listening()
    expect(mic.tracks).toHaveLength(1)
    expect(mic.tools[0]?.track).toBe(mic.tracks[0])
  })
})

describe('one check a conversation (T1-1, choice 5)', () => {
  it('hands over the words, and the mic, the bars and the tool keep running', async () => {
    const { mic, session, now } = await listening()
    mic.say('Log a call with Jo Sample')
    mic.hear('follow up Friday')
    expect(session.handOver()).toEqual({
      text: 'Log a call with Jo Sample follow up Friday',
      fixes: [],
    })
    expect(now()).toMatchObject({ phase: 'listening', chunks: [], hearing: '', problem: null })
    expect(now().steps).toEqual({ found: 'pass', allowed: 'pass', hear: 'pass', ready: 'pass' })
    expect(now().bars).not.toBeNull()
    expect(mic.live()).toBe(1)
    expect(mic.tools).toHaveLength(1)
    expect(mic.tools[0]).toMatchObject({ started: true, stopped: false, aborted: false })
  })

  it('the next turn starts at once: no second check, and no second mic', async () => {
    const { mic, session, now } = await listening()
    mic.say('Log a call with Jo Sample')
    session.handOver()
    mic.say('Add a task to send the quote')
    expect(now().chunks).toEqual(['Add a task to send the quote'])
    expect(session.handOver().text).toBe('Add a task to send the quote')
    mic.say('Open today')
    expect(session.handOver().text).toBe('Open today')
    // One mic opened, one tool started, one check: three turns.
    expect(mic.asked).toHaveLength(1)
    expect(mic.tracks).toHaveLength(1)
    expect(mic.tools).toHaveLength(1)
    expect(now().phase).toBe('listening')
  })

  it('words still being heard go with their turn, once, when the tool writes them out', async () => {
    const { mic, session, now } = await listening()
    mic.hear('log a call with north wind')
    expect(session.handOver().text).toBe('log a call with north wind')
    // The service writes out the words it was still hearing: they went with the first turn.
    mic.say('Log a call with Northwind.')
    mic.hear('')
    expect(session.text()).toBe('')
    mic.say('Add a task for Friday')
    expect(now().chunks).toEqual(['Add a task for Friday'])
  })

  it('words that run on past the hand-over count in the next turn only', async () => {
    const { mic, session, now } = await listening()
    mic.hear('log a call with north wind')
    session.handOver()
    mic.hear('log a call with north wind add a')
    expect(now().hearing).toBe('add a')
    mic.say('Log a call with Northwind. Add a task.')
    mic.hear('')
    expect(now().chunks).toEqual(['Add a task.'])
    expect(session.text()).toBe('Add a task.')
  })

  it('hands over the names it put right with their words, and starts the next turn with none', async () => {
    const { mic, session, now } = await listening({}, { names: ['Vitera Pty Ltd', 'Jo Sample'] })
    mic.say('Spoke to Jo at Vitara')
    expect(session.handOver()).toEqual({
      text: 'Spoke to Jo at Vitera',
      fixes: [{ from: 'Vitara', to: 'Vitera' }],
    })
    expect(now().fixes).toEqual([])
  })

  it('starts the turn’s clock again, so "too slow" counts from this turn', async () => {
    const { mic, session, now } = await listening()
    const first = now().listeningSince ?? 0
    await tick(30_000)
    mic.say('Log a call with Jo Sample')
    session.handOver()
    expect(now().listeningSince).toBe(Date.now())
    expect(now().listeningSince).toBeGreaterThanOrEqual(first + 30_000)
  })

  it('Done after a hand-over writes out only the turn in progress', async () => {
    const { mic, session, now } = await listening()
    mic.say('Log a call with Jo Sample')
    session.handOver()
    mic.say('Add a task for Friday')
    session.finish()
    await tick(0)
    expect(now().phase).toBe('done')
    expect(session.text()).toBe('Add a task for Friday')
  })
})

/** Opens the mic with one picked by hand on this computer, and waits until it listens. */
async function listeningWithPick(devices: FakeDevice[], picked: FakeDevice) {
  const mic = new FakeMic({ devices })
  mic.storage.set(MIC_KEY, picked.id)
  const session = new MicSession({
    mode: 'note',
    tool: 'browser_service',
    env: mic.env(),
    makeTool: mic.tool,
  })
  session.start()
  await tick(100)
  expect(session.getSnapshot()).toMatchObject({ phase: 'listening', device: { id: picked.id } })
  return { mic, session, now: () => session.getSnapshot() }
}

describe('it follows the mic (T1-2, choice 3)', () => {
  it('the mic unplugged mid-turn: the default one, the words kept, and "Now using {mic}"', async () => {
    const { mic, session, now } = await listening({ devices: [HEADSET, LAPTOP_MIC] })
    mic.say('Spoke to Jo Sample')
    mic.hear('about the lease')
    mic.unplug()
    await tick(0)
    expect(now()).toMatchObject({
      phase: 'listening',
      problem: null,
      device: { id: 'mic-laptop', name: LAPTOP_NAME },
      movedTo: { id: 'mic-laptop', name: LAPTOP_NAME },
      chunks: ['Spoke to Jo Sample', 'about the lease'],
      hearing: '',
    })
    expect(nowUsing(now().movedTo?.name ?? '')).toBe('Now using Microphone Array (Realtek).')
    // The new mic opened with the clean sound, and the unplugged one was let go.
    expect(mic.asked.at(-1)).toEqual({ audio: SOUND })
    expect(mic.live()).toBe(1)
    expect(now().bars).not.toBeNull()
    // The voice tool hears the new mic: the old one was let go, a new one has its track.
    expect(mic.tools).toHaveLength(2)
    expect(mic.tools[0]?.aborted).toBe(true)
    expect(mic.tools[1]?.track).toBe(mic.tracks[1])
    mic.say('They want a test fit')
    expect(session.text()).toBe('Spoke to Jo Sample about the lease They want a test fit')
    // The check isn't run again.
    expect(now().steps).toEqual({ found: 'pass', allowed: 'pass', hear: 'pass', ready: 'pass' })
  })

  it('a headset plugged in is used when no mic was picked by hand', async () => {
    const { mic, now } = await listening({ devices: [LAPTOP_MIC] })
    mic.say('Spoke to Jo Sample')
    mic.plug(HEADSET)
    await tick(0)
    expect(now()).toMatchObject({
      phase: 'listening',
      device: { id: 'mic-headset', name: HEADSET_NAME },
      movedTo: { id: 'mic-headset', name: HEADSET_NAME },
      chunks: ['Spoke to Jo Sample'],
    })
    expect(now().devices.map((device) => device.id)).toEqual(['mic-headset', 'mic-laptop'])
    expect(mic.live()).toBe(1)
    expect(mic.tools[1]?.track).toBe(mic.tracks[1])
  })

  it('a mic plugged in that the computer doesn’t make its default changes nothing but the list', async () => {
    const { mic, now } = await listening({ devices: [LAPTOP_MIC] })
    mic.plug(DESK_MIC, { asDefault: false })
    await tick(0)
    expect(now()).toMatchObject({ device: { id: 'mic-laptop' }, movedTo: null })
    expect(now().devices.map((device) => device.id)).toEqual(['mic-laptop', 'mic-desk'])
    expect(mic.asked).toHaveLength(1)
    expect(mic.tools).toHaveLength(1)
  })

  it('a mic picked by hand stays while it is there', async () => {
    const { mic, now } = await listeningWithPick([LAPTOP_MIC], LAPTOP_MIC)
    mic.plug(HEADSET)
    await tick(0)
    expect(now()).toMatchObject({ device: { id: 'mic-laptop' }, movedTo: null })
    expect(mic.asked).toHaveLength(1)
    expect(mic.storage.get(MIC_KEY)).toBe('mic-laptop')
  })

  it('a mic picked by hand that goes: the default one, and the pick is forgotten', async () => {
    const { mic, now } = await listeningWithPick([HEADSET, LAPTOP_MIC], LAPTOP_MIC)
    mic.say('Spoke to Jo Sample')
    mic.unplug()
    await tick(0)
    expect(now()).toMatchObject({
      phase: 'listening',
      device: { id: 'mic-headset' },
      movedTo: { id: 'mic-headset' },
      chunks: ['Spoke to Jo Sample'],
    })
    expect(mic.asked.at(-1)).toEqual({ audio: SOUND })
    expect(mic.storage.has(MIC_KEY)).toBe(false)
  })

  it('the only mic unplugged: it stops at once, with the words kept, as before', async () => {
    const { mic, session, now } = await listening()
    mic.say('Spoke to Jo Sample')
    mic.unplug()
    expect(now()).toMatchObject({ phase: 'failed', problem: 'cut_off' })
    expect(session.text()).toBe('Spoke to Jo Sample')
    expect(mic.live()).toBe(0)
  })

  it('a move that won’t open keeps the mic in use while it works', async () => {
    const { mic, now } = await listening({ devices: [LAPTOP_MIC] })
    mic.refuse = { name: 'NotReadableError' }
    mic.plug(HEADSET)
    await tick(0)
    expect(now()).toMatchObject({ phase: 'listening', problem: null, device: { id: 'mic-laptop' } })
    expect(mic.live()).toBe(1)
    expect(mic.tools).toHaveLength(1)
  })

  it('the voice tool losing the mic first waits for the mic to be followed', async () => {
    const { mic, session, now } = await listening({ devices: [HEADSET, LAPTOP_MIC] })
    mic.say('Spoke to Jo Sample')
    // The speech service says it lost the mic before the track says it ended.
    mic.tools[0]?.events.onProblem('no_mic')
    mic.unplug()
    await tick(0)
    expect(now()).toMatchObject({ phase: 'listening', problem: null, device: { id: 'mic-laptop' } })
    expect(mic.tools).toHaveLength(2)
    mic.say('They want a test fit')
    expect(session.text()).toBe('Spoke to Jo Sample They want a test fit')
  })

  it('a voice tool that loses the mic while it is still there fails, as before', async () => {
    const { mic, session, now } = await listening({ devices: [HEADSET, LAPTOP_MIC] })
    mic.say('Spoke to Jo Sample')
    mic.tools[0]?.events.onProblem('no_mic')
    await tick(0)
    expect(now()).toMatchObject({ phase: 'failed', problem: 'no_mic' })
    expect(session.text()).toBe('Spoke to Jo Sample')
    expect(mic.live()).toBe(0)
  })

  it('stops following once the mic is let go', async () => {
    const { mic, session, now } = await listening({ devices: [LAPTOP_MIC] })
    session.close()
    mic.plug(HEADSET)
    await tick(0)
    expect(mic.asked).toHaveLength(1)
    expect(now().movedTo).toBeNull()
    expect(mic.live()).toBe(0)
  })
})

describe('"Reconnecting" (T1-3, choice 4)', () => {
  it('is on while the voice tool tries a network blip again, and the words stay', async () => {
    const { mic, session, now } = await listening()
    mic.say('Spoke to Jo Sample')
    mic.reconnecting(true)
    expect(now()).toMatchObject({ phase: 'listening', reconnecting: true, problem: null })
    mic.reconnecting(false)
    mic.say('about the lease')
    expect(now().reconnecting).toBe(false)
    expect(session.text()).toBe('Spoke to Jo Sample about the lease')
  })

  it('goes when the tool fails after its tries, and the words stay', async () => {
    const { mic, session, now } = await listening()
    mic.say('Spoke to Jo Sample')
    mic.reconnecting(true)
    mic.fail('tool_failed')
    expect(now()).toMatchObject({ phase: 'failed', problem: 'tool_failed', reconnecting: false })
    expect(session.text()).toBe('Spoke to Jo Sample')
  })

  it('with the browser’s own speech service: a blip, "Reconnecting", then the words carry on', async () => {
    const mic = new FakeMic()
    mic.install()
    const session = new MicSession({
      mode: 'note',
      tool: 'browser_service',
      env: mic.env(),
      makeTool: browserService,
    })
    session.start()
    await tick(100)
    expect(session.getSnapshot().phase).toBe('listening')
    const [service] = mic.recognitions
    // It hears the mic's own track.
    expect(service?.track).toBe(mic.tracks[0])
    service?.result('Spoke to Jo Sample')
    service?.result('about the', false)
    service?.error('network')
    service?.end()
    await tick(NETWORK.reconnectingAfterMs)
    expect(session.getSnapshot()).toMatchObject({
      phase: 'listening',
      reconnecting: true,
      problem: null,
    })
    expect(session.text()).toBe('Spoke to Jo Sample about the')
    service?.result('and a floor plan')
    expect(session.getSnapshot().reconnecting).toBe(false)
    expect(session.getSnapshot().chunks).toEqual([
      'Spoke to Jo Sample',
      'about the',
      'and a floor plan',
    ])
    session.close()
  })
})

describe('the engine picks itself (PLAN-V24 T4-3, choice 22)', () => {
  it.each<[string, BrowserFacts, boolean]>([
    ['Safari on an iPhone', IPHONE, true],
    ['the installed app on an iPhone', IPHONE_APP, true],
    ['Firefox on a laptop, which has no speech service', FIREFOX_LAPTOP, false],
  ])('%s gets the model on the device, not the browser’s service', async (_, browser, speech) => {
    const { mic } = await listening({ browser, speech })
    expect(mic.model.asked.prepare).toBe(1)
    // One tool, the model's: it writes names in any case (choice 28).
    expect(mic.tools.map((tool) => tool.nameCase)).toEqual(['any'])
  })

  it.each<[string, BrowserFacts]>([
    ['Chrome on a laptop', CHROME_LAPTOP],
    ['Chrome on an Android phone', CHROME_ANDROID],
  ])('%s gets the browser’s speech service', async (_, browser) => {
    const { mic } = await listening({ browser })
    expect(mic.model.asked.prepare).toBe(0)
    expect(mic.tools.map((tool) => tool.nameCase)).toEqual(['capitals'])
  })

  it('with browser_model, every device gets the model, Chrome on a laptop too', async () => {
    for (const browser of [CHROME_LAPTOP, CHROME_ANDROID, IPHONE]) {
      const { mic, session } = await listening({ browser }, { tool: 'browser_model' })
      expect(mic.tools.map((tool) => tool.nameCase)).toEqual(['any'])
      session.close()
    }
  })

  it('with typing, nothing opens a tool', async () => {
    const { mic, session, now } = open({}, { tool: 'typing' })
    session.start()
    await tick(100)
    expect(now()).toMatchObject({ phase: 'failed', problem: 'no_speech_tool' })
    expect(mic.tools).toHaveLength(0)
    expect(mic.model.asked.prepare).toBe(0)
  })
})

describe('a service that doesn’t start in 5 seconds (PLAN-V24 T4-3, choice 22)', () => {
  it('moves to the model, and this device remembers it', async () => {
    const { mic, session, now } = open({ toolNeverReady: true, modelBytes: 83_000_000 })
    session.start()
    await tick(100)
    // The mic is open and hears a voice, but the service never says it listens.
    expect(now()).toMatchObject({ phase: 'checking', steps: { hear: 'pass', ready: 'waiting' } })
    await tick(TOOL_START_MS)
    expect(mic.storage.get(ENGINE_KEY)).toBe('model')
    expect(mic.tools[0]?.aborted).toBe(true)
    // The model downloads with no mic open, and no problem shows.
    expect(mic.live()).toBe(0)
    expect(now()).toMatchObject({
      phase: 'checking',
      problem: null,
      preparing: { loaded: 0, total: 83_000_000, device: 'computer' },
    })
    mic.toolNeverReady = false
    mic.model.done()
    await tick(100)
    expect(now().phase).toBe('listening')
    expect(mic.tools.at(-1)?.nameCase).toBe('any')
    session.close()

    // The next opening on this device goes straight to the model.
    const again = new MicSession({
      mode: 'note',
      tool: 'browser_service',
      env: mic.env(),
      makeTool: mic.tool,
    })
    again.start()
    await tick(100)
    expect(again.getSnapshot().phase).toBe('listening')
    expect(mic.tools.at(-1)?.nameCase).toBe('any')
  })

  it('during a network blip, it says the voice tool didn’t load, as before, and remembers nothing', async () => {
    const { mic, session, now } = open({ toolNeverReady: true })
    session.start()
    await tick(100)
    mic.reconnecting(true)
    await tick(TOOL_START_MS)
    expect(now()).toMatchObject({ phase: 'failed', problem: 'tool_failed' })
    expect(mic.storage.has(ENGINE_KEY)).toBe(false)
  })

  it('where the model can’t run, it says the voice tool didn’t load, as before', async () => {
    const { mic, session, now } = open({ toolNeverReady: true, browser: { model: false } })
    session.start()
    await tick(100 + TOOL_START_MS)
    expect(now()).toMatchObject({ phase: 'failed', problem: 'tool_failed' })
    expect(mic.storage.has(ENGINE_KEY)).toBe(false)
  })

  it('with browser_model, it never falls back to the service', async () => {
    const { mic, session, now } = open({ toolNeverReady: true }, { tool: 'browser_model' })
    session.start()
    await tick(100 + TOOL_START_MS)
    expect(now()).toMatchObject({ phase: 'failed', problem: 'tool_failed' })
    expect(mic.tools.every((tool) => tool.nameCase === 'any')).toBe(true)
  })
})

describe('a service that listens but hears nothing (23 Nov 2026, Edge)', () => {
  it('moves to the model after 6 seconds of clear voice with no word, and remembers it', async () => {
    const { mic, session, now } = await listening({ modelBytes: 83_000_000 })
    await tick(DEAF_VOICE_MS - 200)
    expect(mic.storage.has(ENGINE_KEY)).toBe(false)
    await tick(400)
    expect(mic.storage.get(ENGINE_KEY)).toBe('model')
    expect(mic.tools[0]?.aborted).toBe(true)
    // The model downloads, with no problem on screen, then listens.
    expect(now()).toMatchObject({
      phase: 'checking',
      problem: null,
      preparing: { total: 83_000_000 },
    })
    mic.model.done()
    await tick(100)
    expect(now().phase).toBe('listening')
    expect(mic.tools.at(-1)?.nameCase).toBe('any')
    session.close()
  })

  it('stays on the service once a word comes', async () => {
    const { mic, now } = await listening()
    mic.hear('log a')
    await tick(DEAF_VOICE_MS * 3)
    expect(mic.storage.has(ENGINE_KEY)).toBe(false)
    expect(now().phase).toBe('listening')
    expect(mic.tools).toHaveLength(1)
  })

  it('a quiet hum in the room never moves it', async () => {
    const { mic, now } = await listening()
    mic.level = DEAF_LEVEL / 2
    await tick(DEAF_VOICE_MS * 3)
    expect(mic.storage.has(ENGINE_KEY)).toBe(false)
    expect(now().phase).toBe('listening')
  })

  it('where the model can’t run, it stays on the service', async () => {
    const { mic, now } = await listening({ browser: { model: false } })
    await tick(DEAF_VOICE_MS * 2)
    expect(mic.storage.has(ENGINE_KEY)).toBe(false)
    expect(now().phase).toBe('listening')
  })

  it('a service that refuses before any word moves to the model', async () => {
    const { mic, now } = await listening()
    mic.fail('tool_failed')
    await tick(100)
    expect(mic.storage.get(ENGINE_KEY)).toBe('model')
    expect(now().problem).toBeNull()
  })

  it('after a word, a refusal shows as before, and nothing moves', async () => {
    const { mic, now } = await listening()
    mic.say('Log a call')
    mic.fail('tool_failed')
    await tick(100)
    expect(now()).toMatchObject({ phase: 'failed', problem: 'tool_failed' })
    expect(mic.storage.has(ENGINE_KEY)).toBe(false)
  })
})

describe('the model gets ready before the mic opens (PLAN-V24 T4-3, choice 25)', () => {
  const BYTES = 83_000_000

  it('shows the download’s progress, and opens no mic until the model is ready', async () => {
    const { mic, session, now } = open({ browser: IPHONE, modelBytes: BYTES })
    session.start()
    await tick(100)
    expect(now()).toMatchObject({
      phase: 'checking',
      preparing: { loaded: 0, total: BYTES, device: 'phone' },
    })
    mic.model.progress(41_000_000)
    expect(now().preparing).toEqual({ loaded: 41_000_000, total: BYTES, device: 'phone' })
    expect(mic.asked).toEqual([])
    mic.model.done()
    await tick(100)
    expect(now()).toMatchObject({ phase: 'listening', preparing: null })
    expect(mic.live()).toBe(1)
  })

  it('kept from an earlier visit: no download shows, and the mic opens at once', async () => {
    const { mic, session, now } = open({ browser: IPHONE })
    const seen: (number | null)[] = []
    session.subscribe(() => {
      seen.push(now().preparing?.total ?? null)
    })
    session.start()
    await tick(100)
    expect(now().phase).toBe('listening')
    expect(seen.some((total) => total !== null && total > 0)).toBe(false)
    expect(mic.model.asked.prepare).toBe(1)
  })

  it('once loaded on this page, the next opening doesn’t wait for it at all', async () => {
    const first = await listening({ browser: IPHONE })
    first.session.close()
    const again = new MicSession({
      mode: 'note',
      tool: 'browser_service',
      env: first.mic.env(),
      makeTool: first.mic.tool,
    })
    again.start()
    expect(again.getSnapshot().preparing).toBeNull()
    await tick(100)
    expect(again.getSnapshot().phase).toBe('listening')
    expect(first.mic.model.asked.prepare).toBe(1)
  })

  it('a closed opening never opens the mic, however the download ends', async () => {
    const { mic, session } = open({ browser: IPHONE, modelBytes: BYTES })
    session.start()
    await tick(100)
    session.close()
    mic.model.done()
    await tick(100)
    expect(mic.asked).toEqual([])
    expect(mic.tools).toHaveLength(0)
  })

  it.each<[string, 'download' | 'load', string]>([
    ['a failed download', 'download', 'download_failed'],
    ['a model that won’t load here', 'load', 'model_failed'],
  ])('%s says so, with no mic opened', async (_, why, problem) => {
    const { mic, session, now } = open({ browser: IPHONE, modelBytes: BYTES })
    session.start()
    await tick(100)
    mic.model.fail(why)
    await tick(0)
    expect(now()).toMatchObject({ phase: 'failed', failedAt: null, problem, preparing: null })
    expect(mic.asked).toEqual([])
  })

  it('Try again after a failed download downloads again, then listens', async () => {
    const { mic, session, now } = open({ browser: IPHONE, modelBytes: BYTES })
    session.start()
    await tick(100)
    mic.model.fail('download')
    await tick(0)
    session.retry()
    await tick(100)
    expect(now().preparing?.total).toBe(BYTES)
    mic.model.done()
    await tick(100)
    expect(now().phase).toBe('listening')
  })

  it('a device too slow for the model says so, with the words kept', async () => {
    const { mic, now } = await listening({ browser: IPHONE }, { names: ['Jo Sample'] })
    mic.say('log a call with jo sample')
    mic.fail('too_slow')
    expect(now()).toMatchObject({
      phase: 'failed',
      problem: 'device_too_slow',
      chunks: ['log a call with Jo Sample'],
    })
  })

  it('writing out too slowly on the model is the device’s too-slow problem', async () => {
    const { mic, session, now } = await listening({ browser: IPHONE, toolNeverFinishes: true })
    mic.say('log a call')
    session.finish()
    await tick(TOO_SLOW_FLOOR_MS)
    expect(now()).toMatchObject({ phase: 'failed', problem: 'device_too_slow' })
  })
})

describe('the name fix on the model’s words (PLAN-V24 choice 28)', () => {
  const NAMES = ['Sample Logistics Pty Ltd', 'Jo Sample']

  it('reads the names by their words, in the words still heard and in the final ones', async () => {
    const { mic, now } = await listening({ browser: IPHONE }, { names: NAMES })
    mic.hear('log a call with sample logistix')
    expect(now().hearing).toBe('log a call with Sample Logistics')
    mic.say('log a call with sample logistix')
    expect(now().chunks).toEqual(['log a call with Sample Logistics'])
    expect(now().fixes).toEqual([{ from: 'logistix', to: 'Logistics' }])
  })

  it('keeps the capital-letter rule for the browser’s service', async () => {
    const { mic, now } = await listening({}, { names: NAMES })
    mic.say('log a call with sample logistix')
    expect(now().chunks).toEqual(['log a call with sample logistix'])
  })

  it('reads the model’s names by their words when the mic moves mid-turn, too', async () => {
    const { mic, now } = await listening(
      { browser: IPHONE, devices: [LAPTOP_MIC] },
      { names: NAMES },
    )
    mic.hear('log a call with sample logistix')
    mic.plug(HEADSET)
    await tick(100)
    expect(now().chunks).toEqual(['log a call with Sample Logistics'])
  })
})

describe('the computer’s default mic (defaultMic)', () => {
  const device = (deviceId: string, label: string, groupId = deviceId): MediaDeviceInfo => ({
    deviceId,
    groupId,
    kind: 'audioinput',
    label,
    toJSON: () => ({}),
  })

  it('is the first mic listed (Firefox, Safari)', () => {
    expect(
      defaultMic([device('a1', 'Microphone Array (Realtek)'), device('a2', 'Headset (Jabra)')]),
    ).toEqual({ id: 'a1', name: 'Microphone Array (Realtek)' })
    expect(defaultMic([])).toBeNull()
  })

  it('is the real mic behind Chrome’s "default" entry, by its name, then by its group', () => {
    expect(
      defaultMic([
        device('default', 'Default - Headset (Jabra) (0b0e:24b8)', 'g2'),
        device('communications', 'Communications - Microphone Array (Realtek)', 'g1'),
        device('a1', 'Microphone Array (Realtek)', 'g1'),
        device('a2', 'Headset (Jabra) (0b0e:24b8)', 'g2'),
      ]),
    ).toEqual({ id: 'a2', name: 'Headset (Jabra)' })
    expect(
      defaultMic([
        device('default', 'Default - Headset', 'g2'),
        device('a1', 'Microphone Array (Realtek)', 'g1'),
        device('a2', 'Headset Microphone', 'g2'),
      ]),
    ).toEqual({ id: 'a2', name: 'Headset Microphone' })
  })
})

describe('words handed over before they were written out (afterHanded)', () => {
  const handed = lettersOf('log a call with north wind')

  it('takes them off the front, however the service writes them', () => {
    expect(afterHanded('Log a call with Northwind.', handed)).toEqual({ rest: '', left: '' })
    expect(afterHanded('Log a call with Northwind. Add a task', handed)).toEqual({
      rest: 'Add a task',
      left: '',
    })
  })

  it('cuts at the nearest word end when the service changed a word', () => {
    // "for" heard, "four" written: one letter more.
    expect(afterHanded('Call four meeting add a task', lettersOf('call for meeting'))).toEqual({
      rest: 'add a task',
      left: '',
    })
    // "four" heard, "for" written: one letter less.
    expect(afterHanded('Call for meeting add a task', lettersOf('call four meeting'))).toEqual({
      rest: 'add a task',
      left: '',
    })
  })

  it('keeps what is left for the next chunk when the words come in two', () => {
    const first = afterHanded('Log a call.', handed)
    expect(first.rest).toBe('')
    expect(first.left).toBe(lettersOf('with north wind'))
    expect(afterHanded('With Northwind. Add a task', first.left).rest).toBe('Add a task')
  })

  it('cuts nothing from new words when only a letter or two is left over', () => {
    expect(afterHanded('Add a task', 'g').rest).toBe('Add a task')
    expect(afterHanded('Open today', 'ab').rest).toBe('Open today')
    expect(afterHanded('Open today', '').rest).toBe('Open today')
  })
})
