import { QueryClient } from '@tanstack/react-query'
import { House } from 'lucide-react'
import { createMemoryRouter, type RouteObject } from 'react-router'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { meQueryOptions, type SignIn } from '@/api/hooks/auth'
import { fakeIdle } from '@/test/fake-idle'
import type { PrefetchArgs, RouteHandle } from './crumbs'
import type { AppModule } from './nav'
import { warmModulePages, WARM_FOR_MS } from './warm-module'

/*
  Warming the rest of a project's pages (Improvements 1, #10), against a real router with made-up
  pages: each page has a `lazy` (its code) and a `prefetch` (its first reads), and the test counts
  what was asked for and in which order.
*/

interface Page {
  lazy: Mock<() => Promise<{ Component: () => null }>>
  prefetch: Mock<(args: PrefetchArgs) => void>
}

const aPage = (): Page => ({
  lazy: vi.fn(() => Promise.resolve({ Component: () => null })),
  prefetch: vi.fn(),
})

/** A project with these pages in its menu. */
function aProject(
  id: string,
  paths: readonly string[],
  options: { warm?: boolean; app?: string } = {},
): AppModule {
  return {
    id,
    name: id,
    icon: House,
    description: id,
    pages: paths.map((to) => ({ to, label: to, icon: House })),
    routes: [],
    warm: options.warm ?? true,
    app: options.app,
  }
}

const OFF: SignIn = { state: 'off' }

const staff = (apps: string[]): SignIn => ({
  state: 'signed_in',
  user: {
    id: 'aaaaaaaa-2222-3333-4444-555555555555',
    name: 'Sample Person',
    email: 'sample@example.test',
    username: 'sample',
    role: 'staff',
    apps,
  },
})

const routers: { dispose: () => void }[] = []

