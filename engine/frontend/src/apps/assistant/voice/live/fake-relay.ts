/**
 * A fake relay socket for the tests (PLAN-V28 Part 2): the browser's `WebSocket`, as live voice's
 * socket uses it, driven by the test. Only tests import it; the app never does. Nothing reaches
 * Google: there is no Google.
 *
 *   const sockets = new FakeSockets()
 *   const relay = new Relay(PATH, handlers, sockets.env())
 *   relay.open()
 *   sockets.last().accept()                       // it opens
 *   sockets.last().say({ type: 'ready' })          // the relay says Google is ready
 *   sockets.last().refuse()                        // a failed check before it opens (1008)
 *   sockets.last().drop(1012)                      // our backend restarted
 *   expect(sockets.last().json()).toEqual([{ type: 'pause' }])
 */
import type { VoiceRelayMessage } from '@/api/types'
import type { RelayEnv } from './relay'

type Handler<E> = ((event: E) => void) | null

export class FakeSocket {
  readonly url: string
  readyState = 0
  binaryType: BinaryType = 'blob'
  /** Everything the page sent, in order. */
  readonly sent: (string | ArrayBuffer)[] = []
  /** The code the page closed it with, if it did. */
  closedWith: number | null = null
  onopen: Handler<Event> = null
  onmessage: Handler<MessageEvent> = null
  onclose: Handler<CloseEvent> = null
  onerror: Handler<Event> = null

  constructor(url: string) {
    this.url = url
  }

  send(data: string | ArrayBuffer): void {
    if (this.readyState !== 1) throw new Error('The socket is not open.')
    this.sent.push(data)
  }

  close(code = 1000): void {
    if (this.readyState === 3) return
    this.closedWith = code
    this.readyState = 3
  }

  /** The relay accepts it: it opens. */
  accept(): void {
    this.readyState = 1
    this.onopen?.(new Event('open'))
  }

  /** A failed check before it opens: the browser can't read why (a 1006 with no open). */
  refuse(): void {
    this.readyState = 3
    this.onerror?.(new Event('error'))
    this.onclose?.(new CloseEvent('close', { code: 1006 }))
  }

  /** A message from the relay. */
  say(message: VoiceRelayMessage | Record<string, unknown>): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) }))
  }

  /** Raw text from the relay, for what it should never send. */
  sayText(text: string): void {
    this.onmessage?.(new MessageEvent('message', { data: text }))
  }

  /** Gemini's sound from the relay. */
  sound(pcm: ArrayBuffer): void {
    this.onmessage?.(new MessageEvent('message', { data: pcm }))
  }

  /** The relay, or our backend, closed it. */
  drop(code = 1006): void {
    this.readyState = 3
    this.onclose?.(new CloseEvent('close', { code }))
  }

  /** The JSON messages the page sent, read back. */
  json(): unknown[] {
    return this.sent
      .filter((item): item is string => typeof item === 'string')
      .map((item) => JSON.parse(item) as unknown)
  }

  /** The sound the page sent. */
  binary(): ArrayBuffer[] {
    return this.sent.filter((item): item is ArrayBuffer => item instanceof ArrayBuffer)
  }
}

/**
 * Every socket the page opened, newest last, and the page's own address. Its clock is the test's
 * (`Date.now`, which fake timers move), so the caps and the 30 seconds follow the test.
 */
export class FakeSockets {
  readonly made: FakeSocket[] = []
  protocol = 'https:'
  host = 'contour.example'

  /** The newest socket. */
  last(): FakeSocket {
    const socket = this.made.at(-1)
    if (!socket) throw new Error('No socket was opened.')
    return socket
  }

  env(): RelayEnv {
    return {
      socket: (url) => {
        const socket = new FakeSocket(url)
        this.made.push(socket)
        return socket as unknown as WebSocket
      },
      location: () => ({ protocol: this.protocol, host: this.host }),
      now: () => Date.now(),
    }
  }
}
