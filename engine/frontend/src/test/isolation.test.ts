import { describe, expect, it, vi } from 'vitest'

/*
  vite.config.ts sets restoreMocks, unstubGlobals and unstubEnvs, so what a test replaces is put
  back before the next one. Each pair below is two tests that run in order: the first replaces
  something and does not clean up, the second checks that it is back. If one of those options is
  switched off, the second test of its pair fails.
*/
describe('nothing a test replaces leaks into the next test', () => {
  const realFetch = globalThis.fetch
  const realWarn = console.warn

  it('stubs a global, an environment variable and a method', () => {
    vi.stubGlobal('fetch', vi.fn())
    vi.stubEnv('FP_ISOLATION_PROBE', 'leaked')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(globalThis.fetch).not.toBe(realFetch)
    expect(import.meta.env.FP_ISOLATION_PROBE).toBe('leaked')
    expect(vi.isMockFunction(console.warn)).toBe(true)
  })

  it('sees the real global again (unstubGlobals)', () => {
    expect(globalThis.fetch).toBe(realFetch)
  })

  it('sees the environment variable gone again (unstubEnvs)', () => {
    expect(import.meta.env.FP_ISOLATION_PROBE).toBeUndefined()
    expect(process.env.FP_ISOLATION_PROBE).toBeUndefined()
  })

  it('sees the real method again (restoreMocks)', () => {
    expect(vi.isMockFunction(console.warn)).toBe(false)
    expect(console.warn).toBe(realWarn)
  })
})
