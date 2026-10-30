import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const html = readFileSync(join(import.meta.dirname, '..', '..', 'index.html'), 'utf8')

function directives(): Map<string, string[]> {
  const meta = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html)
  const policy = meta?.[1]
  if (!policy) {
    throw new Error('index.html has no Content-Security-Policy meta tag')
  }
  return new Map(
    policy
      .split(';')
      .map((part) => part.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...values]) => [name ?? '', values]),
  )
}

describe('index.html', () => {
  it('carries the Content-Security-Policy from the spec', () => {
    const policy = directives()

    expect(policy.get('default-src')).toEqual(["'self'"])
    expect(policy.get('script-src')).toEqual(["'self'"])
    expect(policy.get('style-src')).toEqual(["'self'", "'unsafe-inline'"])
    expect(policy.get('img-src')).toEqual(["'self'", 'data:', 'https://tile.openstreetmap.org'])
    expect(policy.get('connect-src')).toEqual(["'self'"])
    expect(policy.get('base-uri')).toEqual(["'none'"])
    expect(policy.get('object-src')).toEqual(["'none'"])
  })

  it('allows no inline or eval script', () => {
    const scripts = directives().get('script-src') ?? []

    expect(scripts).not.toContain("'unsafe-inline'")
    expect(scripts).not.toContain("'unsafe-eval'")
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
