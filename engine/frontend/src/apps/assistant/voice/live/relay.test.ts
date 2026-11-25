/**
 * Live voice's socket to our relay (PLAN-V28 T2-3), with a fake socket and a fake clock: the
 * address on the page's own host, no sound before `ready`, the tool answer's exact five fields,
 * the caps under the relay's, a failed start, `ended`, and opening the same path again after our
 * backend restarts. Nothing reaches Google.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoiceEnded } from '@/api/types'
import { FakeSockets } from './fake-relay'
import {
  cutMessage,
  MESSAGE_MAX,
  readMessage,
  RECONNECT,
  Relay,
  socketUrl,
  type RelayClosed,
  type RelayMessage,
} from './relay'

const PATH = '/api/v1/companies/assistant/voice/live?session=0b6f0000-0000-4000-8000-000000000001'

function setUp() {
  const sockets = new FakeSockets()
  const heard: RelayMessage[] = []
  const sounds: ArrayBuffer[] = []
  const readies: boolean[] = []
  const closed: RelayClosed[] = []
  let reconnecting = 0
  const relay = new Relay(
    PATH,
    {
      ready: (resumed) => readies.push(resumed),
      message: (message) => heard.push(message),
      sound: (pcm) => sounds.push(pcm),
      reconnecting: () => {
        reconnecting += 1
      },
      closed: (why) => closed.push(why),
    },
    sockets.env(),
  )
  return { sockets, relay, heard, sounds, readies, closed, reconnects: () => reconnecting }
}

/** Opens the socket, and the relay says Google is ready. */
function ready() {
  const set = setUp()
  set.relay.open()
  set.sockets.last().accept()
  set.sockets.last().say({ type: 'ready', resumed: false })
  return set
}

const FRAME = (): ArrayBuffer => new ArrayBuffer(640)

beforeEach(() => {
  vi.useFakeTimers()
})

describe('where the socket opens', () => {
  it('opens on the page\'s own host: "ws:" for "http:", "wss:" for "https:"', () => {
    const host = { host: 'contour.example' }

    expect(socketUrl(PATH, { protocol: 'https:', ...host })).toBe(`wss://contour.example${PATH}`)
    expect(socketUrl(PATH, { protocol: 'http:', ...host })).toBe(`ws://contour.example${PATH}`)
  })

  it('never opens anything but our own API path', () => {
    const place = { protocol: 'https:', host: 'contour.example' }

    expect(socketUrl('//elsewhere.example/api/v1/x', place)).toBeNull()
    expect(socketUrl('https://elsewhere.example/api/v1/x', place)).toBeNull()
    expect(socketUrl('/auth/me', place)).toBeNull()
    expect(socketUrl('/api\\..\\x', place)).toBeNull()
  })

  it('opens the path it was given, for sound as raw bytes', () => {
    const { sockets, relay } = setUp()
    relay.open()

    expect(sockets.last().url).toBe(`wss://contour.example${PATH}`)
    expect(sockets.last().binaryType).toBe('arraybuffer')
  })
})

