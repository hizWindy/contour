/**
 * One live talk (PLAN-V28 Part 2), with a fake relay, fake audio, the fake mic and a fake clock: it
 * starts with the company on screen and opens the mic as the mic card does; no sound goes before
 * `ready`, then only through the gate; the captions, "speaking", the duck and the flush; tool calls
 * answered once; Mute; the states for the pill; and every end lets everything go. Made-up names
 * only: Sample Logistics, Jo Sample. No sound is kept, and nothing reaches Google.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProblem } from '@/api/client'
import type { VoiceSessionOut } from '@/api/types'
import {
  FakeMic,
  HEADSET,
  LAPTOP_MIC,
  type FakeMicOptions,
} from '@/apps/companies/call-notes/mic/fake-mic'
import { MIC_KEY } from '@/apps/companies/call-notes/mic/devices'
import { FRAME_BYTES, type Frame } from './dsp'
import { FakeSockets } from './fake-relay'
import { CALL_WORDS_MS, DUCK_MS, LiveTalk, type Network, type TalkEnv, type ToolCall } from './talk'

const PATH = '/api/v1/companies/assistant/voice/live?session=0b6f0000-0000-4000-8000-000000000001'

const SESSION: VoiceSessionOut = {
  id: '0b6f0000-0000-4000-8000-000000000001',
  socket: PATH,
  expires_at: '2026-11-25T10:01:00Z',
  limits: {
    talk_seconds: 1800,
    idle_seconds: 300,
    tool_seconds: 20,
    sample_rate_in: 16000,
    sample_rate_out: 24000,
    frame_bytes: 640,
    max_binary_bytes: 4096,
    max_text_bytes: 8192,
    audio_rate_max: 1.5,
  },
}

const QUIET = 0.001
const SPEECH = 0.2

/** A 20 ms piece, numbered so what went can be read back. */
let made = 0
function piece(level: number): Frame {
  made += 1
  const pcm = new ArrayBuffer(FRAME_BYTES)
  new DataView(pcm).setUint32(0, made, true)
  return { pcm, level }
}

function fakeContext(closed: { count: number }): AudioContext {
  return {
    state: 'running',
    resume: () => Promise.resolve(),
    close: () => {
      closed.count += 1
      return Promise.resolve()
    },
  } as unknown as AudioContext
}

interface SetUp {
  mic?: FakeMicOptions
  /** The start's answer. Default: a talk that is ready. */
  begin?: () => Promise<VoiceSessionOut>
  /** No audio in this browser. */
  noAudio?: boolean
  /** The browser is offline as it starts. */
  offline?: boolean
}

/** The browser's network, as the test says: it can go offline, and online again. */
function fakeNetwork(offline: boolean) {
  const state = { online: !offline }
  const listeners = new Set<() => void>()
  const network: Network = {
    online: () => state.online,
    watch: (onChange) => {
      listeners.add(onChange)
      return () => {
        listeners.delete(onChange)
      }
    },
  }
  const set = (online: boolean): void => {
    state.online = online
    for (const listener of [...listeners]) listener()
  }
  return { network, set, listeners }
}

