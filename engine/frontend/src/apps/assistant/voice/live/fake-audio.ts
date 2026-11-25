/**
 * A fake Web Audio for the tests of live voice's sound on the page (PLAN-V28 T2-1, T2-2): the
 * `AudioContext` and the `AudioWorkletNode`, as `audio.ts`, `capture.ts` and `player.ts` use them.
 * Only tests import it; the app never does. No sound plays and none is recorded.
 *
 *   const audio = installAudio()                // in a beforeEach: the fakes in the window
 *   await openPlayer(new FakeContext(...), ...)
 *   audio.nodes[0]?.tell({ type: 'speaking' })  // the worklet tells the page something
 */
import { vi } from 'vitest'

/** Every context and worklet node made since `installAudio`, oldest first. */
export interface FakeAudio {
  contexts: FakeContext[]
  nodes: FakeNode[]
}

let made: FakeAudio = { contexts: [], nodes: [] }

export class FakeContext {
  readonly options: AudioContextOptions | undefined
  readonly sampleRate: number
  state: AudioContextState = 'suspended'
  closed = false
  resumed = 0
  readonly modules: string[] = []
  readonly destination = { kind: 'speakers' }
  readonly sources: { stream: unknown; connected: unknown[]; disconnected: boolean }[] = []
  readonly audioWorklet = {
    addModule: (url: string) => {
      this.modules.push(url)
      return Promise.resolve()
    },
  }

  constructor(options?: AudioContextOptions) {
    this.options = options
    this.sampleRate = options?.sampleRate ?? 48_000
    made.contexts.push(this)
  }

  resume(): Promise<void> {
    this.resumed += 1
    this.state = 'running'
    return Promise.resolve()
  }

  close(): Promise<void> {
    this.closed = true
    return Promise.resolve()
  }

  createMediaStreamSource(stream: unknown) {
    const source = {
      stream,
      connected: [] as unknown[],
      disconnected: false,
      connect: (target: unknown) => {
        source.connected.push(target)
      },
      disconnect: () => {
        source.disconnected = true
      },
    }
    this.sources.push(source)
    return source
  }

  createAnalyser() {
    return {
      fftSize: 2048,
      frequencyBinCount: 512,
      minDecibels: -100,
      maxDecibels: -30,
      smoothingTimeConstant: 0.8,
      context: this,
      getByteFrequencyData: () => undefined,
    }
  }

  /** As the page's code sees it. */
  get asContext(): AudioContext {
    return this as unknown as AudioContext
  }
}

/** A browser that refuses a context at a rate of the page's own choosing, like 24 kHz. */
export class FussyContext extends FakeContext {
  constructor(options?: AudioContextOptions) {
    if (options?.sampleRate !== undefined) {
      throw new DOMException('Not that rate', 'NotSupportedError')
    }
    super(options)
  }
}

export class FakeNode {
  readonly name: string
  readonly options: AudioWorkletNodeOptions
  readonly posted: { message: unknown; transfer: Transferable[] }[] = []
  readonly connected: unknown[] = []
  disconnected = false
  readonly port = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: (message: unknown, transfer: Transferable[] = []) => {
      this.posted.push({ message, transfer })
    },
  }

  constructor(_context: unknown, name: string, options: AudioWorkletNodeOptions) {
    this.name = name
    this.options = options
    made.nodes.push(this)
  }

  connect(target: unknown): void {
    this.connected.push(target)
  }

  disconnect(): void {
    this.disconnected = true
  }

  /** The worklet tells the page something. */
  tell(data: unknown): void {
    this.port.onmessage?.(new MessageEvent('message', { data }))
  }
}

/** Puts the fakes in the window for this test, and starts the lists again. */
export function installAudio(context: typeof FakeContext = FakeContext): FakeAudio {
  made = { contexts: [], nodes: [] }
  vi.stubGlobal('AudioContext', context)
  vi.stubGlobal('AudioWorkletNode', FakeNode)
  return made
}
