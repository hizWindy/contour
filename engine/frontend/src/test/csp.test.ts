import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const html = readFileSync(join(import.meta.dirname, '..', '..', 'index.html'), 'utf8')
const caddyfile = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'deploy', 'Caddyfile'),
  'utf8',
)

function parse(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(';')
      .map((part) => part.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...values]) => [name ?? '', values]),
  )
}

function directives(): Map<string, string[]> {
  const meta = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html)
  const policy = meta?.[1]
  if (!policy) {
    throw new Error('index.html has no Content-Security-Policy meta tag')
  }
  return parse(policy)
}

describe('index.html', () => {
  it('carries the Content-Security-Policy from the spec', () => {
    const policy = directives()

    expect(policy.get('default-src')).toEqual(["'self'"])
    // The speech model (PLAN-V24 T4-1) compiles WebAssembly, but no script is built from text.
    expect(policy.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"])
    expect(policy.get('style-src')).toEqual(["'self'", "'unsafe-inline'"])
    expect(policy.get('img-src')).toEqual(["'self'", 'data:', 'https://tile.openstreetmap.org'])
    expect(policy.get('connect-src')).toEqual(["'self'"])
    // Its worker comes from our own site only: no blob: or data: worker, and no other site.
    expect(policy.get('worker-src')).toEqual(["'self'"])
    expect(policy.get('base-uri')).toEqual(["'none'"])
    expect(policy.get('object-src')).toEqual(["'none'"])
  })

  it("is the Caddyfile's policy, less the two a meta tag can't carry", () => {
    const header = /Content-Security-Policy "([^"]*)"/.exec(caddyfile)?.[1]
    if (!header) throw new Error('the Caddyfile has no Content-Security-Policy header')
    const fromCaddy = parse(header)

    expect(fromCaddy.get('frame-ancestors')).toEqual(["'none'"])
    expect(fromCaddy.get('form-action')).toEqual(["'self'"])
    fromCaddy.delete('frame-ancestors')
    fromCaddy.delete('form-action')
    expect(fromCaddy).toEqual(directives())
  })

  it('allows no inline or eval script', () => {
    const scripts = directives().get('script-src') ?? []

    expect(scripts).not.toContain("'unsafe-inline'")
    expect(scripts).not.toContain("'unsafe-eval'")
  })

  it("keeps live voice's socket on our own host: 'self' only, never a bare wss: (PLAN-V28 T2-3)", () => {
    // The socket opens on the page's own host (ws: for http:, wss: for https:). Chrome, Edge,
    // Firefox and Safari 16 or later (WebKit, Sept 2022) count that as 'self'; an older Safari
    // refuses it, and the free mic takes over. A bare `wss:` would let a script open a socket to
    // any host, so it never goes in.
    const connect = directives().get('connect-src') ?? []

    expect(connect).toEqual(["'self'"])
    expect(connect).not.toContain('wss:')
    expect(connect).not.toContain('ws:')
  })

  it('leaves frame-ancestors to a header, because a meta tag ignores it', () => {
    expect(directives().has('frame-ancestors')).toBe(false)
  })

  it('has a language, opens light, has the title "Contour" and no em dash', () => {
    expect(html).toMatch(/<html lang="en" data-theme="light">/)
    expect(html).toMatch(/<title>Contour<\/title>/)
    expect(html).not.toContain('\u2014')
  })

  it('has no inline script', () => {
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((match) => match[0])

    expect(scripts.length).toBeGreaterThan(0)
    for (const tag of scripts) {
      expect(tag).toMatch(/\ssrc="/)
    }
  })
})
