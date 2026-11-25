/**
 * Live voice's socket to our own relay (PLAN-V28 T2-3; the relay is T1-3). Its messages are the
 * contract's own types (`VoiceBrowserMessage`, `VoiceRelayMessage`), made from the server's list.
 *
 * - **Where:** the path the start gave (`/api/v1/.../voice/live?session=<id>`), on the page's own
 *   host: `ws:` for `http:`, `wss:` for `https:`. Never another host. The content policy's
 *   `connect-src 'self'` covers it in Chrome, Edge, Firefox and Safari 16 or later (WebKit counted
 *   our own `wss:` as `'self'` from Safari 16.0, Sept 2022); an older Safari refuses the socket,
 *   and the free mic takes over.
 * - **The relay's rules, kept here,** because breaking one ends the whole talk as `refused`:
 *   - no sound before `ready`, and only whole 20 ms pieces (640 bytes);
 *   - sound under 1.4 times real time on average, with at most 2.5 s at once: the relay allows
 *     1.5 times and 3 s, and a page that stalled and caught up drops its oldest sound rather than
 *     break it;
 *   - JSON at most 8 a second, 16 at once (the relay: 10 and 20);
 *   - a tool answer is exactly `type`, `id`, `status`, `retryable` and `message`, with `message`
 *     cut to 500 characters, counted as the relay counts them.
 * - **A failed check before it opens** (sign-in, Origin, the switch, a row that isn't yours, too
 *   old, or opened already) closes it with 1008, and the browser can't read why: a failed start.
 * - **Our backend restarts** (a deploy): the socket closes with 1012, or drops with no `ended`. The
 *   same path opens again, with tries after about 1, 2, 4 and 8 seconds, then every 8, and the talk
 *   carries on at `ready` with `resumed`. After 30 seconds, the talk is lost.
 * - **`ended`** comes before the relay closes it: its reason and its line.
 */
import type {
  VoiceBrowserMessage,
  VoiceEnded,
  VoiceRelayMessage,
  VoiceToolAnswer,
} from '@/api/types'
import { FRAME_BYTES, RATE_IN } from './dsp'

/** A tool answer's words: the relay refuses more (`MESSAGE_MAX_CHARS`). */
export const MESSAGE_MAX = 500

/** Opening the same path again after our backend went (T1-4's server side). */
export const RECONNECT = {
  /** Between tries: about 1, 2, 4 and 8 seconds, then 8 again. */
  waits: [1000, 2000, 4000, 8000] as readonly number[],
  /** After this, the talk is lost. */
  withinMs: 30_000,
}

/** Our caps, each under the relay's. */
const SOUND_RATE = RATE_IN * 2 * 1.4
const SOUND_BURST = RATE_IN * 2 * 2.5
const JSON_RATE = 8
const JSON_BURST = 16

/** A socket that is open (`WebSocket.OPEN`). */
const OPEN = 1

/** How the socket ended, as the talk reads it. Said once. */
export type RelayClosed =
  /** It never reached `ready`: refused before it opened (1008), or gone before Google was ready. */
  | { kind: 'refused' }
  /** The relay ended the talk, with its reason and its line. */
  | { kind: 'ended'; ended: VoiceEnded }
  /** Our backend didn't come back within 30 seconds. */
  | { kind: 'lost' }

/** Every message from the relay but `ready` and `ended`, which the socket reads itself. */
export type RelayMessage = Exclude<VoiceRelayMessage, { type: 'ready' } | { type: 'ended' }>

export interface RelayHandlers {
  /** Google is ready: sound may go. `resumed`: the talk carried on after our backend restarted. */
  ready: (resumed: boolean) => void
  message: (message: RelayMessage) => void
  /** Gemini's sound: 16-bit little-endian PCM at 24 kHz. */
  sound: (pcm: ArrayBuffer) => void
  /** Our backend went: the socket opens again (the pill says "Reconnecting"). */
  reconnecting: () => void
  closed: (closed: RelayClosed) => void
}

export interface RelayEnv {
  /** Opens a socket: the browser's own, or a test's fake. */
  socket: (url: string) => WebSocket
  /** The page's own address: its scheme and host. */
  location: () => { protocol: string; host: string }
  now: () => number
}

export function browserRelay(): RelayEnv {
  return {
    socket: (url) => new WebSocket(url),
    location: () => window.location,
    now: () => performance.now(),
  }
}

