import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

/*
  The service worker (Improvements 1, #9), run for real in a small made-up worker scope: the real
  file, with fake caches and a fake network. What matters most is what it never does: it never
  touches /api, another site, a write, or a failed answer. The end-to-end run (a real Chrome, an
  install, offline, an update) was done by hand and is in the plan's log.
*/

const code = readFileSync(join(import.meta.dirname, 'sw.js'), 'utf8')
const ORIGIN = 'https://contour.test'

interface Build {
  version: string
  precache: string[]
  assets: string[]
}

const BUILD: Build = {
  version: 'v2',
  precache: ['/index.html', '/manifest.webmanifest', '/assets/main-a1.js'],
  assets: ['/assets/main-a1.js', '/assets/page-b2.js', '/assets/page-c3.js'],
}

const absolute = (input: string | { url: string }): string =>
  new URL(typeof input === 'string' ? input : input.url, ORIGIN).href

class FakeCache {
  entries = new Map<string, Response>()
  put(request: string | { url: string }, response: Response): Promise<void> {
    this.entries.set(absolute(request), response)
    return Promise.resolve()
  }
  match(request: string | { url: string }): Promise<Response | undefined> {
    // A real cache gives a fresh copy each time, so each answer can be read once.
    return Promise.resolve(this.entries.get(absolute(request))?.clone())
  }
  keys(): Promise<{ url: string }[]> {
    return Promise.resolve([...this.entries.keys()].map((url) => ({ url })))
  }
  delete(request: string | { url: string }): Promise<boolean> {
    return Promise.resolve(this.entries.delete(absolute(request)))
  }
}

class FakeCaches {
  stores = new Map<string, FakeCache>()
  open(name: string): Promise<FakeCache> {
    let store = this.stores.get(name)
    if (!store) {
      store = new FakeCache()
      this.stores.set(name, store)
    }
    return Promise.resolve(store)
  }
  keys(): Promise<string[]> {
    return Promise.resolve([...this.stores.keys()])
  }
  delete(name: string): Promise<boolean> {
    return Promise.resolve(this.stores.delete(name))
  }
}

class FakeRequest {
  url: string
  method = 'GET'
  mode = 'cors'
  cache: string | undefined
  constructor(input: string, init?: { cache?: string }) {
    this.url = absolute(input)
    this.cache = init?.cache
  }
}

/** A good answer from our own site, as the browser labels it. */
function good(body: string, status = 200): Response {
  const response = new Response(body, { status })
  Object.defineProperty(response, 'type', { value: 'basic' })
  return response
}

type Network = (request: { url: string }) => Promise<Response>

function startWorker(build: Build = BUILD, network: Network = () => Promise.resolve(good('net'))) {
  const handlers: Record<string, ((event: unknown) => void)[]> = {}
  const caches = new FakeCaches()
  const fetched: { url: string; cache?: string }[] = []
  const claim = vi.fn()
  const skipWaiting = vi.fn()
  const scope = {
    self: {
      location: { origin: ORIGIN },
      addEventListener: (type: string, handler: (event: unknown) => void) => {
        ;(handlers[type] ??= []).push(handler)
      },
      clients: {
        claim: () => {
          claim()
          return Promise.resolve()
        },
      },
      skipWaiting: () => {
        skipWaiting()
        return Promise.resolve()
      },
    },
    caches,
    URL,
    Request: FakeRequest,
    fetch: (request: { url: string; cache?: string }) => {
      fetched.push(request)
      return network(request)
    },
  }
  vm.runInNewContext(`const __BUILD__ = ${JSON.stringify(build)};\n${code}`, scope)

  const dispatch = (type: string, event: object): void => {
    for (const handler of handlers[type] ?? []) handler(event)
  }
  return {
    caches,
    fetched,
    claim,
    skipWaiting,
    async install(): Promise<void> {
      let work: Promise<unknown> | undefined
      dispatch('install', {
        waitUntil: (promise: Promise<unknown>) => {
          work = promise
        },
      })
      await work
    },
    async activate(): Promise<void> {
      let work: Promise<unknown> | undefined
      dispatch('activate', {
        waitUntil: (promise: Promise<unknown>) => {
          work = promise
        },
      })
      await work
    },
    /** What the worker does with a request: nothing (it let it through), or its answer. */
    async request(
      url: string,
      extra: { method?: string; mode?: string } = {},
    ): Promise<{ handled: false } | { handled: true; response: Response }> {
      const request = Object.assign(new FakeRequest(url), extra)
      const respondWith = vi.fn()
      dispatch('fetch', { request, respondWith })
      if (respondWith.mock.calls.length === 0) return { handled: false }
      const answer: unknown = respondWith.mock.calls[0]?.[0]
      return { handled: true, response: await (answer as Promise<Response>) }
    },
    message(data: unknown): void {
      dispatch('message', { data })
    },
  }
}

