/**
 * The on-device voice tool (PLAN-V24 T4-2, choices 24, 26 and 28): a free speech model that runs on
 * the phone or laptop itself, for where the browser's own speech service is weak or missing.
 *
 * It gives the same five events as the browser's tool (voice-tool.ts), so the bar and the card
 * don't change. It listens to the track `start` is given: our own cleaned mic. The voice detector
 * finds the pauses; each turn's sound goes to the model in a Web Worker, and its words come back
 * as `onWords`. While you talk there are no words yet (the bars move); `onHearing` isn't used.
 * Stop gives the last words, then `onFinished`. The name hints aren't used: Moonshine can't take
 * them. Moonshine often writes names in small letters ("sample logistics"), so the tool says so
 * (`nameCase: 'any'`) and the mic session's name fix (PLAN-V23) finds names by their words.
 *
 * **The voice stays on the device.** The sound goes from the mic to the worker, and nowhere else:
 * the tool makes no request, and the worker's only requests are for the model's own files.
 *
 * For T4-3 (the engine picks itself, and the download):
 * - `onDeviceModel` is a `VoiceToolMaker`;
 * - `voiceIsKept()` says whether this browser has the files already (then nothing downloads);
 * - `prepareVoice(onProgress)` downloads what's missing and loads the model, ahead of Speak; it
 *   fails with `VoiceNotReady` ('download': the connection; 'load': the model won't run here);
 * - the worker stays loaded for the next tool; `releaseVoice()` lets it go.
 * The worker and Transformers.js load only once a tool is made or got ready: import this file
 * with `import()`, so none of it is in the first visit.
 */

import type { NameCase } from '../name-fix'
import type { VoiceProblem, VoiceTool, VoiceToolEvents } from '../voice-tool'
import { captureSound } from './capture'
import type { FromEngine, Progress, ToEngine } from './engine'
import { DEFAULT_MODEL, deviceHere, type Device, type ModelName } from './files'
// Vite builds the worker as a file of its own; this is only a way to start it.
import VoiceWorker from './worker.ts?worker'

export { voiceIsKept } from './files'