afterEach(() => {
  for (const router of routers.splice(0)) router.dispose()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/**
 * A router over Home (/), /a, /b, /c and /x (a page in no project), a cache that knows who this
 * is, and the idle browser.
 */
function setup(at: string, signIn: SignIn | null = OFF) {
  const pages = { home: aPage(), a: aPage(), b: aPage(), c: aPage(), x: aPage() }
  const tree: RouteObject[] = Object.entries(pages).map(([name, page]) => ({
    path: name === 'home' ? '/' : `/${name}`,
    lazy: page.lazy,
    handle: { prefetch: page.prefetch } satisfies RouteHandle,
  }))
  const router = createMemoryRouter(tree, { initialEntries: [at] })
  routers.push(router)
  const client = new QueryClient()
  if (signIn) client.setQueryData(meQueryOptions().queryKey, signIn)
  const browser = fakeIdle()
  return {
    pages,
    router,
    client,
    /** One idle moment: what waits for the browser runs. */
    idle: () => {
      browser.idle()
    },
    /** Lets everything that can happen happen, handing out idle moments between the waits. */
    async settle() {
      for (let round = 0; round < 12; round++) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        browser.idle()
      }
    },
    async tick() {
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
  }
}

const order = (mock: Mock): number => mock.mock.invocationCallOrder[0] ?? Infinity

describe('warming the other pages of a project', () => {
  it('fetches the code and then the first reads of each other page, one page at a time', async () => {
    const run = setup('/a')
    warmModulePages(run.router, run.client, [aProject('m', ['/a', '/b', '/c'])])
    await run.settle()

    const { a, b, c } = run.pages
    for (const page of [b, c]) {
      expect(page.lazy).toHaveBeenCalledTimes(1)
      expect(page.prefetch).toHaveBeenCalledTimes(1)
      expect(page.prefetch).toHaveBeenCalledWith({
        client: run.client,
        params: {},
        search: expect.any(URLSearchParams) as URLSearchParams,
      })
      // The code is there before the reads start: a page's data hooks live in it.
      expect(order(page.lazy)).toBeLessThan(order(page.prefetch))
    }
    // One page is finished before the next starts.
    expect(order(b.prefetch)).toBeLessThan(order(c.lazy))
    // The page on screen is not asked for again: it started with its own navigation.
    expect(a.prefetch).not.toHaveBeenCalled()
  })

  it('starts only when the browser is idle', async () => {
    const run = setup('/a')
    warmModulePages(run.router, run.client, [aProject('m', ['/a', '/b', '/c'])])
    await run.tick()
    await run.tick()
    expect(run.pages.b.lazy).not.toHaveBeenCalled()
    expect(run.pages.b.prefetch).not.toHaveBeenCalled()
  })

  it('does nothing for a project that has not opted in', async () => {
    const run = setup('/a')
    warmModulePages(run.router, run.client, [aProject('m', ['/a', '/b', '/c'], { warm: false })])
    await run.settle()
    expect(run.pages.b.lazy).not.toHaveBeenCalled()
    expect(run.pages.c.prefetch).not.toHaveBeenCalled()
  })

  it('does nothing on a page that is in no project, and starts when a page of one opens', async () => {
    const run = setup('/x')
    warmModulePages(run.router, run.client, [aProject('m', ['/a', '/b', '/c'])])
    await run.settle()
    expect(run.pages.b.lazy).not.toHaveBeenCalled()

    await run.router.navigate('/a')
    await run.settle()
    expect(run.pages.b.prefetch).toHaveBeenCalledTimes(1)
    expect(run.pages.c.prefetch).toHaveBeenCalledTimes(1)
  })

  it('only wakes the project the person is in, not the others', async () => {
    const run = setup('/a')
    // /c belongs to another project, which also opts in.
    warmModulePages(run.router, run.client, [
      aProject('one', ['/a', '/b']),
      aProject('two', ['/c', '/x']),
    ])
    await run.settle()
    expect(run.pages.b.prefetch).toHaveBeenCalledTimes(1)
    expect(run.pages.c.prefetch).not.toHaveBeenCalled()
    expect(run.pages.x.prefetch).not.toHaveBeenCalled()
  })
})

describe('on Home', () => {
  it('loads the code, and only the code, of the pages of the projects the person may use, once', async () => {
    const run = setup('/')
    warmModulePages(run.router, run.client, [aProject('m', ['/a', '/b', '/c'])])
    await run.settle()
    const { a, b, c } = run.pages
    for (const page of [a, b, c]) {
      expect(page.lazy).toHaveBeenCalledTimes(1)
      // The first reads wait until a page of the project is open.
      expect(page.prefetch).not.toHaveBeenCalled()
    }

    // Back on Home later: nothing is fetched again.
    await run.router.navigate('/x')
    await run.router.navigate('/')
    await run.settle()
    for (const page of [a, b, c]) expect(page.lazy).toHaveBeenCalledTimes(1)
  })

  it("loads the code of a project only if it opts in and the person's account lists it", async () => {
    const run = setup('/', staff(['companies']))
    warmModulePages(run.router, run.client, [
      aProject('listed', ['/a', '/b'], { app: 'companies' }),
      aProject('other', ['/c'], { app: 'secret' }),
      aProject('quiet', ['/x'], { app: 'companies', warm: false }),
    ])
    await run.settle()
    expect(run.pages.a.lazy).toHaveBeenCalledTimes(1)
    expect(run.pages.b.lazy).toHaveBeenCalledTimes(1)
    expect(run.pages.c.lazy).not.toHaveBeenCalled()
    // /x was only the router's own: it opens nothing here.
    expect(run.pages.x.lazy).not.toHaveBeenCalled()
  })

  it('does nothing when nobody is signed in, or on a connection that asks to save data', async () => {
    const out = setup('/', { state: 'signed_out', reason: null, detail: null })
    warmModulePages(out.router, out.client, [aProject('m', ['/a', '/b', '/c'])])
    await out.settle()
    expect(out.pages.a.lazy).not.toHaveBeenCalled()

    vi.stubGlobal('navigator', { ...navigator, connection: { saveData: true } })
    const saving = setup('/')
    warmModulePages(saving.router, saving.client, [aProject('m', ['/a', '/b', '/c'])])
    await saving.settle()
    expect(saving.pages.a.lazy).not.toHaveBeenCalled()
  })

  it('stops when the function it returns is called', async () => {
    const run = setup('/')
    const stop = warmModulePages(run.router, run.client, [aProject('m', ['/a', '/b', '/c'])])
    await run.tick()
    stop()
    await run.settle()
    expect(run.pages.a.lazy).not.toHaveBeenCalled()
  })
})

describe('when it warms again', () => {
  it('asks nothing more while the pages still count as warm, and again once they do not', async () => {
    const run = setup('/a')
    warmModulePages(run.router, run.client, [aProject('m', ['/a', '/b', '/c'])])
    await run.settle()
    expect(run.pages.b.prefetch).toHaveBeenCalledTimes(1)

    // Moving to another page of the same project right away: they were all asked for just now.
    await run.router.navigate('/b')
    await run.settle()
    expect(run.pages.a.prefetch).not.toHaveBeenCalled()
    expect(run.pages.b.prefetch).toHaveBeenCalledTimes(1)

    // Long enough later (the cache has let go of what it held), the next arrival warms again.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + WARM_FOR_MS + 1)
    await run.router.navigate('/c')
    await run.settle()
    expect(run.pages.a.prefetch).toHaveBeenCalledTimes(1)
    expect(run.pages.b.prefetch).toHaveBeenCalledTimes(2)
  })

  it('stops when the person leaves the project, before the pages it had left', async () => {
    const run = setup('/a')
    warmModulePages(run.router, run.client, [aProject('m', ['/a', '/b', '/c'])])
    await run.tick()
    run.idle() // passes the open page
    await run.tick()
    run.idle() // warms /b, and /c is next
    await run.tick()
    expect(run.pages.b.prefetch).toHaveBeenCalledTimes(1)

    await run.router.navigate('/x') // out of the project
    await run.settle()
    expect(run.pages.c.lazy).not.toHaveBeenCalled()
    expect(run.pages.c.prefetch).not.toHaveBeenCalled()
  })

  it('is stopped by the function it returns', async () => {
    const run = setup('/a')
    const stop = warmModulePages(run.router, run.client, [aProject('m', ['/a', '/b', '/c'])])
    await run.tick()
    stop()
    await run.settle()
    expect(run.pages.b.lazy).not.toHaveBeenCalled()

    // And it no longer watches the router.
    await run.router.navigate('/x')
    await run.router.navigate('/b')
    await run.settle()
    expect(run.pages.c.prefetch).not.toHaveBeenCalled()
  })
})

describe('who it warms for', () => {
  it('waits to hear who this is, and warms once sign-in is known to be off', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(Response.json({ auth_required: false, user: null, session: null })),
      ),
    )
    const run = setup('/a', null)
    warmModulePages(run.router, run.client, [aProject('m', ['/a', '/b', '/c'])])
    await run.settle()
    expect(run.pages.b.prefetch).toHaveBeenCalledTimes(1)
  })

  it('does nothing when nobody is signed in', async () => {
    const run = setup('/a', { state: 'signed_out', reason: null, detail: null })
    warmModulePages(run.router, run.client, [aProject('m', ['/a', '/b', '/c'])])
    await run.settle()
    expect(run.pages.b.lazy).not.toHaveBeenCalled()
  })

  it("does nothing for a project the person's account does not list, and warms one it does", async () => {
    const without = setup('/a', staff([]))
    warmModulePages(without.router, without.client, [
      aProject('m', ['/a', '/b', '/c'], { app: 'companies' }),
    ])
    await without.settle()
    expect(without.pages.b.lazy).not.toHaveBeenCalled()

    const listed = setup('/a', staff(['companies']))
    warmModulePages(listed.router, listed.client, [
      aProject('m', ['/a', '/b', '/c'], { app: 'companies' }),
    ])
    await listed.settle()
    expect(listed.pages.b.prefetch).toHaveBeenCalledTimes(1)
  })

  it('does nothing on a connection that asks to save data', async () => {
    vi.stubGlobal('navigator', { ...navigator, connection: { saveData: true } })
    const run = setup('/a')
    warmModulePages(run.router, run.client, [aProject('m', ['/a', '/b', '/c'])])
    await run.settle()
    expect(run.pages.b.lazy).not.toHaveBeenCalled()
  })
})
