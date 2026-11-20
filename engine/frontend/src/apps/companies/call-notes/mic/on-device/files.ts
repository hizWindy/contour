/**
 * The speech model's files (PLAN-V24 T4-1, choice 25), and where this browser keeps them.
 *
 * Every file comes from our own site, never from another one while a rep works:
 * - the models (Moonshine and the voice detector) under /voice/, put there at build time by
 *   scripts/voice-files.js from the list in files.json, each at a fixed revision with its sha256;
 * - ONNX Runtime's WebAssembly under /assets/: Vite serves it from the installed onnxruntime-web,
 *   whose version and sha256 the same script checks.
 *
 * The first time, the files are downloaded once, checked against the list (size and sha256), and
 * kept in the browser's Cache Storage (`CACHE`). After that they come from there: a second visit
 * downloads nothing. Only our own checked copy counts as kept. The service worker keeps /assets/
 * files as they pass, before anyone checks them, and our site answers a missing file with its
 * index.html and a 200, so its copy may be wrong: a file that fails its check leaves both stores,
 * and a good one stays in ours only.
 */

import cpuGlue from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url'
import cpuWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import gpuWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import listText from './files.json?raw'
import { DownloadFailed, type Progress } from './engine'

/** The models in the list. Whisper base is only for S2's test page (TBC at S2). */
export type ModelName = 'moonshine-base' | 'moonshine-tiny' | 'whisper-base-en'

/** Where the model runs: the graphics chip (WebGPU) or the CPU (WebAssembly). */
export type Device = 'webgpu' | 'wasm'

/** Moonshine Base by default, Tiny for slower phones (choice 23, TBC at S2). */
export const DEFAULT_MODEL: ModelName = 'moonshine-base'

/** The voice detector, Silero VAD. */
export const DETECTOR = 'silero-vad'

interface Facts {
  bytes: number
  sha256: string
}

interface List {
  served: string
  runtime: { package: string; version: string; files: Record<string, Facts> }
  models: Record<
    string,
    { repo: string; revision: string; folder: string; files: Record<string, Facts> }
  >
}

const LIST = JSON.parse(listText) as List

/** A file to have on the device: where it is on our site, and what it must be. */
export interface VoiceFile extends Facts {
  url: string
}

/** The browser's store for these files. */
export const CACHE = 'contour-voice'

/** The service worker's own store of /assets/ files (src/pwa/sw.js), filled as they pass. */
export const SW_ASSETS = 'contour-assets'

/** On our kept copies: the size each had when it passed its check. Reading it reads no file. */
export const CHECKED_BYTES = 'x-contour-checked-bytes'

/** Where the models are on our site (/voice/). Each has a folder of its own in there. */
export const SERVED = LIST.served

/** A model's folder, with its revision in the name, like `moonshine-base-b1e9b6a`. */
export function modelFolder(name: ModelName | typeof DETECTOR): string {
  const model = LIST.models[name]
  if (!model) throw new Error(`files.json has no ${name}`)
  return model.folder
}

function modelFiles(name: ModelName | typeof DETECTOR): VoiceFile[] {
  const model = LIST.models[name]
  if (!model) throw new Error(`files.json has no ${name}`)
  return Object.entries(model.files).map(([path, facts]) => ({
    url: `${SERVED}${model.folder}/${path}`,
    ...facts,
  }))
}

function runtimeFile(url: string, name: string): VoiceFile {
  const facts = LIST.runtime.files[name]
  if (!facts) throw new Error(`files.json has no ${name}`)
  return { url, ...facts }
}

/**
 * ONNX Runtime's WebAssembly for a device. With WebGPU it is the build that has the GPU in it;
 * without, the smaller CPU-only build, as Transformers.js does for older iPhones. `glue` is the
 * CPU build's own JavaScript (the GPU build's is inside the library).
 */
export function runtimeFor(device: Device): { wasm: VoiceFile; glue: string | null } {
  return device === 'webgpu'
    ? { wasm: runtimeFile(gpuWasm, 'ort-wasm-simd-threaded.asyncify.wasm'), glue: null }
    : { wasm: runtimeFile(cpuWasm, 'ort-wasm-simd-threaded.wasm'), glue: cpuGlue }
}

/** Every file a device needs for a model: the runtime, the voice detector and the model. */
export function filesFor(model: ModelName, device: Device): VoiceFile[] {
  return [runtimeFor(device).wasm, ...modelFiles(DETECTOR), ...modelFiles(model)]
}

/**
 * WebGPU first, as choice 23 says (TBC at S2). Measured on 21 Nov in Chrome on a laptop's Intel
 * graphics: Moonshine Base's 8-bit files took about 10 times longer on WebGPU than on the CPU
 * (2.5 s against 0.26 s for 2.3 s of sound). If S2 finds the same on an iPhone, make it false.
 */
export const WEBGPU_FIRST = true

/** WebGPU where the browser has a graphics adapter for it, else the CPU (choice 23). */
export async function deviceHere(): Promise<Device> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu
  if (!WEBGPU_FIRST || !gpu) return 'wasm'
  try {
    return (await gpu.requestAdapter()) ? 'webgpu' : 'wasm'
  } catch {
    return 'wasm'
  }
}

