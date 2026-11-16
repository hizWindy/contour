import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assetsAskedFor,
  describeBuild,
  filesUnder,
  serviceWorkerSource,
  versionOf,
} from '../../vite-pwa.ts'

/*
  The plugin that writes the service worker at the end of a build (Improvements 1, #9): what it
  reads from a finished build, and what it hands the worker.
*/

const temporary: string[] = []
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A small finished build: index.html asking for three files, one more page, and the shell. */
function aBuild(): string {
  const dist = mkdtempSync(join(tmpdir(), 'contour-dist-'))
  temporary.push(dist)
  mkdirSync(join(dist, 'assets'))
  mkdirSync(join(dist, 'icons'))
  writeFileSync(
    join(dist, 'index.html'),
    '<link rel="modulepreload" href="/assets/framework-a.js"><script type="module" src="/assets/index-b.js"></script><link rel="stylesheet" href="/assets/index-c.css"><link rel="icon" href="/favicon.svg">',
  )
  for (const name of [
    'framework-a.js',
    'index-b.js',
    'index-c.css',
    'page-d.js',
    'page-d.js.map',
  ]) {
    writeFileSync(join(dist, 'assets', name), name)
  }
  writeFileSync(join(dist, 'manifest.webmanifest'), '{}')
  writeFileSync(join(dist, 'favicon.svg'), '<svg/>')
  writeFileSync(join(dist, 'icons', 'icon-192.png'), 'png')
  return dist
}

describe('reading a build', () => {
  it('reads the files a page asks for from its HTML, each once, in order, without a search or hash', () => {
    expect(
      assetsAskedFor(
        '<script src="/assets/a.js?v=1"></script><link href="/assets/b.css#top"><link href="/assets/a.js"><img src="/other/x.png"><a href="https://example.com/assets/z.js">',
      ),
    ).toEqual(['/assets/a.js', '/assets/b.css'])
  })

  it('lists every file under a folder as a website path, sorted, without source maps', () => {
    const dist = aBuild()
    expect(filesUnder(join(dist, 'assets'), '/assets')).toEqual([
      '/assets/framework-a.js',
      '/assets/index-b.js',
      '/assets/index-c.css',
      '/assets/page-d.js',
    ])
    expect(filesUnder(join(dist, 'nope'), '/nope')).toEqual([])
  })

  it('keeps what the first screen needs, lists every file for the tidy-up, and stamps a version', () => {
    const dist = aBuild()
    const build = describeBuild(dist)
    // The shell's own files that this build has, then what index.html asks for. No page-d: it is
    // kept the first time someone opens that page.
    expect(build.precache).toEqual([
      '/index.html',
      '/manifest.webmanifest',
      '/favicon.svg',
      '/icons/icon-192.png',
      '/assets/framework-a.js',
      '/assets/index-b.js',
      '/assets/index-c.css',
    ])
    expect(build.assets).toContain('/assets/page-d.js')
    expect(build.assets).toHaveLength(4)
    expect(build.version).toMatch(/^[0-9a-f]{12}$/)
  })

  it('changes its version when a file of the shell changes, and only then', () => {
    const dist = aBuild()
    const before = describeBuild(dist).version
    // A page that is not in the shell changes: the version, and so the update notice, stays.
    writeFileSync(join(dist, 'assets', 'page-d.js'), 'changed')
    expect(describeBuild(dist).version).toBe(before)
    writeFileSync(join(dist, 'assets', 'index-b.js'), 'changed')
    expect(describeBuild(dist).version).not.toBe(before)
    expect(versionOf(dist, ['/favicon.svg'])).toMatch(/^[0-9a-f]{12}$/)
  })
})

describe('writing the worker', () => {
  it('puts the build in front of the worker, as plain data the worker reads as __BUILD__', () => {
    const source = serviceWorkerSource('self.noop()', {
      version: 'abc',
      precache: ['/x'],
      assets: [],
    })
    expect(source).toBe(
      'const __BUILD__ = {"version":"abc","precache":["/x"],"assets":[]};\nself.noop()',
    )
  })
})