describe("the relay's rules, kept by the page", () => {
  it('sends no sound before "ready", then each 20 ms piece as raw bytes', () => {
    const { sockets, relay, readies } = setUp()
    relay.open()
    sockets.last().accept()

    expect(relay.sendSound(FRAME())).toBe(false)
    expect(sockets.last().sent).toEqual([])

    sockets.last().say({ type: 'ready', resumed: false })
    expect(readies).toEqual([false])
    expect(relay.sendSound(FRAME())).toBe(true)
    expect(sockets.last().binary()).toHaveLength(1)
    expect(sockets.last().binary()[0]?.byteLength).toBe(640)
  })

  it('sends only whole 640-byte pieces', () => {
    const { sockets, relay } = ready()

    expect(relay.sendSound(new ArrayBuffer(641))).toBe(false)
    expect(relay.sendSound(new ArrayBuffer(4096))).toBe(false)
    expect(sockets.last().binary()).toEqual([])
  })

  it('says "pause" only once Google is ready', () => {
    const { sockets, relay } = setUp()
    relay.open()
    sockets.last().accept()
    relay.pause()
    expect(sockets.last().json()).toEqual([])

    sockets.last().say({ type: 'ready', resumed: false })
    relay.pause()
    expect(sockets.last().json()).toEqual([{ type: 'pause' }])
  })

  it('answers a tool call with exactly the five fields, its words cut to 500 characters', () => {
    const { sockets, relay } = ready()
    relay.answer({ id: 'call-1', status: 'ok', retryable: false, message: 'Ready. Say send it.' })
    relay.answer({ id: 'call-2', status: 'unsure', retryable: true, message: 'é'.repeat(700) })

    const [first, second] = sockets.last().json() as Record<string, unknown>[]
    expect(first).toEqual({
      type: 'tool_answer',
      id: 'call-1',
      status: 'ok',
      retryable: false,
      message: 'Ready. Say send it.',
    })
    expect(Object.keys(second ?? {}).sort()).toEqual([
      'id',
      'message',
      'retryable',
      'status',
      'type',
    ])
    expect(Array.from(String(second?.message))).toHaveLength(MESSAGE_MAX)
  })

  it('counts characters as the relay does: a character outside the basic set is one', () => {
    const faces = '\u{1F600}'.repeat(600)

    expect(Array.from(cutMessage(faces))).toHaveLength(500)
    expect(cutMessage('Sent.')).toBe('Sent.')
  })

  it("keeps JSON under the relay's 10 a second: 16 at once, then 8 a second", () => {
    const { sockets, relay } = ready()
    for (let count = 0; count < 30; count += 1) relay.pause()

    expect(sockets.last().json()).toHaveLength(16)
    vi.advanceTimersByTime(1000)
    expect(sockets.last().json()).toHaveLength(24)
    vi.advanceTimersByTime(1000)
    expect(sockets.last().json()).toHaveLength(30)
  })

  it('keeps sound under 1.4 times real time: a page that caught up drops what is over', () => {
    const { sockets, relay } = ready()
    let sent = 0
    for (let count = 0; count < 200; count += 1) if (relay.sendSound(FRAME())) sent += 1

    // 2.5 seconds of sound at once (125 pieces), the rest dropped, never a broken rule.
    expect(sent).toBe(125)
    expect(sockets.last().binary()).toHaveLength(125)
    // Real time from then on goes: 50 pieces a second, under the 70 a second it allows.
    vi.advanceTimersByTime(1000)
    let next = 0
    for (let count = 0; count < 50; count += 1) if (relay.sendSound(FRAME())) next += 1
    expect(next).toBe(50)
  })
})

describe('what the relay says', () => {
  it("passes each message on, and leaves out what it doesn't know", () => {
    const { sockets, heard, sounds } = ready()
    const socket = sockets.last()
    socket.say({ type: 'heard', text: ' Log a call', final: false, interim: false })
    socket.say({ type: 'said', text: 'Jo Sample or Jo Northwind?' })
    socket.say({ type: 'tool_call', id: 'call-1', request: 'Log a call with Jo' })
    socket.say({ type: 'tool_cancel', ids: ['call-1'] })
    socket.say({ type: 'interrupted' })
    socket.say({ type: 'turn_complete' })
    socket.say({ type: 'something_new', text: 'x' })
    socket.say({ type: 'heard' })
    socket.sayText('not json')
    socket.sound(new ArrayBuffer(4800))

    expect(heard.map((message) => message.type)).toEqual([
      'heard',
      'said',
      'tool_call',
      'tool_cancel',
      'interrupted',
      'turn_complete',
    ])
    expect(sounds).toHaveLength(1)
  })

  it('reads a message whole, with false for a flag it left out', () => {
    expect(readMessage('{"type":"heard","text":"Jo"}')).toEqual({
      type: 'heard',
      text: 'Jo',
      final: false,
      interim: false,
    })
    expect(readMessage('{"type":"ended","reason":"stopped","line":null}')).toEqual({
      type: 'ended',
      reason: 'stopped',
      line: null,
    })
    expect(readMessage('{"type":"tool_cancel","ids":[1]}')).toBeNull()
    expect(readMessage('[]')).toBeNull()
  })

  it('ends with the relay\'s reason and line when it closes after "ended"', () => {
    const { sockets, closed } = ready()
    const ended: VoiceEnded = {
      type: 'ended',
      reason: 'limit',
      line: "Live voice is off for now: this month's limit is reached. Using the free mic.",
    }
    sockets.last().say(ended)
    expect(closed).toEqual([])

    sockets.last().drop(1000)
    expect(closed).toEqual([{ kind: 'ended', ended }])
  })
})

