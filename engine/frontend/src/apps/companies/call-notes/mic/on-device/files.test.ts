import { createHash, webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DownloadFailed, type Progress } from './engine'
import listText from './files.json?raw'
import {
  CACHE,
  CHECKED_BYTES,
  DEFAULT_MODEL,
  deviceHere,
  dtypeOf,
  filesFor,
  fromKept,
  keepFiles,
  keptFile,
  missingFiles,
  modelFolder,
  SERVED,
  SW_ASSETS,
  tidyKept,
  voiceIsKept,
  WEBGPU_FIRST,
  type VoiceFile,
} from './files'

/*
  The speech model's files on the device (PLAN-V24 T4-1): downloaded once from our own site,
  checked, kept, and read back with no network. The browser's Cache Storage is a small fake here;
  the files are a few made-up bytes.
*/

interface Kept {
  bytes: Uint8Array
  headers: [string, string][]
}

/** The browser's Cache Storage, kept in memory: each cache maps an address to bytes and headers. */
class FakeCaches {
  readonly stores = new Map<string, Map<string, Kept>>()

  private static key(request: RequestInfo | URL): string {
    const url = request instanceof Request ? request.url : String(request)
    return new URL(url, window.location.href).href
  }

  private static store(entries: Map<string, Kept>) {
    return {
      match: (request: RequestInfo | URL) => {
        const kept = entries.get(FakeCaches.key(request))
        return Promise.resolve(
          kept ? new Response(kept.bytes.slice(), { headers: kept.headers }) : undefined,
        )
      },
      put: async (request: RequestInfo | URL, response: Response) => {
        entries.set(FakeCaches.key(request), {
          bytes: new Uint8Array(await response.arrayBuffer()),
          headers: [...response.headers.entries()],
        })
      },
      keys: () => Promise.resolve([...entries.keys()].map((url) => new Request(url))),
      delete: (request: RequestInfo | URL) =>
        Promise.resolve(entries.delete(FakeCaches.key(request))),
    }
  }

  has(name: string) {
    return Promise.resolve(this.stores.has(name))
  }

  open(name: string) {
    let entries = this.stores.get(name)
    if (!entries) {
      entries = new Map()
      this.stores.set(name, entries)
    }
    return Promise.resolve(FakeCaches.store(entries))
  }

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    for (const entries of this.stores.values()) {
      const found = await FakeCaches.store(entries).match(request)
      if (found) return found
    }
    return undefined
  }

  /** The addresses (paths) kept in one cache. */
  paths(name: string): string[] {
    return [...(this.stores.get(name)?.keys() ?? [])].map((url) => new URL(url).pathname)
  }
}

const bytesOf = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text)
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/** A made-up file on our site, and its listed facts. */
function served(url: string, text: string): { file: VoiceFile; bytes: Uint8Array<ArrayBuffer> } {
  const bytes = bytesOf(text)
  return { file: { url, bytes: bytes.length, sha256: sha256(bytes) }, bytes }
}

const INDEX_HTML = bytesOf('<!doctype html><title>Contour</title>')

/**
 * Our site, answering what `pages` holds: every request that reaches it is kept in `asked`. Like
 * App Platform, an address with no file gets index.html with a 200. In front of it, like
 * src/pwa/sw.js, the service worker answers /assets/ files from its store when it has them, and
 * keeps each good answer from the site as it passes, unchecked.
 */
function site(pages: Record<string, Uint8Array<ArrayBuffer>>) {
  const asked: { url: string; method: string; body: unknown }[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    const worker = url.startsWith('/assets/') ? await caches.open(SW_ASSETS) : null
    const kept = await worker?.match(url)
    if (kept) return kept
    asked.push({ url, method: init?.method ?? 'GET', body: init?.body })
    const answer = new Response(pages[url] ?? INDEX_HTML)
    await worker?.put(url, answer.clone())
    return answer
  })
  vi.stubGlobal('fetch', fetch)
  return { fetch, asked }
}

/** A copy in our store, as keepFiles leaves one once it has passed its check. */
async function keepChecked(url: string, bytes: Uint8Array<ArrayBuffer>, size = bytes.length) {
  const headers = { [CHECKED_BYTES]: String(size) }
  await (await caches.open(CACHE)).put(url, new Response(bytes, { headers }))
}

let caches: FakeCaches