/** The parts of a Web Worker the tool uses. The tests give a fake one (fake-worker.ts). */
export interface WorkerLike {
  postMessage(message: ToEngine, transfer?: Transferable[]): void
  terminate(): void
  onmessage: ((event: MessageEvent<FromEngine>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

/** A voice tool that writes names in any case, so the name fix reads them by their words. */
export interface OnDeviceTool extends VoiceTool {
  readonly nameCase: NameCase
}

/** What the tool runs on. */
export interface OnDeviceEnv {
  worker: () => WorkerLike
  /** Hears a mic track: the sound in chunks at the mic's own rate, and a way to stop. */
  capture: (
    track: MediaStreamTrack,
    onSound: (samples: Float32Array, rate: number) => void,
  ) => Promise<() => void>
}

export const ON_DEVICE: OnDeviceEnv = {
  worker: () => new VoiceWorker(),
  capture: captureSound,
}

/** After Stop, the last words get this long before the tool says it is finished anyway. */
const LAST_WORDS_MS = 15_000

/**
 * When a device is too slow for the model (choice 24, TBC at S2): the first three turns of at
 * least a second took, together, longer to write than they lasted. Then the words would fall
 * further behind the talk with every turn.
 */
export const TOO_SLOW = { shortestMs: 1000, turns: 3, times: 1 }

/** Why the model couldn't get ready: the download failed, or the model won't run here. */
export class VoiceNotReady extends Error {
  readonly why: 'download' | 'load'

  constructor(why: 'download' | 'load') {
    super(`voice isn't ready: ${why}`)
    this.why = why
  }
}

type StreamMessage = Extract<FromEngine, { id: number }>

/** The one worker, shared by every tool on the page, and its listeners. */
class Connection {
  private worker: WorkerLike | null = null
  private ready: Promise<Device> | null = null
  private settle: {
    resolve: (device: Device) => void
    reject: (error: VoiceNotReady) => void
  } | null = null
  private readonly listeners = new Map<number, (message: StreamMessage) => void>()
  private readonly watchers = new Set<(progress: Progress) => void>()
  readonly env: OnDeviceEnv
  readonly model: ModelName
  /** Where the model runs, when the caller says (S2's test page); else this device's best. */
  readonly device: Device | undefined

  constructor(env: OnDeviceEnv, model: ModelName, device: Device | undefined) {
    this.env = env
    this.model = model
    this.device = device
  }

  /** The model, downloaded and loaded. Once ready, it stays ready. */
  prepare(onProgress?: (progress: Progress) => void): Promise<Device> {
    if (onProgress) this.watchers.add(onProgress)
    this.ready ??= new Promise<Device>((resolve, reject) => {
      const settle = { resolve, reject }
      this.settle = settle
      void (this.device ? Promise.resolve(this.device) : deviceHere()).then((device) => {
        if (this.settle === settle) this.send({ type: 'prepare', model: this.model, device })
      })
    })
    const ready = this.ready
    if (onProgress) {
      ready.then(
        () => this.watchers.delete(onProgress),
        () => this.watchers.delete(onProgress),
      )
    }
    return ready
  }

  listen(id: number, listener: (message: StreamMessage) => void): void {
    this.listeners.set(id, listener)
  }

  forget(id: number): void {
    this.listeners.delete(id)
  }

  /** Only `prepare` makes the worker: the rest go to it if it is there. */
  send(message: ToEngine, transfer?: Transferable[]): void {
    const worker = message.type === 'prepare' ? this.open() : this.worker
    worker?.postMessage(message, transfer)
  }

  /** The worker goes; anything still waiting on it hears that it broke. */
  close(): void {
    this.worker?.terminate()
    this.worker = null
    const settle = this.settle
    this.settle = null
    this.ready = null
    settle?.reject(new VoiceNotReady('load'))
    for (const [id, listener] of [...this.listeners]) listener({ type: 'broke', id })
    this.listeners.clear()
  }

  private open(): WorkerLike {
    if (this.worker) return this.worker
    const worker = this.env.worker()
    worker.onmessage = (event) => this.heard(event.data)
    worker.onerror = () => {
      // The worker broke (its script failed, or it ran out of memory): the next tool makes another.
      this.close()
      if (shared === this) shared = null
    }
    this.worker = worker
    return worker
  }

  private heard(message: FromEngine): void {
    switch (message.type) {
      case 'progress':
        for (const watch of this.watchers) watch({ loaded: message.loaded, total: message.total })
        return
      case 'ready':
        this.settle?.resolve(message.device)
        this.settle = null
        return
      case 'unready': {
        const settle = this.settle
        this.settle = null
        this.ready = null
        settle?.reject(new VoiceNotReady(message.why))
        return
      }
      default:
        this.listeners.get(message.id)?.(message)
    }
  }
}

let shared: Connection | null = null
let lastId = 0

export interface OnDeviceOptions {
  /** Moonshine Base unless told (choice 23). */
  model?: ModelName
  /** WebGPU where the device has it, else the CPU, unless told (S2 tries both). */
  device?: Device
  env?: OnDeviceEnv
  /** Each turn's words with its length and the model's time, for S2 and the speed check. */
  onTurn?: (turn: { text: string; soundMs: number; workMs: number }) => void
}

/** The shared worker for these options: another model or device needs a worker of its own. */
function connect({ model = DEFAULT_MODEL, device, env = ON_DEVICE }: OnDeviceOptions): Connection {
  if (shared && (shared.env !== env || shared.model !== model || shared.device !== device)) {
    shared.close()
    shared = null
  }
  shared ??= new Connection(env, model, device)
  return shared
}

/** The on-device model as a voice tool. */
export function onDeviceModel(
  events: VoiceToolEvents,
  options: OnDeviceOptions = {},
): OnDeviceTool {
  lastId += 1
  const id = lastId
  const env = options.env ?? ON_DEVICE
  const connection = connect(options)
  /** The worker knows this listener. */
  let started = false
  let stopping = false
  let over = false
  let release: (() => void) | null = null
  let waiting = 0
  const timed: { sound: number; work: number }[] = []

  const end = (): void => {
    over = true
    window.clearTimeout(waiting)
    release?.()
    release = null
    connection.forget(id)
  }

  const fail = (problem: VoiceProblem): void => {
    if (over) return
    end()
    if (started) connection.send({ type: 'drop', id })
    events.onProblem(problem)
  }

  const finish = (): void => {
    if (over) return
    end()
    events.onFinished()
  }

  /** Choice 24's rule (`TOO_SLOW`), on the first turns long enough to time. */
  const judge = (soundMs: number, workMs: number): void => {
    if (soundMs < TOO_SLOW.shortestMs || timed.length >= TOO_SLOW.turns) return
    timed.push({ sound: soundMs, work: workMs })
    if (timed.length < TOO_SLOW.turns) return
    const sound = timed.reduce((sum, turn) => sum + turn.sound, 0)
    const work = timed.reduce((sum, turn) => sum + turn.work, 0)
    if (work > TOO_SLOW.times * sound) fail('too_slow')
  }

  const hear = (message: StreamMessage): void => {
    if (over) return
    if (message.type === 'words') {
      const { text, soundMs, workMs } = message
      if (text) events.onWords(text)
      options.onTurn?.({ text, soundMs, workMs })
      judge(soundMs, workMs)
    } else if (message.type === 'finished') {
      finish()
    } else {
      fail('tool_failed')
    }
  }

  const begin = async (track: MediaStreamTrack): Promise<void> => {
    await connection.prepare()
    if (over || stopping) return
    connection.send({ type: 'start', id })
    started = true
    const stop = await env.capture(track, (samples, rate) => {
      if (!over && !stopping)
        connection.send({ type: 'sound', id, rate, samples }, [samples.buffer])
    })
    if (over || stopping) {
      stop()
      return
    }
    release = stop
    events.onReady()
  }

  return {
    nameCase: 'any',
    start(track) {
      if (over || started) return
      if (!track) {
        fail('no_mic')
        return
      }
      connection.listen(id, hear)
      begin(track).catch(() => fail('tool_failed'))
    },
    stop() {
      if (over || stopping) return
      stopping = true
      release?.()
      release = null
      if (!started) {
        finish()
        return
      }
      connection.send({ type: 'stop', id })
      waiting = window.setTimeout(finish, LAST_WORDS_MS)
    },
    abort() {
      if (over) return
      end()
      if (started) connection.send({ type: 'drop', id })
    },
  }
}

/**
 * Gets the model ready ahead of Speak (choice 25's "Get voice ready"): downloads what this browser
 * doesn't keep yet, with progress in bytes, then loads it. Resolves with where it runs.
 */
export function prepareVoice(
  onProgress?: (progress: Progress) => void,
  options: OnDeviceOptions = {},
): Promise<Device> {
  return connect(options).prepare(onProgress)
}

/** Lets the worker and its model go (they hold memory). The next tool loads them again. */
export function releaseVoice(): void {
  shared?.close()
  shared = null
}
