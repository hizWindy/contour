/**
 * A stand-in for the speech model's Web Worker, for tests (PLAN-V24 T4-2). It runs the real
 * engine.ts, so the tests cover the real turn finding, with made-up models and no download:
 * - the voice detector calls a window speech when it is loud;
 * - the model's words come from the test ("turn 1", "turn 2" unless told), and it "takes" a tenth
 *   of the turn's length to write them, on its own clock, unless told.
 * The mic is made up too (`hear`): sound goes in as the test says, at any rate.
 */

import { DownloadFailed, VoiceEngine, type FromEngine, type Models, type ToEngine } from './engine'
import type { OnDeviceEnv, WorkerLike } from './tool'
import { RATE } from './turns'

export interface FakeModels {
  /** The words for the nth turn (from 1). */
  words?: (turn: number, sound: Float32Array) => string
  /** How long the model takes to write a turn of this length, in ms. */
  workMs?: (soundMs: number) => number
  /** The models never get ready: the download fails, or the model won't load. */
  unready?: 'download' | 'load'
  /** The model fails on this turn (from 1). */
  breaksOn?: number
}

const loudness = (window: Float32Array): number =>
  window.reduce((sum, sample) => sum + Math.abs(sample), 0) / window.length

export class FakeVoiceWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<FromEngine>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  /** Everything the tool sent, in order. */
  readonly sent: ToEngine[] = []
  terminated = false
  private clock = 0
  private readonly engine: VoiceEngine

  constructor(fake: FakeModels = {}) {
    let turns = 0
    const models: Models = {
      device: 'wasm',
      detector: () => (window) => Promise.resolve(loudness(window) > 0.05 ? 0.9 : 0.05),
      words: (sound) => {
        turns += 1
        if (turns === fake.breaksOn) return Promise.reject(new Error('the model broke'))
        const soundMs = (sound.length / RATE) * 1000
        this.clock += fake.workMs?.(soundMs) ?? soundMs / 10
        return Promise.resolve(fake.words?.(turns, sound) ?? `turn ${turns}`)
      },
    }
    this.engine = new VoiceEngine(
      (_model, _device, onProgress) => {
        onProgress({ loaded: 0, total: 100 })
        onProgress({ loaded: 100, total: 100 })
        if (fake.unready === 'download') return Promise.reject(new DownloadFailed('no network'))
        if (fake.unready === 'load') return Promise.reject(new Error('no model'))
        return Promise.resolve(models)
      },
      (message) => queueMicrotask(() => this.answer(message)),
      () => this.clock,
    )
  }

  postMessage(message: ToEngine): void {
    if (this.terminated) return
    this.sent.push(message)
    queueMicrotask(() => this.engine.take(message))
  }

  terminate(): void {
    this.terminated = true
  }

  /** The worker breaks, as when its script fails to load. */
  crash(): void {
    this.onerror?.(new ErrorEvent('error', { message: 'the worker broke' }))
  }

  private answer(message: FromEngine): void {
    if (!this.terminated) this.onmessage?.(new MessageEvent('message', { data: message }))
  }
}

/** Made-up sound: speech (loud) or quiet, this many ms long, at a rate. */
export function sound(kind: 'speech' | 'quiet', ms: number, rate = RATE): Float32Array {
  const samples = new Float32Array(Math.round((ms / 1000) * rate))
  if (kind === 'speech') {
    for (let index = 0; index < samples.length; index += 1) samples[index] = Math.sin(index / 3) / 2
  }
  return samples
}

/** A fake voice: the workers it made, the mic's sound going in, and whether the mic was let go. */
export function fakeVoice(fake: FakeModels = {}) {
  const workers: FakeVoiceWorker[] = []
  let onSound: ((samples: Float32Array, rate: number) => void) | null = null
  const state = { capturing: false, captures: 0 }
  const env: OnDeviceEnv = {
    worker: () => {
      const worker = new FakeVoiceWorker(fake)
      workers.push(worker)
      return worker
    },
    capture: (_track, give) => {
      onSound = give
      state.capturing = true
      state.captures += 1
      return Promise.resolve(() => {
        state.capturing = false
        onSound = null
      })
    },
  }
  return {
    env,
    workers,
    state,
    /** The mic hears this sound, in chunks of 100 ms as the real one gives it. */
    hear(samples: Float32Array, rate = RATE): void {
      const chunk = Math.round(rate / 10)
      for (let at = 0; at < samples.length; at += chunk)
        onSound?.(samples.slice(at, at + chunk), rate)
    },
  }
}

/** A mic track, as far as the tool can tell. */
export const fakeTrack = (): MediaStreamTrack => ({ kind: 'audio' }) as MediaStreamTrack