function setUp({ mic: micOptions, begin, noAudio = false, offline = false }: SetUp = {}) {
  const mic = new FakeMic(micOptions)
  const sockets = new FakeSockets()
  const net = fakeNetwork(offline)
  const audioClosed = { count: 0 }
  const player = {
    pushed: [] as ArrayBuffer[],
    flushed: 0,
    ducks: [] as boolean[],
    ended: 0,
    closed: false,
  }
  const capture = { swapped: [] as MediaStream[], closed: false }
  let toFrame: (frame: Frame) => void = () => undefined
  let toSpeaking: (on: boolean) => void = () => undefined
  const begun: { key: string | null; signal: AbortSignal }[] = []
  const env: TalkEnv = {
    mic: mic.env(),
    audio: () =>
      noAudio ? null : { capture: fakeContext(audioClosed), playback: fakeContext(audioClosed) },
    capture: (_context, _stream, onFrame) => {
      toFrame = onFrame
      return Promise.resolve({
        bars: null,
        swap: (stream) => {
          capture.swapped.push(stream)
        },
        close: () => {
          capture.closed = true
        },
      })
    },
    player: (_context, onSpeaking) => {
      toSpeaking = onSpeaking
      return Promise.resolve({
        push: (pcm) => {
          player.pushed.push(pcm)
        },
        flush: () => {
          player.flushed += 1
        },
        duck: (on) => {
          player.ducks.push(on)
        },
        end: () => {
          player.ended += 1
        },
        close: () => {
          player.closed = true
        },
      })
    },
    begin: (key, signal) => {
      begun.push({ key, signal })
      return begin ? begin() : Promise.resolve(SESSION)
    },
    relay: sockets.env(),
    network: net.network,
  }
  const calls: ToolCall[] = []
  const cancels: string[][] = []
  const turns: string[] = []
  const talk = new LiveTalk({
    companyKey: '201',
    env,
    onToolCall: (call) => calls.push(call),
    onToolCancel: (ids) => cancels.push([...ids]),
    onRepTurn: (words) => turns.push(words),
  })
  const now = () => talk.getSnapshot()
  const frames = (count: number, level: number): void => {
    for (let index = 0; index < count; index += 1) toFrame(piece(level))
  }
  return {
    talk,
    mic,
    sockets,
    player,
    capture,
    audioClosed,
    begun,
    calls,
    cancels,
    turns,
    net,
    now,
    frames,
    speaking: (on: boolean) => {
      toSpeaking(on)
    },
  }
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

/** Starts a talk and waits until its socket is open. */
async function connected(options: SetUp = {}) {
  const set = setUp(options)
  set.talk.start()
  await settle()
  set.sockets.last().accept()
  return set
}

/** Starts a talk, and the relay says Google is ready. */
async function live(options: SetUp = {}) {
  const set = await connected(options)
  set.sockets.last().say({ type: 'ready', resumed: false })
  return set
}

function sentNumbers(set: { sockets: FakeSockets }): number[] {
  return set.sockets
    .last()
    .binary()
    .map((pcm) => new DataView(pcm).getUint32(0, true))
}

beforeEach(() => {
  vi.useFakeTimers()
})

describe('the start (T2-3)', () => {
  it('starts with the company on screen, opens the mic as the mic card does, then the socket', async () => {
    const set = setUp({ mic: { devices: [HEADSET, LAPTOP_MIC] } })
    set.mic.storage.set(MIC_KEY, LAPTOP_MIC.id)
    set.talk.start()
    expect(set.now().phase).toBe('connecting')

    await settle()
    expect(set.begun.map((one) => one.key)).toEqual(['201'])
    // Echo cancellation, noise suppression and automatic gain, on the mic picked here.
    expect(set.mic.asked).toEqual([
      {
        audio: {
          deviceId: { exact: LAPTOP_MIC.id },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      },
    ])
    expect(set.sockets.last().url).toBe(`wss://contour.example${PATH}`)
    expect(set.now().device?.name).toBe('Microphone Array (Realtek)')

    set.sockets.last().accept()
    expect(set.now().phase).toBe('connecting')
    set.sockets.last().say({ type: 'ready', resumed: false })
    expect(set.now()).toMatchObject({ phase: 'live', ready: true })
  })

  it.each([
    [403, 'live_voice_not_allowed'],
    [409, 'live_voice_off'],
    [429, 'live_voice_limit'],
    [503, 'live_voice_busy'],
  ])(
    'a start refused with %i %s ends it before a word, and lets everything go',
    async (status, code) => {
      const set = setUp({
        begin: () => Promise.reject(new ApiProblem({ title: 'No', status, code })),
      })
      set.talk.start()
      await settle()

      const end = set.now().end
      expect(end?.kind).toBe('refused')
      expect(end?.kind === 'refused' ? end.problem.code : null).toBe(code)
      expect(set.sockets.made).toEqual([])
      expect(set.mic.live()).toBe(0)
      expect(set.audioClosed.count).toBe(2)
      expect(set.now().ready).toBe(false)
    },
  )

  it('a socket refused before it opens is a failed start', async () => {
    const set = setUp()
    set.talk.start()
    await settle()
    set.sockets.last().refuse()

    expect(set.now()).toMatchObject({ phase: 'ended', end: { kind: 'failed' }, ready: false })
    expect(set.mic.live()).toBe(0)
  })

  it('a browser with no audio is a failed start, before any request', async () => {
    const set = setUp({ noAudio: true })
    set.talk.start()
    await settle()

    expect(set.now().end).toEqual({ kind: 'failed' })
    expect(set.mic.asked).toEqual([])
  })

  it("a mic the browser refuses ends it with the mic card's words, and stops the start", async () => {
    const set = setUp({ mic: { refuse: { name: 'NotAllowedError' } } })
    set.talk.start()
    await settle()

    expect(set.now().end).toEqual({ kind: 'mic', problem: 'blocked_browser' })
    expect(set.begun[0]?.signal.aborted).toBe(true)
    expect(set.sockets.made).toEqual([])
  })
})

describe('sound in (T2-1)', () => {
  it('sends no sound before "ready", then keeps the 0.5 s before speech as its one burst', async () => {
    const set = await connected()
    set.frames(200, QUIET)
    set.frames(40, QUIET)
    const lastQuiet = made
    expect(set.sockets.last().binary()).toEqual([])

    set.sockets.last().say({ type: 'ready', resumed: false })
    set.frames(2, SPEECH)
    // The 25 pieces before the speech (said while it connected) and the two loud ones.
    expect(sentNumbers(set)).toEqual([
      ...Array.from({ length: 25 }, (_, index) => lastQuiet - 24 + index),
      lastQuiet + 1,
      lastQuiet + 2,
    ])
  })

  it('says "pause" once, 1.5 s after the rep went quiet', async () => {
    const set = await live()
    set.frames(200, QUIET)
    set.frames(10, SPEECH)
    set.frames(100, QUIET)

    expect(set.sockets.last().json()).toEqual([{ type: 'pause' }])
  })
})

describe('sound out (T2-2)', () => {
  it('plays what Gemini says, and lets the rest play out at the end of its turn', async () => {
    const set = await live()
    set.sockets.last().sound(new ArrayBuffer(4800))
    set.sockets.last().say({ type: 'turn_complete' })

    expect(set.player.pushed).toHaveLength(1)
    expect(set.player.ended).toBe(1)
  })

  it('is "speaking" while the player says so, and the gate is stricter meanwhile', async () => {
    const set = await live()
    set.frames(200, QUIET)
    set.speaking(true)
    expect(set.now().speaking).toBe(true)

    // Its own voice, coming back faintly through the mic, doesn't open the gate.
    set.frames(10, 0.02)
    expect(set.sockets.last().binary()).toEqual([])

    set.speaking(false)
    expect(set.now().speaking).toBe(false)
  })

  it('drops the voice to a third as the rep talks over it, then empties on "interrupted"', async () => {
    const set = await live()
    set.frames(200, QUIET)
    set.speaking(true)
    set.frames(2, SPEECH)
    expect(set.player.ducks).toEqual([true])

    set.sockets.last().say({ type: 'interrupted' })
    expect(set.player.flushed).toBe(1)
    expect(set.player.ducks).toEqual([true, false])
  })

  it('brings the voice back after a second if Google talks on (TBC at T5-2)', async () => {
    const set = await live()
    set.frames(200, QUIET)
    set.speaking(true)
    set.frames(2, SPEECH)
    vi.advanceTimersByTime(DUCK_MS - 1)
    expect(set.player.ducks).toEqual([true])

    vi.advanceTimersByTime(1)
    expect(set.player.ducks).toEqual([true, false])
  })
})

describe('the captions (T2-4)', () => {
  it("shows the rep's words as Google hears them, then the Assistant's", async () => {
    const set = await live()
    const socket = set.sockets.last()
    socket.say({ type: 'heard', text: ' Log a call', final: false, interim: false })
    socket.say({ type: 'heard', text: ' with Jo at', final: false, interim: false })
    socket.say({ type: 'heard', text: 'Sample Logist', final: false, interim: true })
    expect(set.now().captions).toEqual({
      rep: 'Log a call with Jo at',
      hearing: 'Sample Logist',
      assistant: '',
    })
    expect(set.talk.text()).toBe('Log a call with Jo at Sample Logist')

    socket.say({ type: 'heard', text: ' Sample Logistics.', final: false, interim: false })
    socket.say({ type: 'said', text: 'Jo Sample or' })
    socket.say({ type: 'said', text: ' Jo Northwind?' })
    expect(set.now().captions).toEqual({
      rep: 'Log a call with Jo at Sample Logistics.',
      hearing: '',
      assistant: 'Jo Sample or Jo Northwind?',
    })

    // The rep's next words start a new exchange.
    socket.say({ type: 'heard', text: ' Jo Sample.', final: false, interim: false })
    expect(set.now().captions).toEqual({ rep: 'Jo Sample.', hearing: '', assistant: '' })
    // Each piece of words either way counts, for the quiet stop: 5 heard and 2 said.
    expect(set.now().words).toBe(7)
  })
})

describe('tool calls (T3-1)', () => {
  it('is "working" until a tool call is answered, and answers each once', async () => {
    const set = await live()
    const socket = set.sockets.last()
    socket.say({ type: 'heard', text: ' Log a call with Jo', final: false, interim: false })
    socket.say({ type: 'tool_call', id: 'call-1', request: 'Log a call with Jo Sample' })

    expect(set.now().working).toBe(1)
    // It waits up to 0.5 s for the rep's words Google is still sending.
    expect(set.calls).toEqual([])
    await vi.advanceTimersByTimeAsync(CALL_WORDS_MS)
    expect(set.calls).toEqual([
      { id: 'call-1', request: 'Log a call with Jo Sample', heard: 'Log a call with Jo' },
    ])

    set.talk.answer({
      id: 'call-1',
      status: 'ok',
      retryable: false,
      message: 'Ready. Say send it.',
    })
    set.talk.answer({ id: 'call-1', status: 'ok', retryable: false, message: 'Again.' })
    expect(set.now().working).toBe(0)
    expect(socket.json()).toEqual([
      {
        type: 'tool_answer',
        id: 'call-1',
        status: 'ok',
        retryable: false,
        message: 'Ready. Say send it.',
      },
    ])
  })

  it('stops working on a call Google cancelled, and never answers it', async () => {
    const set = await live()
    const socket = set.sockets.last()
    socket.say({ type: 'tool_call', id: 'call-1', request: 'Log a call' })
    await vi.advanceTimersByTimeAsync(CALL_WORDS_MS)
    socket.say({ type: 'tool_cancel', ids: ['call-1', 'call-9'] })

    expect(set.now().working).toBe(0)
    expect(set.cancels).toEqual([['call-1']])
    set.talk.answer({ id: 'call-1', status: 'ok', retryable: false, message: 'Late.' })
    expect(socket.json()).toEqual([])
  })

  it('drops a call Google cancelled while it waited for words: nothing ever sees it', async () => {
    const set = await live()
    const socket = set.sockets.last()
    socket.say({ type: 'tool_call', id: 'call-1', request: 'Log a call' })
    socket.say({ type: 'tool_cancel', ids: ['call-1'] })
    await vi.advanceTimersByTimeAsync(CALL_WORDS_MS)

    expect(set.calls).toEqual([])
    expect(set.cancels).toEqual([])
    expect(set.now().working).toBe(0)
  })
})

describe("the rep's own words for each call (T3-1)", () => {
  const heard = (text: string) => ({ type: 'heard', text, final: false, interim: false }) as const

  it('takes the words said before the call', async () => {
    const set = await live()
    const socket = set.sockets.last()
    socket.say(heard(' Send it.'))
    socket.say({ type: 'tool_call', id: 'call-1', request: 'Send it' })
    await vi.advanceTimersByTimeAsync(CALL_WORDS_MS)

    expect(set.calls.map((call) => call.heard)).toEqual(['Send it.'])
  })

  it("takes words that come just after the call: Google's transcript can come late", async () => {
    const set = await live()
    const socket = set.sockets.last()
    socket.say({ type: 'tool_call', id: 'call-1', request: 'Send it' })
    await vi.advanceTimersByTimeAsync(300)
    socket.say(heard(' Send it.'))
    await vi.advanceTimersByTimeAsync(CALL_WORDS_MS - 300)

    expect(set.calls.map((call) => call.heard)).toEqual(['Send it.'])
  })

  it('gives words after the 0.5 s to the next call, not this one', async () => {
    const set = await live()
    const socket = set.sockets.last()
    socket.say({ type: 'tool_call', id: 'call-1', request: 'Log a call with Jo' })
    await vi.advanceTimersByTimeAsync(CALL_WORDS_MS + 100)
    socket.say(heard(' The second one.'))
    socket.say({ type: 'tool_call', id: 'call-2', request: 'The second one' })
    await vi.advanceTimersByTimeAsync(CALL_WORDS_MS)

    expect(set.calls.map((call) => [call.id, call.heard])).toEqual([
      ['call-1', ''],
      ['call-2', 'The second one.'],
    ])
  })

  it.each([
    ['the turn completes', { type: 'turn_complete' }],
    ['the rep talks over the Assistant', { type: 'interrupted' }],
    [
      'Google says the words are finished',
      { type: 'heard', text: '', final: true, interim: false },
    ],
  ] as const)('goes on before the 0.5 s when %s', async (_, message) => {
    const set = await live()
    const socket = set.sockets.last()
    socket.say(heard(' Send it.'))
    socket.say({ type: 'tool_call', id: 'call-1', request: 'Send it' })
    socket.say(message)

    expect(set.calls.map((call) => call.heard)).toEqual(['Send it.'])
  })

  it('goes on at once when the next call comes, each with its own words', async () => {
    const set = await live()
    const socket = set.sockets.last()
    socket.say(heard(' Log a call with Jo.'))
    socket.say({ type: 'tool_call', id: 'call-1', request: 'Log a call with Jo' })
    socket.say(heard(' And a task.'))
    socket.say({ type: 'tool_call', id: 'call-2', request: 'Add a task' })
    await vi.advanceTimersByTimeAsync(CALL_WORDS_MS)

    expect(set.calls.map((call) => [call.id, call.heard])).toEqual([
      ['call-1', 'Log a call with Jo. And a task.'],
      ['call-2', ''],
    ])
  })

  it("never counts Google's guess: only finished pieces send anything", async () => {
    const set = await live()
    const socket = set.sockets.last()
    socket.say({ type: 'heard', text: 'send it', final: false, interim: true })
    socket.say({ type: 'tool_call', id: 'call-1', request: 'Send it' })
    await vi.advanceTimersByTimeAsync(CALL_WORDS_MS)

    expect(set.calls.map((call) => call.heard)).toEqual([''])
  })

  it('keeps the words no call took, for the text line if the free mic takes over (T4-1)', async () => {
    const set = await live()
    const socket = set.sockets.last()
    socket.say(heard(' Log a call with Jo.'))
    socket.say({ type: 'tool_call', id: 'call-1', request: 'Log a call with Jo' })
    await vi.advanceTimersByTimeAsync(CALL_WORDS_MS)
    socket.say(heard(' Then add a task'))
    socket.say({ type: 'heard', text: 'for Fri', final: false, interim: true })

    expect(set.talk.unsent()).toBe('Then add a task for Fri')
  })
})

describe("the rep's whole turn (T3-4)", () => {
  it('goes on once the Assistant answers', async () => {
    const set = await live()
    const socket = set.sockets.last()
    socket.say({ type: 'heard', text: " That's", final: false, interim: false })
    socket.say({ type: 'heard', text: ' all.', final: false, interim: false })
    expect(set.turns).toEqual([])

    socket.say({ type: 'said', text: 'Bye for now.' })
    expect(set.turns).toEqual(["That's all."])
  })

  it('goes on when Google says it is finished, or the turn completes', async () => {
    const set = await live()
    const socket = set.sockets.last()
    socket.say({ type: 'heard', text: ' Stop listening.', final: true, interim: false })
    socket.say({ type: 'heard', text: ' Thanks.', final: false, interim: false })
    socket.say({ type: 'turn_complete' })

    expect(set.turns).toEqual(['Stop listening.', 'Thanks.'])
  })

  it('goes on after 1.5 s of quiet, as the gate pauses', async () => {
    const set = await live()
    set.frames(200, QUIET)
    set.frames(10, SPEECH)
    set.sockets.last().say({ type: 'heard', text: " That's all.", final: false, interim: false })
    set.frames(100, QUIET)

    expect(set.turns).toEqual(["That's all."])
  })
})

describe('offline (T4-1)', () => {
  it('starting offline ends it at once, before any request', async () => {
    const set = setUp({ offline: true })
    set.talk.start()
    await settle()

    expect(set.now().end).toEqual({ kind: 'offline' })
    expect(set.begun).toEqual([])
    expect(set.mic.asked).toEqual([])
  })

  it('going offline ends it, and lets everything go', async () => {
    const set = await live()
    set.net.set(false)

    expect(set.now().end).toEqual({ kind: 'offline' })
    expect(set.mic.live()).toBe(0)
    expect(set.net.listeners.size).toBe(0)
  })
})

describe('Mute (T2-4)', () => {
  it('stops the sound going, with one pause, and keeps the talk', async () => {
    const set = await live()
    set.frames(200, QUIET)
    set.frames(5, SPEECH)
    const sent = set.sockets.last().binary().length
    set.talk.mute(true)

    expect(set.now()).toMatchObject({ muted: true, phase: 'live' })
    expect(set.sockets.last().json()).toEqual([{ type: 'pause' }])
    expect((set.mic.tracks[0] as unknown as { enabled: boolean }).enabled).toBe(false)
    set.frames(20, SPEECH)
    expect(set.sockets.last().binary()).toHaveLength(sent)

    set.talk.mute(false)
    expect((set.mic.tracks[0] as unknown as { enabled: boolean }).enabled).toBe(true)
    set.frames(2, SPEECH)
    expect(set.sockets.last().binary().length).toBeGreaterThan(sent)
  })
})

describe('reconnecting (T2-4)', () => {
  it("says so while Google's side resumes", async () => {
    const set = await live()
    set.sockets.last().say({ type: 'reconnecting' })
    expect(set.now().phase).toBe('reconnecting')

    set.sockets.last().say({ type: 'reconnected' })
    expect(set.now().phase).toBe('live')
  })

  it('says so while our backend restarts, and carries on at "ready" with "resumed"', async () => {
    const set = await live()
    set.sockets.last().drop(1012)
    expect(set.now().phase).toBe('reconnecting')

    await vi.advanceTimersByTimeAsync(1000)
    set.sockets.last().accept()
    set.sockets.last().say({ type: 'ready', resumed: true })
    expect(set.now()).toMatchObject({ phase: 'live', end: null })
  })
})

describe('the mic follows the headset (as the mic card does)', () => {
  it('moves to a headset plugged in, and says which', async () => {
    const set = await live({ mic: { devices: [LAPTOP_MIC] } })
    set.mic.plug(HEADSET)
    await settle()

    expect(set.capture.swapped).toHaveLength(1)
    expect(set.now().movedTo?.name).toBe('Headset Microphone (Jabra Evolve2 65)')
    expect(set.mic.live()).toBe(1)
  })
})

describe('every end lets everything go', () => {
  it('Stop: "stop" to the relay, the socket closed, the mic and the audio let go', async () => {
    const set = await live()
    const socket = set.sockets.last()
    set.talk.stop()

    expect(set.now()).toMatchObject({ phase: 'ended', end: { kind: 'stopped' } })
    expect(socket.json()).toEqual([{ type: 'stop' }])
    expect(socket.closedWith).toBe(1000)
    expect(set.mic.live()).toBe(0)
    expect(set.audioClosed.count).toBe(2)
    expect(set.player.closed).toBe(true)
    expect(set.capture.closed).toBe(true)
  })

  it('Stop while it connects stops the start too', async () => {
    const set = setUp()
    set.talk.start()
    set.talk.stop()
    await settle()

    expect(set.begun[0]?.signal.aborted).toBe(true)
    expect(set.sockets.made).toEqual([])
    expect(set.mic.live()).toBe(0)
  })

  it("the relay's end carries its reason and its line", async () => {
    const set = await live()
    const line = 'Live voice stopped: nothing was heard for a while. Press V to start again.'
    set.sockets.last().say({ type: 'ended', reason: 'idle', line })
    set.sockets.last().drop(1000)

    expect(set.now().end).toEqual({ kind: 'ended', reason: 'idle', line })
    expect(set.mic.live()).toBe(0)
  })

  it('our backend not back within 30 seconds: lost', async () => {
    const set = await live()
    set.sockets.last().drop(1012)
    await vi.advanceTimersByTimeAsync(31_000)

    expect(set.now().end).toEqual({ kind: 'lost' })
    expect(set.mic.live()).toBe(0)
  })
})