/** The socket's address: the path on the page's own host. Null for anything that isn't ours. */
export function socketUrl(path: string, place: { protocol: string; host: string }): string | null {
  if (!path.startsWith('/api/') || path.includes('\\')) return null
  const scheme = place.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${place.host}${path}`
}

/** A tool answer's words, cut to 500 characters as the relay counts them (code points). */
export function cutMessage(message: string): string {
  const characters = Array.from(message)
  return characters.length <= MESSAGE_MAX ? message : characters.slice(0, MESSAGE_MAX).join('')
}

function isText(value: unknown): value is string {
  return typeof value === 'string'
}

/** One message from the relay, or null for one this website doesn't know. */
export function readMessage(text: string): VoiceRelayMessage | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const message = value as Record<string, unknown>
  switch (message.type) {
    case 'ready':
      return { type: 'ready', resumed: message.resumed === true }
    case 'heard':
      return isText(message.text)
        ? {
            type: 'heard',
            text: message.text,
            final: message.final === true,
            interim: message.interim === true,
          }
        : null
    case 'said':
      return isText(message.text) ? { type: 'said', text: message.text } : null
    case 'interrupted':
    case 'turn_complete':
    case 'reconnecting':
    case 'reconnected':
      return { type: message.type }
    case 'tool_call':
      return isText(message.id) && isText(message.request)
        ? { type: 'tool_call', id: message.id, request: message.request }
        : null
    case 'tool_cancel':
      return Array.isArray(message.ids) && message.ids.every(isText)
        ? { type: 'tool_cancel', ids: message.ids }
        : null
    case 'ended':
      return isText(message.reason)
        ? {
            type: 'ended',
            reason: message.reason as VoiceEnded['reason'],
            line: isText(message.line) ? message.line : null,
          }
        : null
    default:
      return null
  }
}

/** A rate cap: `rate` a second on average, `burst` at once. */
class Bucket {
  private readonly rate: number
  private readonly burst: number
  private level: number
  private at: number

  constructor(rate: number, burst: number, now: number) {
    this.rate = rate
    this.burst = burst
    this.level = burst
    this.at = now
  }

  take(amount: number, now: number): boolean {
    this.level = Math.min(this.burst, this.level + ((now - this.at) / 1000) * this.rate)
    this.at = now
    if (this.level < amount) return false
    this.level -= amount
    return true
  }

  /** How long until `amount` can be taken, in ms. */
  wait(amount: number): number {
    return Math.max(0, ((amount - this.level) / this.rate) * 1000)
  }
}

export class Relay {
  private readonly path: string
  private readonly on: RelayHandlers
  private readonly env: RelayEnv
  private socket: WebSocket | null = null
  /** Google is ready on this socket: sound may go. */
  private ready = false
  private everReady = false
  private ended: VoiceEnded | null = null
  private over = false
  /** When our backend went, while the socket opens again. */
  private droppedAt: number | null = null
  private tries = 0
  private retryTimer = 0
  private deadline = 0
  private readonly soundCap: Bucket
  private readonly jsonCap: Bucket
  private readonly waiting: string[] = []
  private jsonTimer = 0

  constructor(path: string, on: RelayHandlers, env: RelayEnv = browserRelay()) {
    this.path = path
    this.on = on
    this.env = env
    this.soundCap = new Bucket(SOUND_RATE, SOUND_BURST, env.now())
    this.jsonCap = new Bucket(JSON_RATE, JSON_BURST, env.now())
  }

  open(): void {
    if (this.socket || this.over) return
    this.connect()
  }

  /** Sound may go now. */
  get isReady(): boolean {
    return this.ready && !this.over
  }

  /** One 20 ms piece of the rep's sound. False: it didn't go (not ready, or over the cap). */
  sendSound(pcm: ArrayBuffer): boolean {
    const socket = this.socket
    if (!this.isReady || socket?.readyState !== OPEN || pcm.byteLength !== FRAME_BYTES) return false
    if (!this.soundCap.take(pcm.byteLength, this.env.now())) return false
    socket.send(pcm)
    return true
  }

  /** The rep went quiet (the silence gate): Google may answer. Only while it is ready. */
  pause(): void {
    if (this.isReady) this.sendJson({ type: 'pause' })
  }

  /** The answer to a tool call: exactly the relay's five fields, the words cut to 500. */
  answer({ id, status, retryable, message }: Omit<VoiceToolAnswer, 'type'>): void {
    if (this.over) return
    this.sendJson({ type: 'tool_answer', id, status, retryable, message: cutMessage(message) })
  }

  /** Ends the talk: `stop`, then the socket closes. Nothing more is said. */
  stop(): void {
    if (this.over) return
    this.over = true
    this.clearTimers()
    const socket = this.socket
    this.socket = null
    this.ready = false
    if (socket?.readyState === OPEN) {
      try {
        socket.send(JSON.stringify({ type: 'stop' } satisfies VoiceBrowserMessage))
      } catch {
        // Gone already: the relay ends the talk as the browser left.
      }
    }
    try {
      socket?.close(1000)
    } catch {
      // Closed already.
    }
  }

  // --- The socket -------------------------------------------------------------------------------

  private connect(): void {
    const url = socketUrl(this.path, this.env.location())
    if (!url) {
      this.finish({ kind: 'refused' })
      return
    }
    let socket: WebSocket
    try {
      socket = this.env.socket(url)
    } catch {
      this.lostSocket()
      return
    }
    socket.binaryType = 'arraybuffer'
    this.socket = socket
    socket.onmessage = (event: MessageEvent) => {
      this.onMessage(socket, event.data)
    }
    socket.onclose = () => {
      this.onClose(socket)
    }
    // A close always follows an error: it is read there.
    socket.onerror = () => undefined
  }

  private onMessage(socket: WebSocket, data: unknown): void {
    if (socket !== this.socket || this.over) return
    if (data instanceof ArrayBuffer) {
      this.on.sound(data)
      return
    }
    if (typeof data !== 'string') return
    const message = readMessage(data)
    if (!message) return
    if (message.type === 'ready') {
      this.ready = true
      this.everReady = true
      this.droppedAt = null
      this.tries = 0
      window.clearTimeout(this.deadline)
      this.on.ready(message.resumed)
      this.drainJson()
      return
    }
    if (message.type === 'ended') {
      // The relay closes the socket next.
      this.ended = message
      return
    }
    this.on.message(message)
  }

  private onClose(socket: WebSocket): void {
    if (socket !== this.socket || this.over) return
    this.socket = null
    this.ready = false
    if (this.ended) {
      this.finish({ kind: 'ended', ended: this.ended })
      return
    }
    this.lostSocket()
  }

  /** The socket went with no `ended`: a failed start, or our backend restarting. */
  private lostSocket(): void {
    if (!this.everReady) {
      this.finish({ kind: 'refused' })
      return
    }
    const now = this.env.now()
    if (this.droppedAt === null) {
      this.droppedAt = now
      this.deadline = window.setTimeout(() => {
        this.finish({ kind: 'lost' })
      }, RECONNECT.withinMs)
      this.on.reconnecting()
    }
    const waits = RECONNECT.waits
    // The last try comes a second before the 30 are up, so the whole window is used.
    const left = RECONNECT.withinMs - (now - this.droppedAt) - 1000
    const wait = Math.min(waits[Math.min(this.tries, waits.length - 1)] ?? 8000, left)
    if (wait < 500) {
      this.finish({ kind: 'lost' })
      return
    }
    this.tries += 1
    this.retryTimer = window.setTimeout(() => {
      if (!this.over) this.connect()
    }, wait)
  }

  private finish(closed: RelayClosed): void {
    if (this.over) return
    this.over = true
    this.clearTimers()
    const socket = this.socket
    this.socket = null
    this.ready = false
    try {
      socket?.close(1000)
    } catch {
      // Closed already.
    }
    this.on.closed(closed)
  }

  private clearTimers(): void {
    window.clearTimeout(this.retryTimer)
    window.clearTimeout(this.deadline)
    window.clearTimeout(this.jsonTimer)
  }

  // --- JSON, under the relay's cap ---------------------------------------------------------------

  private sendJson(message: VoiceBrowserMessage): void {
    this.waiting.push(JSON.stringify(message))
    this.drainJson()
  }

  /** Sends what waits, while the cap allows; a tool answer waits for `ready` after a restart. */
  private drainJson(): void {
    window.clearTimeout(this.jsonTimer)
    const socket = this.socket
    if (!this.isReady || socket?.readyState !== OPEN) return
    while (this.waiting.length > 0) {
      if (!this.jsonCap.take(1, this.env.now())) {
        this.jsonTimer = window.setTimeout(() => {
          this.drainJson()
        }, this.jsonCap.wait(1))
        return
      }
      const text = this.waiting.shift()
      if (text !== undefined) socket.send(text)
    }
  }
}