/** Every file this build lists, for any model and either runtime, by its address. */
function listed(): Map<string, VoiceFile> {
  const names = Object.keys(LIST.models) as (ModelName | typeof DETECTOR)[]
  const files = [
    ...names.flatMap((name) => modelFiles(name)),
    runtimeFor('webgpu').wasm,
    runtimeFor('wasm').wasm,
  ]
  return new Map(files.map((file) => [file.url, file]))
}

/** Our checked copy of a file, or nothing: a copy only counts with the file's listed size. */
export async function keptFile(file: VoiceFile): Promise<Response | undefined> {
  if (typeof caches === 'undefined') return undefined
  try {
    const kept = await (await caches.open(CACHE)).match(file.url)
    return kept?.headers.get(CHECKED_BYTES) === String(file.bytes) ? kept : undefined
  } catch {
    return undefined
  }
}

/** Takes a file out of both stores: ours, and the service worker's. */
async function forget(url: string): Promise<void> {
  for (const name of [CACHE, SW_ASSETS]) {
    if (await caches.has(name)) await (await caches.open(name)).delete(url)
  }
}

/** The files not kept on this device yet. */
export async function missingFiles(files: readonly VoiceFile[]): Promise<VoiceFile[]> {
  const kept = await Promise.all(files.map((file) => keptFile(file)))
  return files.filter((_, index) => !kept[index])
}

/** Whether this browser keeps every file the model needs here: then nothing downloads. */
export async function voiceIsKept({
  model = DEFAULT_MODEL,
  device,
}: { model?: ModelName; device?: Device } = {}): Promise<boolean> {
  return (await missingFiles(filesFor(model, device ?? (await deviceHere())))).length === 0
}

/** A download that gets no bytes for this long has stalled, and fails. */
const STALL_MS = 30_000

/** Downloads one file, reporting the bytes as they come. */
async function download(
  file: VoiceFile,
  onBytes: (bytes: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  const stop = new AbortController()
  let stalled = setTimeout(() => stop.abort(), STALL_MS)
  try {
    const response = await fetch(file.url, { signal: stop.signal })
    if (!response.ok || !response.body) throw new DownloadFailed(`${file.url}: ${response.status}`)
    const bytes = new Uint8Array(file.bytes)
    let got = 0
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (got + value.length > file.bytes) throw new DownloadFailed(`${file.url}: too long`)
      bytes.set(value, got)
      got += value.length
      onBytes(got)
      clearTimeout(stalled)
      stalled = setTimeout(() => stop.abort(), STALL_MS)
    }
    if (got !== file.bytes) throw new DownloadFailed(`${file.url}: cut off`)
    return bytes
  } catch (error) {
    throw error instanceof DownloadFailed
      ? error
      : new DownloadFailed(`${file.url}: ${String(error)}`)
  } finally {
    clearTimeout(stalled)
  }
}

/** The sha256 of some bytes, in hex. Only a secure page (https) can work it out. */
async function sha256Of(bytes: Uint8Array<ArrayBuffer>): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Downloads the files not kept yet, one at a time, checks each against the list, and keeps it.
 * Any failure (no network, a stall, a wrong size or sha256) is a `DownloadFailed`, and a file that
 * failed takes no place in either store, so the next try fetches it fresh. A page served as
 * index.html for a missing file fails the size.
 */
export async function keepFiles(
  files: readonly VoiceFile[],
  onProgress?: (progress: Progress) => void,
): Promise<void> {
  const missing = await missingFiles(files)
  if (missing.length === 0) return
  if (typeof caches === 'undefined') throw new DownloadFailed('this browser has no Cache Storage')
  const total = missing.reduce((sum, file) => sum + file.bytes, 0)
  const cache = await caches.open(CACHE)
  let done = 0
  onProgress?.({ loaded: 0, total })
  for (const file of missing) {
    let bytes: Uint8Array<ArrayBuffer>
    try {
      bytes = await download(file, (got) => onProgress?.({ loaded: done + got, total }))
      const sha256 = await sha256Of(bytes)
      if (sha256 !== null && sha256 !== file.sha256)
        throw new DownloadFailed(`${file.url}: checksum`)
    } catch (error) {
      await forget(file.url)
      throw error
    }
    const headers = { [CHECKED_BYTES]: String(bytes.length) }
    await cache.put(file.url, new Response(bytes, { headers }))
    // The service worker kept its own copy as the file passed: one copy, the checked one, is enough.
    if (await caches.has(SW_ASSETS)) await (await caches.open(SW_ASSETS)).delete(file.url)
    done += file.bytes
    onProgress?.({ loaded: done, total })
  }
}

/** Takes out kept files that this build no longer lists, like an older model revision. */
export async function tidyKept(): Promise<void> {
  if (typeof caches === 'undefined') return
  const current = listed()
  const cache = await caches.open(CACHE)
  for (const request of await cache.keys()) {
    if (!current.has(new URL(request.url).pathname)) await cache.delete(request)
  }
}

/**
 * Transformers.js's fetch (`env.fetch`): the kept copy of a listed file, and "not found" for
 * anything else. It never goes to the network, so the library can't reach another site, and a file
 * the model doesn't have (an optional one) is a plain 404, not our site's index.html.
 */
export async function fromKept(input: string | URL): Promise<Response> {
  const url = new URL(input, self.location.href)
  const file = url.origin === self.location.origin ? listed().get(url.pathname) : undefined
  return (file ? await keptFile(file) : undefined) ?? new Response(null, { status: 404 })
}
