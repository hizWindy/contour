import { describe, expect, it } from 'vitest'
import config from '../../vite.config'

/*
  Guards the dev server settings that matter for safety and for the run feed.
  The unbuffered stream was also checked for real (26 Oct 2026, Vite 8.3.5): a fake backend sent
  one event every 400 ms, and they reached a client one by one through both `vite` and
  `vite preview`, with the backend asked for `accept-encoding: identity`. Repeat that by hand
  after a Vite upgrade, because a unit test cannot see buffering.
*/
describe('vite.config.ts', () => {
  const server = config.server
  const preview = config.preview

  it('serves on 5173 and refuses another port, because the backend allows only origins on that port', () => {
    expect(server?.port).toBe(5173)
    expect(server?.strictPort).toBe(true)
    expect(preview?.port).toBe(5173)
    expect(preview?.strictPort).toBe(true)
  })

  it('listens on localhost only and does not turn off the host check', () => {
    for (const settings of [server, preview]) {
      expect(settings).not.toHaveProperty('host')
      expect(settings).not.toHaveProperty('allowedHosts')
    }
  })

  it('proxies /api to the backend on 127.0.0.1:8000 by default, with no timeout on streams', () => {
    const proxy = server?.proxy?.['/api']

    expect(typeof proxy).toBe('object')
    if (typeof proxy !== 'object') return
    expect(proxy.target).toBe(process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8000')
    expect(proxy.timeout).toBe(0)
    expect(proxy.proxyTimeout).toBe(0)
    expect(typeof proxy.configure).toBe('function')
    expect(preview?.proxy).toBe(server?.proxy)
  })

  it('keeps every asset a file, so the CSP never meets a data: font', () => {
    expect(config.build?.assetsInlineLimit).toBe(0)
  })

  it('pre-bundles the libraries only lazy pages use, so a page never meets "Outdated Optimize Dep"', () => {
    expect(config.optimizeDeps?.include).toEqual(
      expect.arrayContaining([
        'leaflet',
        'react-leaflet',
        'react-day-picker',
        'react-resizable-panels',
        'recharts',
      ]),
    )
  })

  it('sends frame-ancestors as a real header', () => {
    expect(server?.headers?.['Content-Security-Policy']).toBe("frame-ancestors 'none'")
    expect(server?.headers?.['X-Frame-Options']).toBe('DENY')
  })
})
