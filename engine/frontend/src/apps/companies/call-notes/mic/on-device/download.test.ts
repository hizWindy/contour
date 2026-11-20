import { describe, expect, it, vi } from 'vitest'
import { CHECKED_BYTES, DEFAULT_MODEL, filesFor, type VoiceFile } from './files'
import { downloadVoice, voiceMissing, VoiceNotReady } from './tool'

/*
  The download alone (PLAN-V24 T4-3, choice 25): what "Get voice ready" and a laptop's idle moment
  run, with no worker and no model loaded. The browser's Cache Storage is a small fake that says
  which listed files it keeps, as files.ts keeps them (with their checked size). jsdom has no
  WebGPU, so the files are the CPU's. Nothing is really downloaded.
*/

const FILES: readonly VoiceFile[] = filesFor(DEFAULT_MODEL, 'wasm')
const ALL_BYTES = FILES.reduce((sum, file) => sum + file.bytes, 0)

/** A browser whose Cache Storage keeps these files, and a network that is down. */
function browserKeeping(kept: readonly VoiceFile[]) {
  const store = new Map(kept.map((file) => [file.url, file.bytes]))
  const cache = {
    match: (url: string) => {
      const bytes = store.get(url)
      return Promise.resolve(
        bytes === undefined
          ? undefined
          : new Response(null, { headers: { [CHECKED_BYTES]: String(bytes) } }),
      )
    },
    put: () => Promise.resolve(),
    delete: (url: string) => Promise.resolve(store.delete(url)),
  }
  vi.stubGlobal('caches', { open: () => Promise.resolve(cache), has: () => Promise.resolve(true) })
  const fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
  vi.stubGlobal('fetch', fetch)
  return { fetch }
}

describe('the download alone (PLAN-V24 T4-3)', () => {
  it('a second visit, with every file kept, downloads nothing and reports no progress', async () => {
    const { fetch } = browserKeeping(FILES)
    expect(await voiceMissing()).toBe(0)
    const progress = vi.fn()
    await downloadVoice(progress)
    expect(fetch).not.toHaveBeenCalled()
    expect(progress).not.toHaveBeenCalled()
  })

  it('a first visit has the whole model to download', async () => {
    browserKeeping([])
    expect(await voiceMissing()).toBe(ALL_BYTES)
    // About 83 MB on the CPU, the model, the voice detector and the runtime (T4-1's Log).
    expect(Math.round(ALL_BYTES / 1_000_000)).toBe(83)
  })

  it('counts only what is still missing', async () => {
    const [runtime, ...rest] = FILES
    browserKeeping(runtime ? [runtime] : [])
    expect(await voiceMissing()).toBe(rest.reduce((sum, file) => sum + file.bytes, 0))
  })

  it('a download with no network fails as a download, so the words say to check the connection', async () => {
    browserKeeping([])
    const error = await downloadVoice().catch((failed: unknown) => failed)
    expect(error).toBeInstanceOf(VoiceNotReady)
    expect((error as VoiceNotReady).why).toBe('download')
  })
})
