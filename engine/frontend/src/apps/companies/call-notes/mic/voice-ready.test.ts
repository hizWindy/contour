import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Progress } from './on-device/engine'
import type { VoiceToolEvents } from './voice-tool'

/*
  The model's download and load, shared by the voice bar, the mic card and the profile menu's "Get
  voice ready" (PLAN-V24 T4-3, choice 25). The model's code is made up here: a browser that keeps
  what it downloads, in memory, and a model that loads at once. A fresh copy of the module is a
  fresh visit to the page; what the browser keeps stays.
*/

const BYTES = 83_000_000

const device = vi.hoisted(() => ({
  /** This browser keeps the model's files: they were downloaded on an earlier visit. */
  kept: false,
  /** The next download fails. */
  offline: false,
  /** The model won't load on this device. */
  wontLoad: false,
  downloads: 0,
  loads: 0,
}))

vi.mock('./on-device/tool', () => ({
  voiceMissing: () => Promise.resolve(device.kept ? 0 : BYTES),
  downloadVoice: (onProgress?: (progress: Progress) => void) => {
    if (device.kept) return Promise.resolve()
    device.downloads += 1
    if (device.offline)
      return Promise.reject(Object.assign(new Error('offline'), { why: 'download' }))
    for (const loaded of [0, 41_000_000, BYTES]) onProgress?.({ loaded, total: BYTES })
    device.kept = true
    return Promise.resolve()
  },
  prepareVoice: () => {
    device.loads += 1
    return device.wontLoad
      ? Promise.reject(Object.assign(new Error('no model'), { why: 'load' }))
      : Promise.resolve('wasm')
  },
  onDeviceModel: () => ({
    start: () => undefined,
    stop: () => undefined,
    abort: () => undefined,
    nameCase: 'any',
  }),
}))

/** A fresh visit to the page: its own state starts again, and the browser keeps what it kept. */
async function visit() {
  vi.resetModules()
  return import('./voice-ready')
}

const noEvents = {} as VoiceToolEvents

beforeEach(() => {
  Object.assign(device, { kept: false, offline: false, wontLoad: false, downloads: 0, loads: 0 })
})

describe('getting the model ready (PLAN-V24 T4-3, choice 25)', () => {
  it('a first visit downloads it once, with its progress, then loads it', async () => {
    const ready = await visit()
    await ready.lookAtVoice()
    expect(ready.voiceReadyNow()).toEqual({ state: 'missing', bytes: BYTES })
    const seen: Progress[] = []
    const make = await ready.getVoiceReady((progress) => seen.push(progress))
    expect(seen.map((progress) => progress.loaded)).toEqual([0, 41_000_000, BYTES])
    expect(device).toMatchObject({ downloads: 1, loads: 1 })
    expect(ready.voiceReadyNow()).toEqual({ state: 'kept' })
    // Loaded on this page: the next Speak doesn't wait. Its tool writes names in any case.
    expect(ready.loadedVoice()).toBe(make)
    expect(make(noEvents).nameCase).toBe('any')
  })

  it('a second visit downloads nothing: the browser kept the files', async () => {
    const first = await visit()
    await first.getVoiceReady()
    const second = await visit()
    expect(second.loadedVoice()).toBeNull()
    await second.lookAtVoice()
    expect(second.voiceReadyNow()).toEqual({ state: 'kept' })
    const seen: Progress[] = []
    await second.getVoiceReady((progress) => seen.push(progress))
    expect(seen).toEqual([])
    expect(device.downloads).toBe(1)
    // Each visit loads the model from the kept files.
    expect(device.loads).toBe(2)
  })

  it('downloads once however many ask: the idle download, the menu’s and Speak’s join', async () => {
    const ready = await visit()
    await Promise.all([ready.fetchVoice(), ready.fetchVoice(), ready.getVoiceReady()])
    expect(device.downloads).toBe(1)
  })

  it('"Get voice ready" downloads without loading the model', async () => {
    const ready = await visit()
    await ready.fetchVoice()
    expect(device).toMatchObject({ downloads: 1, loads: 0 })
    expect(ready.voiceReadyNow()).toEqual({ state: 'kept' })
    expect(ready.loadedVoice()).toBeNull()
  })

  it('a failed download says why, and the next try downloads again', async () => {
    device.offline = true
    const ready = await visit()
    const error = await ready.getVoiceReady().catch((failed: unknown) => failed)
    expect(ready.whyNotReady(error)).toBe('download')
    expect(ready.voiceReadyNow()).toEqual({ state: 'failed' })
    expect(device.loads).toBe(0)
    device.offline = false
    await ready.getVoiceReady()
    expect(ready.voiceReadyNow()).toEqual({ state: 'kept' })
    expect(device.downloads).toBe(2)
  })

  it('a model that won’t load says so, and its files stay kept', async () => {
    device.wontLoad = true
    const ready = await visit()
    const error = await ready.getVoiceReady().catch((failed: unknown) => failed)
    expect(ready.whyNotReady(error)).toBe('load')
    expect(ready.voiceReadyNow()).toEqual({ state: 'kept' })
    expect(ready.loadedVoice()).toBeNull()
  })
})
