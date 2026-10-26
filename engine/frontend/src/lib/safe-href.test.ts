import { describe, expect, it } from 'vitest'
import { hostOf, safeHref, websiteHref } from './safe-href'

describe('safeHref', () => {
  it('lets a plain http or https address through', () => {
    expect(safeHref('https://www.afr.com/property/office')).toBe(
      'https://www.afr.com/property/office',
    )
    expect(safeHref('http://example.com')).toBe('http://example.com/')
    expect(safeHref('HTTPS://Example.COM/A?b=c#d')).toBe('https://example.com/A?b=c#d')
  })

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'jav\tascript:alert(1)',
    ' javascript:alert(1)',
    'javascript://example.com/%0Aalert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'ftp://example.com/file',
    'blob:https://example.com/uuid',
    'mailto:a@b.com',
    'tel:+61400000000',
  ])('refuses %s', (value) => {
    expect(safeHref(value)).toBeNull()
  })

  it('refuses addresses that are not whole, absolute web addresses', () => {
    for (const value of [
      '',
      '//example.com/x',
      '/relative/path',
      'example.com',
      'https://',
      'not a url',
    ]) {
      expect(safeHref(value), value).toBeNull()
    }
  })

  it('refuses a user name or password in the address', () => {
    expect(safeHref('https://user:pass@example.com/')).toBeNull()
    expect(safeHref('https://user@example.com/')).toBeNull()
  })

  it('refuses spaces and control characters, which can smuggle a second address', () => {
    expect(safeHref('https://example.com/a b')).toBeNull()
    expect(safeHref('https://example.com/\n')).toBeNull()
    expect(safeHref('https://example.com/\u0000')).toBeNull()
    expect(safeHref('https://example.com/\u007f')).toBeNull()
    expect(safeHref('https://example.com/\u0085')).toBeNull()
    expect(safeHref('https://example.com/ ')).toBeNull()
  })

  it('refuses more than 500 characters', () => {
    const long = `https://example.com/${'a'.repeat(480)}`
    expect(long.length).toBe(500)
    expect(safeHref(long)).toBe(long)
    expect(safeHref(`${long}a`)).toBeNull()
  })

  it('refuses a value that is not text', () => {
    expect(safeHref(null)).toBeNull()
    expect(safeHref(undefined)).toBeNull()
    expect(safeHref(42)).toBeNull()
    expect(safeHref({ toString: () => 'https://example.com' })).toBeNull()
  })
})

describe('hostOf', () => {
  it('gives the host without www', () => {
    expect(hostOf('https://www.afr.com/a/b')).toBe('afr.com')
    expect(hostOf('https://news.example.com.au/x')).toBe('news.example.com.au')
  })

  it('keeps an internationalised name in its xn-- form', () => {
    expect(hostOf('https://bücher.example/')).toBe('xn--bcher-kva.example')
  })

  it('gives null for an unsafe link', () => {
    expect(hostOf('javascript:alert(1)')).toBeNull()
    expect(hostOf(null)).toBeNull()
  })
})

describe('websiteHref', () => {
  it('builds an https address from a bare domain', () => {
    expect(websiteHref('acme.com.au')).toBe('https://acme.com.au/')
    expect(websiteHref('Sub-Domain.Example.co')).toBe('https://sub-domain.example.co/')
  })

  it.each([
    'javascript:alert(1)',
    'https://acme.com',
    'acme.com/path',
    'acme',
    'a b.com',
    '-bad.com',
    'bad-.com',
    'acme.com:8080',
    'user@acme.com',
    '<img src=x onerror=alert(1)>',
    '',
  ])('refuses %s', (value) => {
    expect(websiteHref(value)).toBeNull()
  })

  it('refuses a domain over 100 characters', () => {
    expect(websiteHref(`${'a'.repeat(60)}.${'b'.repeat(60)}.com`)).toBeNull()
  })

  it('refuses a value that is not text', () => {
    expect(websiteHref(null)).toBeNull()
    expect(websiteHref(12)).toBeNull()
  })
})
