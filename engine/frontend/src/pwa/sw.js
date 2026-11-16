/*
 * Contour's service worker (Improvements 1, #9: "make the website a PWA", and "there shouldn't be
 * any delay when switching things").
 *
 * What it does:
 *   - Keeps the app's shell on the device: index.html and the few files every page starts with (the
 *     main code, the styles, the two fonts, the icons). A page opens at once, on any address and
 *     with no network, and the first screen never waits for the server.
 *   - Keeps every other file of the build (the code of each page) the first time it is fetched, so
 *     the second visit to a page needs nothing from the network. Those names carry a hash, so a
 *     file never changes under its name: it is kept until a newer build no longer has it.
 *   - Lets a new version wait. A new worker installs in the background and keeps the old
 *     version's files out of harm's way. The page says "A new version is ready", and the person
 *     reloads when they choose (the page sends "skip-waiting"). No tab ever gets half of each version.
 *
 * What it never does:
 *   - It never touches /api. Every answer there is behind a sign-in (and some are a live feed), so
 *     it is never kept, and the worker doesn't even look at the request: it goes straight through.
 *   - It never keeps another site's files (the map tiles), a request that isn't a GET, or a failed
 *     answer.
 *
 * `__BUILD__` is put in front of this file by the build (vite-pwa.ts): the version, the files to
 * keep at install, and every file under /assets/ in this build (to clear the old ones out). The
 * lint settings (eslint.config.js) know it as a global, so it is not declared here.
 */

const PRECACHE = `contour-precache-${__BUILD__.version}`
const ASSETS = 'contour-assets'
const SHELL = '/index.html'

self.addEventListener('install', (event) => {
  event.waitUntil(keepTheShell())
})

/**
 * Fetches each file of the shell fresh (never from the browser's own cache, which could hold an
 * older copy) and keeps it. If one fails the install fails, and the old version carries on.
 */
async function keepTheShell() {
  const cache = await caches.open(PRECACHE)
  await Promise.all(
    __BUILD__.precache.map(async (path) => {
      const response = await fetch(new Request(path, { cache: 'reload' }))
      if (!response.ok) throw new Error(`${path} answered ${response.status}`)
      await cache.put(path, response)
    }),
  )
}

self.addEventListener('activate', (event) => {
  event.waitUntil(tidyUp())
})

/**
 * An older version's shell goes, and so does any kept file that this build no longer has. Then this
 * worker takes the open pages, so the first visit works offline too.
 */
async function tidyUp() {
  for (const name of await caches.keys()) {
    if (name.startsWith('contour-precache-') && name !== PRECACHE) await caches.delete(name)
  }
  const assets = await caches.open(ASSETS)
  const current = new Set(__BUILD__.assets)
  for (const request of await assets.keys()) {
    if (!current.has(new URL(request.url).pathname)) await assets.delete(request)
  }
  await self.clients.claim()
}

self.addEventListener('message', (event) => {
  // The page says the person chose to update: this worker takes over now.
  if (event.data && event.data.type === 'skip-waiting') void self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  // Another site's files, and the backend: through, untouched, as if there were no worker.
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return

  if (request.mode === 'navigate') {
    // Every address of the website is the same page, which draws itself from the address.
    event.respondWith(fromShell(request, SHELL))
    return
  }
  if (__BUILD__.precache.includes(url.pathname)) {
    event.respondWith(fromShell(request, url.pathname))
    return
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(keepAsYouGo(request))
  }
})

/** A file of the shell, from the device, or from the network if it somehow isn't there. */
async function fromShell(request, path) {
  const cache = await caches.open(PRECACHE)
  const kept = await cache.match(path)
  return kept || fetch(request)
}

/** A file under /assets/: from the device if kept, else from the network, and kept for next time. */
async function keepAsYouGo(request) {
  const cache = await caches.open(ASSETS)
  const kept = await cache.match(request)
  if (kept) return kept
  const response = await fetch(request)
  // Only a good answer from our own site is kept (a 404 for a file a deploy removed never is).
  if (response.ok && response.type === 'basic') await cache.put(request, response.clone())
  return response
}
