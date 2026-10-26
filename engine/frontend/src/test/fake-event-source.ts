/**
 * A fake EventSource that a test controls by hand. jsdom has no EventSource, and a real one
 * would need a server. `setup.ts` installs this class as `globalThis.EventSource`.
 *
 *   const source = FakeEventSource.last()
 *   source.emitOpen()
 *   source.emitMessage({ seq: 1, type: 'run_started' })           // an unnamed "message" event
 *   source.emitMessage({ seq: 2 }, { event: 'progress', lastEventId: '2' })  // a named event
 *   source.emitError()                    // the browser will reconnect (readyState CONNECTING)
 *   source.emitError({ closed: true })    // the stream is over for good (readyState CLOSED)
 *   expect(FakeEventSource.instances).toHaveLength(2)
 */
export class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2

  /** Every instance made since the last reset, oldest first. Reset after each test. */
  static instances: FakeEventSource[] = []

  static reset(): void {
    FakeEventSource.instances = []
  }

  /** The newest instance. Throws when the code under test has not opened one yet. */
  static last(): FakeEventSource {
    const source = FakeEventSource.instances.at(-1)
    if (!source) {
      throw new Error('No EventSource was opened')
    }
    return source
  }

  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSED = 2

  readonly url: string
  readonly withCredentials: boolean
  readyState: number = FakeEventSource.CONNECTING

  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  /** True once the code under test called close(). */
  closedByClient = false

  constructor(url: string | URL, init?: EventSourceInit) {
    super()
    this.url = String(url)
    this.withCredentials = init?.withCredentials ?? false
    FakeEventSource.instances.push(this)
  }

  close(): void {
    this.closedByClient = true
    this.readyState = FakeEventSource.CLOSED
  }

  /** The connection is up. */
  emitOpen(): void {
    this.readyState = FakeEventSource.OPEN
    this.deliver(new Event('open'))
  }

  /**
   * One message from the server. Objects are sent as JSON, like the backend does.
   * `event` is the SSE event name ("message" when it has none).
   */
  emitMessage(data: unknown, options: { event?: string; lastEventId?: string } = {}): void {
    const payload = typeof data === 'string' ? data : JSON.stringify(data)
    const type = options.event ?? 'message'
    this.deliver(
      new MessageEvent(type, {
        data: payload,
        lastEventId: options.lastEventId ?? '',
        origin: 'http://localhost',
      }),
    )
  }

  /** The connection broke. With `closed: true` the browser gives up (no automatic reconnect). */
  emitError(options: { closed?: boolean } = {}): void {
    this.readyState = options.closed ? FakeEventSource.CLOSED : FakeEventSource.CONNECTING
    this.deliver(new Event('error'))
  }

  private deliver(event: Event): void {
    if (this.closedByClient) {
      return
    }
    this.dispatchEvent(event)
    if (event.type === 'open') {
      this.onopen?.(event)
    } else if (event.type === 'message') {
      this.onmessage?.(event as MessageEvent)
    } else if (event.type === 'error') {
      this.onerror?.(event)
    }
  }
}