describe('installing', () => {
  it('keeps each file of the shell, fetched fresh and never from the browser cache', async () => {
    const worker = startWorker()
    await worker.install()
    const shell = worker.caches.stores.get('contour-precache-v2')
    expect([...(shell?.entries.keys() ?? [])]).toEqual(BUILD.precache.map(absolute))
    expect(worker.fetched.map((request) => request.cache)).toEqual(['reload', 'reload', 'reload'])
  })

  it('fails as a whole when one file cannot be fetched, so the old version carries on', async () => {
    const worker = startWorker(BUILD, (request) =>
      Promise.resolve(
        request.url.endsWith('manifest.webmanifest') ? good('gone', 404) : good('ok'),
      ),
    )
    await expect(worker.install()).rejects.toThrow('/manifest.webmanifest answered 404')
  })

  it('waits for the person: it never takes over by itself', async () => {
    const worker = startWorker()
    await worker.install()
    expect(worker.skipWaiting).not.toHaveBeenCalled()
    worker.message({ type: 'something else' })
    worker.message(undefined)
    expect(worker.skipWaiting).not.toHaveBeenCalled()
    worker.message({ type: 'skip-waiting' })
    expect(worker.skipWaiting).toHaveBeenCalledTimes(1)
  })
})

describe('taking over', () => {
  it("clears an older version's shell and the kept files this build no longer has, then takes the pages", async () => {
    const worker = startWorker()
    const old = await worker.caches.open('contour-precache-v1')
    await old.put('/index.html', good('old'))
    const other = await worker.caches.open('somebody-elses-cache')
    await other.put('/x', good('x'))
    const assets = await worker.caches.open('contour-assets')
    await assets.put('/assets/page-b2.js', good('b'))
    await assets.put('/assets/page-old9.js', good('old'))
    await worker.install()
    await worker.activate()

    // The old shell is gone, another program's cache is left alone, and this build's are there.
    expect(await worker.caches.keys()).toEqual([
      'somebody-elses-cache',
      'contour-assets',
      'contour-precache-v2',
    ])
    expect([...assets.entries.keys()]).toEqual([absolute('/assets/page-b2.js')])
    expect(worker.claim).toHaveBeenCalledTimes(1)
  })
})

describe('what it serves', () => {
  it('opens every address of the website from the kept shell, with no network', async () => {
    const worker = startWorker()
    await worker.install()
    worker.fetched.length = 0
    for (const path of ['/', '/assistant/call-logs', '/runs/0f3c9a2e', '/login?next=%2Fstart']) {
      const answer = await worker.request(path, { mode: 'navigate' })
      expect(answer.handled && (await answer.response.text())).toBe('net')
    }
    expect(worker.fetched).toHaveLength(0)
  })

  it('goes to the network for a page when the shell is somehow not kept', async () => {
    const worker = startWorker()
    const answer = await worker.request('/results', { mode: 'navigate' })
    expect(answer.handled).toBe(true)
    expect(worker.fetched.map((request) => request.url)).toEqual([absolute('/results')])
  })

  it('serves the files of the shell from the device', async () => {
    const worker = startWorker()
    await worker.install()
    worker.fetched.length = 0
    const answer = await worker.request('/assets/main-a1.js')
    expect(answer.handled).toBe(true)
    expect(worker.fetched).toHaveLength(0)
  })

  it('keeps any other file under /assets/ the first time it is fetched, and then serves it from the device', async () => {
    let calls = 0
    const worker = startWorker(BUILD, () => {
      calls += 1
      return Promise.resolve(good(`page ${String(calls)}`))
    })
    const first = await worker.request('/assets/page-b2.js')
    const second = await worker.request('/assets/page-b2.js')
    expect(first.handled && (await first.response.text())).toBe('page 1')
    expect(second.handled && (await second.response.text())).toBe('page 1')
    expect(calls).toBe(1)
  })

  it('never keeps a failed answer, or one that is not from our own site', async () => {
    const answers = [good('gone', 404), new Response('opaque'), good('fine')]
    const worker = startWorker(BUILD, () => Promise.resolve(answers.shift() as Response))
    await worker.request('/assets/page-b2.js')
    await worker.request('/assets/page-b2.js')
    const kept = await worker.caches.open('contour-assets')
    // The 404 and the answer typed "default" (not "basic") were not kept; the good one was.
    expect([...kept.entries.keys()]).toEqual([])
    await worker.request('/assets/page-b2.js')
    expect([...kept.entries.keys()]).toEqual([absolute('/assets/page-b2.js')])
  })
})

describe('what it never touches', () => {
  it.each([
    ['the backend', '/api/v1/companies/meetings', {}],
    ['the sign-in answer', '/api/v1/auth/me', {}],
    ['the live run feed', '/api/v1/runs/abc/events', { mode: 'cors' }],
    ['a navigation to the backend', '/api/docs', { mode: 'navigate' }],
    ['another site (the map tiles)', 'https://tile.openstreetmap.org/12/3/4.png', {}],
    ['a write', '/assets/page-b2.js', { method: 'POST' }],
    ['the worker itself', '/sw.js', {}],
  ])('lets %s straight through, as if there were no worker', async (_name, url, extra) => {
    const worker = startWorker()
    await worker.install()
    worker.fetched.length = 0
    const answer = await worker.request(url, extra)
    expect(answer.handled).toBe(false)
    expect(worker.fetched).toHaveLength(0)
  })

  it('keeps nothing from /api, whatever the person does', async () => {
    const worker = startWorker()
    await worker.install()
    for (const path of [
      '/api/v1/auth/me',
      '/api/v1/leads',
      '/api/v1/companies?q=a',
      '/',
      '/assets/page-c3.js',
    ]) {
      await worker.request(path, path === '/' ? { mode: 'navigate' } : {})
    }
    await worker.activate()
    const everything = [...worker.caches.stores.values()].flatMap((store) => [
      ...store.entries.keys(),
    ])
    expect(everything.filter((url) => new URL(url).pathname.startsWith('/api/'))).toEqual([])
  })
})