beforeEach(() => {
  caches = new FakeCaches()
  vi.stubGlobal('caches', caches)
  vi.stubGlobal('crypto', webcrypto)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the files a device needs', () => {
  it('are the runtime for the device, the voice detector and the model, all from our own site', () => {
    const cpu = filesFor('moonshine-base', 'wasm')
    const gpu = filesFor('moonshine-base', 'webgpu')

    for (const file of [...cpu, ...gpu]) {
      expect(file.url.startsWith('/')).toBe(true)
      expect(file.bytes).toBeGreaterThan(0)
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(cpu[0]?.url).toContain('ort-wasm-simd-threaded.wasm')
    expect(gpu[0]?.url).toContain('ort-wasm-simd-threaded.asyncify.wasm')
    expect(cpu.some((file) => file.url.startsWith(`${SERVED}${modelFolder('silero-vad')}/`))).toBe(
      true,
    )
    expect(cpu.some((file) => file.url.endsWith('/onnx/encoder_model_quantized.onnx'))).toBe(true)
    expect(cpu.some((file) => file.url.endsWith('/onnx/decoder_model_merged_quantized.onnx'))).toBe(
      true,
    )
  })

  it('run on WebGPU where the browser has an adapter for it, else on the CPU', async () => {
    expect(await deviceHere()).toBe('wasm')

    const gpu = { requestAdapter: vi.fn<() => Promise<unknown>>(() => Promise.resolve({})) }
    Object.defineProperty(navigator, 'gpu', { value: gpu, configurable: true })
    expect(await deviceHere()).toBe(WEBGPU_FIRST ? 'webgpu' : 'wasm')

    gpu.requestAdapter.mockResolvedValue(null)
    expect(await deviceHere()).toBe('wasm')
    Reflect.deleteProperty(navigator, 'gpu')
  })

  it("leave the bigger GPU files to S2's page: the app's build never fetches them", () => {
    const list = JSON.parse(listText) as { models: Record<string, { for: string }> }
    expect(list.models['moonshine-base-full']?.for).toBe('s2')
    expect(list.models['whisper-base-en']?.for).toBe('s2')
    expect(dtypeOf('moonshine-base')).toEqual({ encoder_model: 'q8', decoder_model_merged: 'q8' })
    expect(dtypeOf('moonshine-base-full')).toEqual({
      encoder_model: 'fp32',
      decoder_model_merged: 'q4',
    })
    const full = filesFor('moonshine-base-full', 'webgpu').map((file) => file.url)
    expect(full.some((url) => url.endsWith('/onnx/encoder_model.onnx'))).toBe(true)
    expect(full.some((url) => url.endsWith('/onnx/decoder_model_merged_q4.onnx'))).toBe(true)
  })

  it('are at a fixed revision, named in the folder', () => {
    expect(modelFolder('moonshine-base')).toBe('moonshine-base-b1e9b6a')
    expect(modelFolder('moonshine-tiny')).toBe('moonshine-tiny-a6da124')
    expect(modelFolder('silero-vad')).toBe('silero-vad-e71cae9')
  })
})

describe('keepFiles', () => {
  it('downloads what is missing once, checks it and keeps it: a second visit downloads nothing', async () => {
    const one = served('/voice/model-1/config.json', '{"model_type":"moonshine"}')
    const two = served('/voice/model-1/onnx/model.onnx', 'weights '.repeat(500))
    const { asked } = site({ [one.file.url]: one.bytes, [two.file.url]: two.bytes })
    const progress: Progress[] = []

    await keepFiles([one.file, two.file], (step) => progress.push(step))

    expect(asked.map((request) => request.url)).toEqual([one.file.url, two.file.url])
    expect(caches.paths(CACHE)).toEqual([one.file.url, two.file.url])
    expect(progress.at(-1)).toEqual({
      loaded: one.file.bytes + two.file.bytes,
      total: one.file.bytes + two.file.bytes,
    })
    expect(await missingFiles([one.file, two.file])).toEqual([])

    await keepFiles([one.file, two.file])
    expect(asked).toHaveLength(2)
    expect(new TextDecoder().decode(await (await keptFile(one.file))?.arrayBuffer())).toBe(
      '{"model_type":"moonshine"}',
    )
  })

  it('fails on a wrong checksum, and keeps nothing of that file', async () => {
    const good = served('/voice/model-1/onnx/model.onnx', 'the real weights')
    site({ [good.file.url]: bytesOf('the fake weights') })

    await expect(keepFiles([good.file])).rejects.toBeInstanceOf(DownloadFailed)
    expect(caches.paths(CACHE)).toEqual([])
  })

  it("takes a runtime file that failed its check out of the service worker's store too", async () => {
    const runtime = served('/assets/ort-wasm-simd-threaded-abc123.wasm', 'the real runtime')
    const { asked } = site({ [runtime.file.url]: bytesOf('the fake runtime') })

    await expect(keepFiles([runtime.file])).rejects.toBeInstanceOf(DownloadFailed)

    // The service worker kept the fake as it passed; the failed check took it out again.
    expect(asked).toHaveLength(1)
    expect(caches.paths(SW_ASSETS)).toEqual([])
    expect(caches.paths(CACHE)).toEqual([])
  })

  it("fails when our site answers with its index.html, as it does for a file it hasn't got", async () => {
    const missing = served('/voice/model-1/onnx/model.onnx', 'weights '.repeat(1000))
    site({})

    await expect(keepFiles([missing.file])).rejects.toBeInstanceOf(DownloadFailed)
    expect(caches.paths(CACHE)).toEqual([])
  })

  it('fails a download that stalls, after half a minute with no bytes', async () => {
    vi.useFakeTimers()
    const file = served('/voice/model-1/onnx/model.onnx', 'weights')
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')))
          },
        })
        return Promise.resolve(new Response(body))
      }),
    )

    const keeping = keepFiles([file.file])
    const failed = expect(keeping).rejects.toBeInstanceOf(DownloadFailed)
    await vi.advanceTimersByTimeAsync(30_000)
    await failed
  })

  it("never counts the service worker's unchecked copy: a bad one goes from both stores", async () => {
    const runtime = served('/assets/ort-wasm-simd-threaded-abc123.wasm', 'wasm bytes')
    // The service worker kept our site's index.html under the runtime's name, with a 200.
    await (await caches.open(SW_ASSETS)).put(runtime.file.url, new Response(INDEX_HTML))
    const { asked } = site({ [runtime.file.url]: runtime.bytes })

    expect(await missingFiles([runtime.file])).toEqual([runtime.file])
    await expect(keepFiles([runtime.file])).rejects.toBeInstanceOf(DownloadFailed)
    expect(asked).toEqual([])
    expect(caches.paths(SW_ASSETS)).toEqual([])
    expect(await missingFiles([runtime.file])).toEqual([runtime.file])

    // The next try reaches the site, and keeps one copy: ours, checked.
    await keepFiles([runtime.file])
    expect(asked).toHaveLength(1)
    expect(caches.paths(CACHE)).toEqual([runtime.file.url])
    expect(caches.paths(SW_ASSETS)).toEqual([])
    expect(await missingFiles([runtime.file])).toEqual([])
  })

  it('counts a kept copy only when its checked size is the listed one', async () => {
    const file = served('/voice/model-1/onnx/model.onnx', 'weights')
    await (await caches.open(CACHE)).put(file.file.url, new Response(file.bytes))
    expect(await missingFiles([file.file])).toEqual([file.file])

    await keepChecked(file.file.url, file.bytes, file.bytes.length + 1)
    expect(await missingFiles([file.file])).toEqual([file.file])

    await keepChecked(file.file.url, file.bytes)
    expect(await missingFiles([file.file])).toEqual([])
  })

  it('only ever asks our own site for listed files, with plain GETs that carry nothing', async () => {
    const one = served('/voice/model-1/config.json', '{}')
    const { asked } = site({ [one.file.url]: one.bytes })

    await keepFiles([one.file])

    expect(asked).toEqual([{ url: one.file.url, method: 'GET', body: undefined }])
  })
})

