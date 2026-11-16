/**
 * Makes the service worker for the build (Improvements 1, #9). The worker's own code is
 * src/pwa/sw.js, written by hand. This plugin runs when the build has finished, reads what the
 * build made, and writes dist/sw.js: that file with `const __BUILD__ = {...}` put in front.
 *
 * - `precache`: what a page needs before anything else, kept on the device when the worker installs:
 *   index.html, the manifest, the icons, and every file under /assets/ that index.html itself asks
 *   for (the main code, the framework file, the styles, the two preloaded fonts). Nothing here is
 *   guessed: it is read from the built index.html, so a change to the build changes the list.
 * - `assets`: every file under /assets/ in this build. The worker clears out any kept file that is
 *   not in this list when it takes over, so old builds' files don't pile up on the device.
 * - `version`: a hash of the content of every file in `precache`. It is part of the name of the
 *   worker's cache, and it is what makes the browser see a new worker: any change to the shell
 *   changes it, and nothing else does.
 *
 * Why not a package (vite-plugin-pwa, Workbox)? The worker is about a hundred lines whose one
 * job that matters is never to keep anything behind a sign-in, so it is easier to read and to test
 * than a configuration, and the website needs no new package for it.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Plugin } from 'vite'

export interface ServiceWorkerBuild {
  version: string
  precache: string[]
  assets: string[]
}

/** The shell's own files, besides the /assets/ files that index.html asks for. */
const SHELL_FILES = [
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
]

/**
 * The /assets/ files a page of HTML asks for, in the order it first names them, each once. A search
 * or a hash after the name ("/assets/a.js?v=1") is not part of the file.
 */
export function assetsAskedFor(html: string): string[] {
  const found = new Set<string>()
  for (const match of html.matchAll(/(?:href|src)="(\/assets\/[^"?#]+)(?:[?#][^"]*)?"/g)) {
    if (match[1]) found.add(match[1])
  }
  return [...found]
}

/** Every file under `dir`, as a website path from `base` ("/assets/x.js"), sorted, no source maps. */
export function filesUnder(dir: string, base: string): string[] {
  if (!existsSync(dir)) return []
  const found: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) found.push(...filesUnder(path, `${base}/${name}`))
    else if (!name.endsWith('.map')) found.push(`${base}/${name}`)
  }
  return found
}

/** A short hash of the content of the given files (read from `root`), in the order given. */
export function versionOf(root: string, paths: readonly string[]): string {
  const hash = createHash('sha256')
  for (const path of paths) {
    hash.update(path)
    hash.update(readFileSync(join(root, path)))
  }
  return hash.digest('hex').slice(0, 12)
}

/** What the build gives the worker, from a finished build in `dist`. */
export function describeBuild(dist: string): ServiceWorkerBuild {
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  const precache = [
    ...SHELL_FILES.filter((path) => existsSync(join(dist, path))),
    ...assetsAskedFor(html),
  ]
  return {
    version: versionOf(dist, precache),
    precache,
    assets: filesUnder(join(dist, 'assets'), '/assets'),
  }
}

/** The worker's code with the build's facts in front of it. */
export function serviceWorkerSource(code: string, build: ServiceWorkerBuild): string {
  return `const __BUILD__ = ${JSON.stringify(build)};\n${code}`
}

export function contourServiceWorker(): Plugin {
  let dist = ''
  let code = ''
  return {
    name: 'contour-service-worker',
    apply: 'build',
    configResolved(config) {
      dist = resolve(config.root, config.build.outDir)
      code = readFileSync(resolve(config.root, 'src/pwa/sw.js'), 'utf8')
    },
    closeBundle: {
      // After Vite has written index.html and the files it names.
      order: 'post',
      handler() {
        writeFileSync(join(dist, 'sw.js'), serviceWorkerSource(code, describeBuild(dist)))
      },
    },
  }
}
