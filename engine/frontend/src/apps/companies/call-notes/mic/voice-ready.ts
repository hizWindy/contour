/**
 * The model on the device, getting ready (PLAN-V24 T4-3, choice 25). The voice bar, the mic card
 * and the profile menu's "Get voice ready" all go through here, so a download happens once and
 * each place shows the same progress. The browser keeps the files after (`on-device/files.ts`),
 * so a second visit downloads nothing.
 *
 * - `lookAtVoice()`: whether this browser keeps the files already.
 * - `fetchVoice()`: downloads what's missing, without loading the model (no worker, so no memory
 *   held). On a laptop it runs after the page is idle, and anywhere from "Get voice ready".
 * - `getVoiceReady(onProgress)`, for Speak: it waits for the download (or does it), then loads the
 *   model and gives its voice tool. Once loaded, the model stays for the page (`loadedVoice`).
 * - `useVoiceReady()`: where it stands, for the menu's row.
 *
 * The model's code (the worker and Transformers.js) loads only from here, with `import()`. So none
 * of it is in the first visit, nor in the voice bar's own file.
 */
import { useSyncExternalStore } from 'react'
import type { Progress } from './on-device/engine'
import type { VoiceToolMaker } from './voice-tool'

/** Where the model stands on this device. */
export type VoiceReady =
  /** Not looked at yet. */
  | { state: 'unknown' }
  /** The browser doesn't keep the files: this many bytes to download. */
  | { state: 'missing'; bytes: number }
  | { state: 'downloading'; loaded: number; total: number }
  /** The browser keeps the files: nothing downloads. */
  | { state: 'kept' }
  /** The last download failed. */
  | { state: 'failed' }

/**
 * Why the model couldn't get ready: the download (the connection), or the load (the model won't
 * run on this device).
 */
export type NotReady = 'download' | 'load'

/** The reason an error from getting ready carries (`VoiceNotReady`'s `why`). */
export function whyNotReady(error: unknown): NotReady {
  const why = typeof error === 'object' && error !== null ? (error as { why?: unknown }).why : null
  return why === 'download' ? 'download' : 'load'
}

/** The model, as the mic session uses it. Tests give a fake one (`fake-mic.ts`). */
export interface ModelVoice {
  /** The model's voice tool, once it is loaded on this page: then nothing waits. */
  loaded: () => VoiceToolMaker | null
  /** Downloads what this browser doesn't keep yet, without loading the model. */
  fetch: () => Promise<void>
  /** Gets it ready: the download, with its progress, then the load. Fails with a reason. */
  prepare: (onProgress: (progress: Progress) => void) => Promise<VoiceToolMaker>
}

const loadTool = () => import('./on-device/tool')

type OnDevice = Awaited<ReturnType<typeof loadTool>>

let code: Promise<OnDevice> | null = null

/** The model's code, loaded once. A file gone after a deploy fails as a download does. */
function loadCode(): Promise<OnDevice> {
  code ??= loadTool().catch((error: unknown) => {
    code = null
    throw Object.assign(new Error(`the voice code didn't load: ${String(error)}`), {
      why: 'download' as const,
    })
  })
  return code
}

let now: VoiceReady = { state: 'unknown' }
const listeners = new Set<() => void>()

function set(next: VoiceReady): void {
  now = next
  for (const listener of [...listeners]) listener()
}

/** Where the model stands now. */
export function voiceReadyNow(): VoiceReady {
  return now
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useVoiceReady(): VoiceReady {
  return useSyncExternalStore(subscribe, voiceReadyNow, voiceReadyNow)
}

let looking: Promise<void> | null = null

/** Looks, once, whether this browser keeps the files. A look that fails changes nothing. */
export function lookAtVoice(): Promise<void> {
  looking ??= loadCode()
    .then((tool) => tool.voiceMissing())
    .then((bytes) => {
      if (now.state === 'unknown')
        set(bytes === 0 ? { state: 'kept' } : { state: 'missing', bytes })
    })
    .catch(() => {
      looking = null
    })
  return looking
}

let fetching: Promise<void> | null = null

/** Downloads what's missing, one download at a time: a second ask joins the first. */
export function fetchVoice(): Promise<void> {
  fetching ??= (async () => {
    const tool = await loadCode()
    await tool.downloadVoice(({ loaded, total }) => {
      set({ state: 'downloading', loaded, total })
    })
    set({ state: 'kept' })
  })()
    .catch((error: unknown) => {
      set({ state: 'failed' })
      throw error
    })
    .finally(() => {
      fetching = null
    })
  return fetching
}

let tool: VoiceToolMaker | null = null
let preparing: Promise<VoiceToolMaker> | null = null

/** The model's voice tool, once it is loaded on this page. */
export function loadedVoice(): VoiceToolMaker | null {
  return tool
}

/**
 * For Speak: the download (or the one under way), then the model loads. The progress goes to
 * `onProgress` and to the menu's row alike. Resolves with the model's voice tool; fails with a
 * reason (`whyNotReady`).
 */
export function getVoiceReady(onProgress?: (progress: Progress) => void): Promise<VoiceToolMaker> {
  const forward = (): void => {
    if (now.state === 'downloading') onProgress?.({ loaded: now.loaded, total: now.total })
  }
  listeners.add(forward)
  forward()
  preparing ??= (async () => {
    await fetchVoice()
    const ready = await loadCode()
    try {
      // Downloads again only if the browser let a file go meanwhile.
      await ready.prepareVoice(({ loaded, total }) => {
        set({ state: 'downloading', loaded, total })
      })
    } catch (error) {
      // A model that won't load leaves its files kept; a download that failed doesn't.
      if (whyNotReady(error) === 'download') set({ state: 'failed' })
      throw error
    }
    set({ state: 'kept' })
    const make: VoiceToolMaker = (events) => ready.onDeviceModel(events)
    tool = make
    return make
  })().finally(() => {
    preparing = null
  })
  return preparing.finally(() => {
    listeners.delete(forward)
  })
}

/** The model on this device, for the mic session. */
export const DEVICE_MODEL: ModelVoice = {
  loaded: loadedVoice,
  fetch: fetchVoice,
  prepare: getVoiceReady,
}