describe('a failed start', () => {
  it("is a socket refused before it opens: the browser can't read why", () => {
    const { sockets, relay, closed, reconnects } = setUp()
    relay.open()
    sockets.last().refuse()

    expect(closed).toEqual([{ kind: 'refused' }])
    expect(reconnects()).toBe(0)
    vi.advanceTimersByTime(RECONNECT.withinMs)
    expect(sockets.made).toHaveLength(1)
  })

  it('is also a socket gone before Google was ready, with no word', () => {
    const { sockets, relay, closed } = setUp()
    relay.open()
    sockets.last().accept()
    sockets.last().drop(1006)

    expect(closed).toEqual([{ kind: 'refused' }])
  })
})

describe("our backend restarts (T1-4's server side)", () => {
  it('opens the same path again, and the talk carries on at "ready" with "resumed"', () => {
    const { sockets, relay, readies, closed, reconnects } = ready()
    sockets.last().drop(1012)

    expect(reconnects()).toBe(1)
    expect(relay.isReady).toBe(false)
    expect(relay.sendSound(FRAME())).toBe(false)
    vi.advanceTimersByTime(999)
    expect(sockets.made).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(sockets.made).toHaveLength(2)
    expect(sockets.last().url).toBe(sockets.made[0]?.url)

    sockets.last().accept()
    sockets.last().say({ type: 'ready', resumed: true })
    expect(readies).toEqual([false, true])
    expect(relay.sendSound(FRAME())).toBe(true)
    expect(closed).toEqual([])
  })

  it('also after a drop with no word, and a tool answer waits for the new "ready"', () => {
    const { sockets, relay } = ready()
    sockets.last().drop(1006)
    relay.answer({ id: 'call-1', status: 'ok', retryable: false, message: 'Done.' })
    vi.advanceTimersByTime(1000)
    sockets.last().accept()
    expect(sockets.last().json()).toEqual([])

    sockets.last().say({ type: 'ready', resumed: true })
    expect(sockets.last().json()).toEqual([
      { type: 'tool_answer', id: 'call-1', status: 'ok', retryable: false, message: 'Done.' },
    ])
  })

  it('tries after about 1, 2, 4 and 8 seconds, then every 8 up to the 30th, and is lost then', () => {
    const { sockets, closed } = ready()
    sockets.last().drop(1012)
    const opened: number[] = []
    const start = Date.now()
    for (let second = 0; second < 31; second += 1) {
      const before = sockets.made.length
      vi.advanceTimersByTime(1000)
      if (sockets.made.length > before) {
        opened.push(Math.round((Date.now() - start) / 1000))
        sockets.last().refuse()
      }
    }

    expect(opened).toEqual([1, 3, 7, 15, 23, 29])
    expect(closed).toEqual([{ kind: 'lost' }])
  })
})

describe('the end', () => {
  it('says "stop", then closes: nothing more is said either way', () => {
    const { sockets, relay, closed, heard } = ready()
    const socket = sockets.last()
    relay.stop()

    expect(socket.json()).toEqual([{ type: 'stop' }])
    expect(socket.closedWith).toBe(1000)
    socket.say({ type: 'said', text: 'Bye.' })
    expect(heard).toEqual([])
    expect(closed).toEqual([])
    expect(relay.sendSound(FRAME())).toBe(false)
  })

  it('stops while it opens again, with no try after', () => {
    const { sockets, relay } = ready()
    sockets.last().drop(1012)
    relay.stop()
    vi.advanceTimersByTime(RECONNECT.withinMs)

    expect(sockets.made).toHaveLength(1)
  })
})
