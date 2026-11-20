/**
 * The speech model's side of the voice tool (PLAN-V24 T4-2): what runs inside the Web Worker. It
 * gets the models ready, then takes the mic's sound for each listener, finds the turns, and sends
 * back each turn's words. The models come in through `Loader`, so the tests run all of this with
 * made-up ones (fake-worker.ts), and only worker.ts brings the real ones (models.ts).
 *
 * The sound stays here. Nothing in this file makes a request; the only requests the worker makes
 * are models.ts's downloads of the listed model files (files.ts), before any sound arrives.
 */

import type { Device, ModelName } from './files'
import { RATE, Resampler, TurnFinder, Windows } from './turns'

export interface Progress {
  /** Bytes downloaded so far, of `total`. Files already kept on the device don't count. */
  loaded: number
  total: number
}

/** The models, ready to use. */
export interface Models {
  device: Device
  /** A voice detector for one stream of sound: the chance that each window is speech. */
  detector: () => (window: Float32Array) => Promise<number>
  /** The words in a turn's sound (16 kHz). */
  words: (sound: Float32Array) => Promise<string>
}

/** Gets the models ready: downloads what isn't kept yet, then loads them. */
export type Loader = (
  model: ModelName,
  device: Device,
  onProgress: (progress: Progress) => void,
) => Promise<Models>

/** A download that failed, as opposed to a model that wouldn't load. */
export class DownloadFailed extends Error {}

/** To the worker. `id` is one listener (one voice tool). */
export type ToEngine =
  | { type: 'prepare'; model: ModelName; device: Device }
  | { type: 'start'; id: number }
  | { type: 'sound'; id: number; rate: number; samples: Float32Array }
  | { type: 'stop'; id: number }
  | { type: 'drop'; id: number }

/** From the worker. */
export type FromEngine =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; device: Device }
  | { type: 'unready'; why: 'download' | 'load' }
  | { type: 'words'; id: number; text: string; soundMs: number; workMs: number }
  | { type: 'finished'; id: number }
  | { type: 'broke'; id: number }

/** One listener's sound, in order: each step waits for the one before. */
interface Stream {
  chain: Promise<void>
  resampler: Resampler | null
  windows: Windows
  finder: TurnFinder
  chance: (window: Float32Array) => Promise<number>
}

export class VoiceEngine {
  private models: Models | null = null
  private loading = false
  private readonly streams = new Map<number, Stream>()
  private readonly load: Loader
  private readonly post: (message: FromEngine) => void
  private readonly now: () => number

  constructor(
    load: Loader,
    post: (message: FromEngine) => void,
    now: () => number = () => performance.now(),
  ) {
    this.load = load
    this.post = post
    this.now = now
  }

  take(message: ToEngine): void {
    switch (message.type) {
      case 'prepare':
        this.prepare(message.model, message.device)
        return
      case 'start':
        this.start(message.id)
        return
      case 'sound':
        this.then(message.id, (stream) => this.hear(message.id, stream, message))
        return
      case 'stop':
        if (!this.streams.has(message.id)) this.post({ type: 'finished', id: message.id })
        this.then(message.id, async (stream) => {
          const turn = stream.finder.flush()
          if (turn) await this.say(message.id, stream, turn)
          if (this.streams.get(message.id) !== stream) return
          this.streams.delete(message.id)
          this.post({ type: 'finished', id: message.id })
        })
        return
      case 'drop':
        this.streams.delete(message.id)
        return
    }
  }

  private prepare(model: ModelName, device: Device): void {
    if (this.models) {
      this.post({ type: 'ready', device: this.models.device })
      return
    }
    if (this.loading) return
    this.loading = true
    this.load(model, device, (progress) => this.post({ type: 'progress', ...progress })).then(
      (models) => {
        this.loading = false
        this.models = models
        this.post({ type: 'ready', device: models.device })
      },
      (error: unknown) => {
        this.loading = false
        this.post({ type: 'unready', why: error instanceof DownloadFailed ? 'download' : 'load' })
      },
    )
  }

  private start(id: number): void {
    if (!this.models) {
      this.post({ type: 'broke', id })
      return
    }
    this.streams.set(id, {
      chain: Promise.resolve(),
      resampler: null,
      windows: new Windows(),
      finder: new TurnFinder(),
      chance: this.models.detector(),
    })
  }

  /** Runs a step for a listener after its earlier ones. A step that fails ends the listener. */
  private then(id: number, step: (stream: Stream) => Promise<void>): void {
    const stream = this.streams.get(id)
    if (!stream) return
    stream.chain = stream.chain.then(() =>
      this.streams.get(id) === stream ? step(stream) : undefined,
    )
    stream.chain = stream.chain.catch(() => {
      if (this.streams.get(id) !== stream) return
      this.streams.delete(id)
      this.post({ type: 'broke', id })
    })
  }

  private async hear(
    id: number,
    stream: Stream,
    { rate, samples }: { rate: number; samples: Float32Array },
  ): Promise<void> {
    stream.resampler ??= new Resampler(rate)
    for (const window of stream.windows.push(stream.resampler.push(samples))) {
      const turn = stream.finder.step(window, await stream.chance(window))
      if (turn) await this.say(id, stream, turn)
      if (this.streams.get(id) !== stream) return
    }
  }

  private async say(id: number, stream: Stream, turn: Float32Array): Promise<void> {
    const models = this.models
    if (!models) return
    const started = this.now()
    const text = await models.words(turn)
    if (this.streams.get(id) !== stream) return
    this.post({
      type: 'words',
      id,
      text,
      soundMs: (turn.length / RATE) * 1000,
      workMs: this.now() - started,
    })
  }
}