describe('fromKept, the fetch Transformers.js gets', () => {
  const listed = `${SERVED}${modelFolder('moonshine-base')}/config.json`

  it('gives a kept listed file with no request', async () => {
    const { fetch } = site({})
    const config = filesFor(DEFAULT_MODEL, 'wasm').find((file) => file.url === listed)
    await keepChecked(listed, bytesOf('{"kept":true}'), config?.bytes)

    const response = await fromKept(listed)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('{"kept":true}')
    expect(fetch).not.toHaveBeenCalled()
  })

  it("is a 404 for a file that isn't kept, isn't listed, or is on another site: never the network", async () => {
    const { fetch } = site({})
    // A copy that isn't checked doesn't count either.
    await (await caches.open(CACHE)).put(listed, new Response(bytesOf('{}')))

    for (const address of [
      listed,
      `${SERVED}${modelFolder('moonshine-base')}/processor_config.json`,
      'https://huggingface.co/onnx-community/moonshine-base-ONNX/resolve/main/config.json',
    ]) {
      expect((await fromKept(address)).status).toBe(404)
    }
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('voiceIsKept', () => {
  it('is true once every file the model needs here is kept, so a second visit downloads nothing', async () => {
    const [runtime, ...rest] = filesFor(DEFAULT_MODEL, 'wasm')
    if (!runtime) throw new Error('no runtime')
    for (const file of rest) await keepChecked(file.url, bytesOf('kept'), file.bytes)
    expect(await voiceIsKept({ device: 'wasm' })).toBe(false)

    // The service worker's copy of the runtime, unchecked, doesn't count.
    await (await caches.open(SW_ASSETS)).put(runtime.url, new Response(bytesOf('kept')))
    expect(await voiceIsKept({ device: 'wasm' })).toBe(false)

    await keepChecked(runtime.url, bytesOf('kept'), runtime.bytes)
    expect(await voiceIsKept({ device: 'wasm' })).toBe(true)
    // The GPU's runtime is another file: a device with WebGPU would still download it.
    expect(await voiceIsKept({ device: 'webgpu' })).toBe(false)
  })
})

describe('tidyKept', () => {
  it('takes out kept files this build no longer lists, like an older revision', async () => {
    const cache = await caches.open(CACHE)
    const current = `${SERVED}${modelFolder('moonshine-base')}/config.json`
    await cache.put(current, new Response(bytesOf('{}')))
    await cache.put('/voice/moonshine-base-0000000/config.json', new Response(bytesOf('{}')))

    await tidyKept()

    expect(caches.paths(CACHE)).toEqual([current])
  })
})
