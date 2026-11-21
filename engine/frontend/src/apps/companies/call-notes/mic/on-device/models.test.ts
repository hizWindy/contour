import { env } from '@huggingface/transformers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fromKept, SERVED } from './files'
import { loadModels } from './models'

/*
  The worker's "only from our own site" rule (PLAN-V24 review). On App Platform the page's content
  policy doesn't reach the worker: a worker takes its policy from its own response, and the static
  site sends none. So `setUp` in models.ts is all that keeps the library off huggingface.co and
  jsDelivr. Transformers.js is a fake here that starts with every switch that could fetch or share
  a file turned on, as the library's defaults are or could become. Once the models load, each is
  off, and was off before the first model began to load. The files are a fake too: nothing is
  downloaded.
*/

const lib = vi.hoisted(() => {
  const libraryFetch = (_input: string | URL): Promise<Response> =>
    Promise.reject(new Error('the network'))
  /** The library's settings at their worst: everything that could reach another site is on. */
  const worst = () => ({
    allowRemoteModels: true,
    remoteHost: 'https://huggingface.co/',
    allowLocalModels: false,
    localModelPath: '/models/',
    useBrowserCache: true,
    useWasmCache: true,
    useCustomCache: true,
    experimental_useCrossOriginStorage: true,
    fetch: libraryFetch,
    logLevel: 30,
    backends: {
      onnx: {
        wasm: {
          wasmPaths: {
            mjs: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0/dist/ort-wasm-simd-threaded.asyncify.mjs',
            wasm: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0/dist/ort-wasm-simd-threaded.asyncify.wasm',
          } as unknown,
          wasmBinary: undefined as unknown,
          proxy: true,
          numThreads: 4,
        },
      },
    },
  })
  type Settings = ReturnType<typeof worst>
  const env: Settings = worst()
  /** The settings as each model began to load: the voice detector, then the speech model. */
  const atLoad: Settings[] = []
  const snapshot = (): Settings => ({
    ...env,
    backends: { onnx: { wasm: { ...env.backends.onnx.wasm } } },
  })
  return { env, worst, atLoad, snapshot, libraryFetch }
})

vi.mock('@huggingface/transformers', () => ({
  env: lib.env,
  LogLevel: { ERROR: 40 },
  Tensor: class {},
  AutoModel: {
    from_pretrained: () => {
      lib.atLoad.push(lib.snapshot())
      return Promise.resolve(() => Promise.resolve({ output: { data: [0] }, stateN: {} }))
    },
  },
  pipeline: () => {
    lib.atLoad.push(lib.snapshot())
    return Promise.resolve(() => Promise.resolve({ text: '' }))
  },
}))

/** The runtime's WebAssembly, as this device keeps it. */
const RUNTIME = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])

vi.mock('./files', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  keepFiles: () => Promise.resolve(),
  tidyKept: () => Promise.resolve(),
  keptFile: () => Promise.resolve(new Response(RUNTIME.slice())),
}))

type Wasm = (typeof lib.env)['backends']['onnx']['wasm']

/** Every address in the runtime's paths: none, or only on our own site. */
function addressesIn(wasm: Wasm): URL[] {
  const paths = wasm.wasmPaths
  const all = typeof paths === 'string' ? [paths] : Object.values(paths as Record<string, string>)
  return all.map((address) => new URL(address, self.location.href))
}

/** What must hold in the worker before any model loads, and after. */
function onlyOurOwnSite(settings: typeof lib.env): void {
  // Models: only the files this device keeps, read through our own fetch.
  expect(settings.allowRemoteModels).toBe(false)
  expect(settings.fetch).toBe(fromKept)
  expect(settings.fetch).not.toBe(lib.libraryFetch)
  expect(settings.allowLocalModels).toBe(true)
  expect(settings.localModelPath).toBe(SERVED)
  expect(SERVED.startsWith('/')).toBe(true)
  // None of the library's own stores: what it would keep, it would fetch first.
  expect(settings.useBrowserCache).toBe(false)
  expect(settings.useWasmCache).toBe(false)
  expect(settings.useCustomCache).toBe(false)
  expect(settings.experimental_useCrossOriginStorage).toBe(false)
  // The runtime: its WebAssembly is handed over, and nothing else is fetched from another site.
  const { wasm } = settings.backends.onnx
  expect(wasm.wasmBinary).toBeInstanceOf(ArrayBuffer)
  expect(new Uint8Array(wasm.wasmBinary as ArrayBuffer)).toEqual(RUNTIME)
  expect(Object.keys(wasm.wasmPaths as object)).not.toContain('wasm')
  for (const address of addressesIn(wasm)) {
    expect(address.origin).toBe(self.location.origin)
  }
  expect(JSON.stringify(wasm.wasmPaths)).not.toMatch(/jsdelivr|huggingface/)
  // No second worker of the runtime's own, which would load its code by itself.
  expect(wasm.proxy).toBe(false)
  expect(wasm.numThreads).toBe(1)
}

beforeEach(() => {
  Object.assign(lib.env, lib.worst())
  lib.atLoad.length = 0
})

describe('the worker loads its models only from our own site', () => {
  it('on the CPU: the runtime’s JavaScript comes from our site, and every other switch is off', async () => {
    const models = await loadModels('moonshine-base', 'wasm', () => undefined)

    expect(models.device).toBe('wasm')
    expect(env).toBe(lib.env)
    onlyOurOwnSite(lib.env)
    expect(addressesIn(lib.env.backends.onnx.wasm)).toHaveLength(1)
    // Set before the voice detector and the speech model began to load.
    expect(lib.atLoad).toHaveLength(2)
    for (const settings of lib.atLoad) onlyOurOwnSite(settings)
  })

  it('on the GPU: no address at all, as the runtime’s JavaScript is inside the library', async () => {
    const models = await loadModels('moonshine-base', 'webgpu', () => undefined)

    expect(models.device).toBe('webgpu')
    onlyOurOwnSite(lib.env)
    expect(lib.env.backends.onnx.wasm.wasmPaths).toEqual({})
    for (const settings of lib.atLoad) onlyOurOwnSite(settings)
  })

  it('gives the library a fetch that answers the library’s own defaults with a 404, never the network', async () => {
    const network = vi.fn(() => Promise.reject(new Error('the network')))
    vi.stubGlobal('fetch', network)
    await loadModels('moonshine-base', 'wasm', () => undefined)

    for (const address of [
      'https://huggingface.co/onnx-community/moonshine-base-ONNX/resolve/main/config.json',
      'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0/dist/ort-wasm-simd-threaded.wasm',
    ]) {
      expect((await lib.env.fetch(address)).status).toBe(404)
    }
    expect(network).not.toHaveBeenCalled()
  })
})
