import { useQueryClient } from '@tanstack/react-query'
import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useState } from 'react'
import {
  createMemoryRouter,
  Link,
  RouterProvider,
  useInRouterContext,
  useLocation,
} from 'react-router'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { FakeEventSource } from './fake-event-source'
import { renderWithProviders, startManualClock } from './render'

describe('polyfills', () => {
  it('provides what jsdom leaves out', () => {
    expect(typeof window.matchMedia('(prefers-color-scheme: dark)').matches).toBe('boolean')
    expect(typeof ResizeObserver).toBe('function')
    expect(typeof PointerEvent).toBe('function')
    expect(typeof document.body.scrollIntoView).toBe('function')
    expect(document.body.hasPointerCapture(1)).toBe(false)
    expect(typeof crypto.randomUUID()).toBe('string')
  })
})

describe('FakeEventSource', () => {
  it('is the global EventSource and records every instance', () => {
    const first = new EventSource('/api/v1/runs/1/events')
    const second = new EventSource('/api/v1/runs/1/events?after=3')

    expect(FakeEventSource.instances).toEqual([first, second])
    expect(FakeEventSource.last()).toBe(second)
    expect(second.readyState).toBe(0)
  })

  it('starts empty in every test', () => {
    expect(FakeEventSource.instances).toHaveLength(0)
    expect(() => FakeEventSource.last()).toThrow('No EventSource was opened')
  })

  it('dispatches open, message and error to listeners and on* handlers', () => {
    const source = new EventSource('/stream') as unknown as FakeEventSource
    const opened = vi.fn()
    const named = vi.fn()
    const errored = vi.fn()
    const onmessage = vi.fn()
    source.addEventListener('open', opened)
    source.addEventListener('progress', named)
    source.addEventListener('error', errored)
    source.onmessage = onmessage

    source.emitOpen()
    source.emitMessage({ seq: 1 })
    source.emitMessage({ seq: 2 }, { event: 'progress', lastEventId: '2' })
    source.emitError()

    expect(opened).toHaveBeenCalledTimes(1)
    expect(source.readyState).toBe(FakeEventSource.CONNECTING)
    expect(onmessage).toHaveBeenCalledTimes(1)
    expect(JSON.parse((onmessage.mock.calls[0]?.[0] as MessageEvent<string>).data)).toEqual({
      seq: 1,
    })
    const namedEvent = named.mock.calls[0]?.[0] as MessageEvent<string>
    expect(namedEvent.lastEventId).toBe('2')
    expect(errored).toHaveBeenCalledTimes(1)
  })

  it('can end the stream for good, and ignores events after close()', () => {
    const source = new EventSource('/stream') as unknown as FakeEventSource
    const onerror = vi.fn()
    source.onerror = onerror

    source.emitError({ closed: true })
    expect(source.readyState).toBe(FakeEventSource.CLOSED)

    source.close()
    source.emitError()
    expect(onerror).toHaveBeenCalledTimes(1)
    expect(source.closedByClient).toBe(true)
  })
})

describe('renderWithProviders', () => {
  function Probe() {
    const client = useQueryClient()
    const location = useLocation()
    const defaults = client.getDefaultOptions().queries
    return (
      <p>
        {location.pathname}|{String(defaults?.retry)}
      </p>
    )
  }

  it('gives components a query client with retries off and a router at the given route', () => {
    renderWithProviders(<Probe />, { route: '/results' })

    expect(screen.getByText('/results|false')).toBeInTheDocument()
  })

  it('returns the query client and a user-event instance', () => {
    const { queryClient, user } = renderWithProviders(<Probe />)

    expect(queryClient.getQueryCache().getAll()).toEqual([])
    expect(typeof user.click).toBe('function')
  })
})

describe('renderWithProviders: userEventOptions', () => {
  it('hands the options to userEvent.setup()', async () => {
    // user-event calls `advanceTimers(delay)` after each pause. A spy proves the option arrived.
    const advanceTimers = vi.fn()
    const { user } = renderWithProviders(<button type="button">Go</button>, {
      userEventOptions: { advanceTimers },
    })

    await user.click(screen.getByRole('button', { name: 'Go' }))

    expect(advanceTimers).toHaveBeenCalled()
    expect(advanceTimers).toHaveBeenCalledWith(0)
  })

  it('adds nothing of its own while the timers are real', () => {
    const setup = vi.spyOn(userEvent, 'setup')

    renderWithProviders(<button type="button">Go</button>)

    expect(setup).toHaveBeenCalledWith({})
  })

  it('moves the fake clock for user-event by itself, once fake timers are on', () => {
    startManualClock()
    const setup = vi.spyOn(userEvent, 'setup')

    renderWithProviders(<button type="button">Go</button>)

    expect(setup).toHaveBeenCalledWith({ advanceTimers: vi.advanceTimersByTime })
  })

  it('lets an advanceTimers of the test win over the default', () => {
    startManualClock()
    const setup = vi.spyOn(userEvent, 'setup')
    const own = vi.fn()

    renderWithProviders(<button type="button">Go</button>, {
      userEventOptions: { advanceTimers: own, delay: 5 },
    })

    expect(setup).toHaveBeenCalledWith({ advanceTimers: own, delay: 5 })
  })

  it('uses the user-event defaults when no option is given', async () => {
    const onClick = vi.fn()
    const { user } = renderWithProviders(
      <button type="button" onClick={onClick}>
        Go
      </button>,
    )

    await user.click(screen.getByRole('button', { name: 'Go' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('renderWithProviders: withRouter', () => {
  function RouterProbe() {
    return <p>router: {String(useInRouterContext())}</p>
  }

  function LazyPage() {
    const location = useLocation()
    const retry = useQueryClient().getDefaultOptions().queries?.retry
    return (
      <div>
        <p>
          lazy page at {location.pathname}, retry {String(retry)}
        </p>
        <Link to="/second">Next</Link>
      </div>
    )
  }

  function SecondPage() {
    return <p>second page</p>
  }

  it('wraps the UI in a memory router by default', () => {
    renderWithProviders(<RouterProbe />)

    expect(screen.getByText('router: true')).toBeInTheDocument()
  })

  it('skips the memory router when withRouter is false', () => {
    renderWithProviders(<RouterProbe />, { withRouter: false })

    expect(screen.getByText('router: false')).toBeInTheDocument()
  })

  it('still gives the query client and the toast host without a router', () => {
    const { queryClient } = renderWithProviders(<RouterProbe />, { withRouter: false })

    expect(queryClient.getDefaultOptions().queries?.retry).toBe(false)
    expect(document.querySelector('section[aria-label^="Notifications"]')).toBeInTheDocument()
  })

  it('runs a data router with lazy routes, with the providers around it', async () => {
    const router = createMemoryRouter(
      [
        { path: '/first', lazy: () => Promise.resolve({ Component: LazyPage }) },
        { path: '/second', lazy: () => Promise.resolve({ Component: SecondPage }) },
      ],
      { initialEntries: ['/first'] },
    )
    const { user } = renderWithProviders(<RouterProvider router={router} />, {
      withRouter: false,
    })

    expect(await screen.findByText('lazy page at /first, retry false')).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Next' }))

    expect(await screen.findByText('second page')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/second')

    await act(async () => {
      await router.navigate('/first')
    })

    expect(await screen.findByText('lazy page at /first, retry false')).toBeInTheDocument()
  })

  it('cannot hold a data router inside the default memory router, which is why the option exists', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const router = createMemoryRouter([{ path: '/', element: <p>home</p> }])

    expect(() => renderWithProviders(<RouterProvider router={router} />)).toThrow(
      /inside another <Router>/,
    )
  })
})

describe('renderWithProviders: fake timers and a debounce', () => {
  const DELAY = 300

  /** Shows what was typed only after a pause of 300 ms, like the live estimate on /start. */
  function DebouncedSearch() {
    const [typed, setTyped] = useState('')
    const [settled, setSettled] = useState('')
    useEffect(() => {
      const timer = setTimeout(() => setSettled(typed), DELAY)
      return () => clearTimeout(timer)
    }, [typed])
    return (
      <div>
        <label>
          Search
          <input value={typed} onChange={(event) => setTyped(event.target.value)} />
        </label>
        <p>Results for {settled === '' ? 'nothing' : settled}</p>
      </div>
    )
  }

  it('way 1, shouldAdvanceTime: waits for the pause, then shows the result', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { user } = renderWithProviders(<DebouncedSearch />)

    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'abc')

    expect(screen.getByText('Results for nothing')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAY)
    })

    expect(screen.getByText('Results for abc')).toBeInTheDocument()
  })

  it('way 1: findBy keeps working, because the clock also runs by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { user } = renderWithProviders(<DebouncedSearch />)

    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'x')

    expect(await screen.findByText('Results for x')).toBeInTheDocument()
  })

  it('way 2, manual clock: nothing at 299 ms, the result at 300 ms, and a new key starts over', async () => {
    startManualClock()
    const { user } = renderWithProviders(<DebouncedSearch />, {
      userEventOptions: { advanceTimers: vi.advanceTimersByTime },
    })
    const box = screen.getByRole('textbox', { name: 'Search' })

    await user.type(box, 'ab')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAY - 1)
    })

    expect(screen.getByText('Results for nothing')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(screen.getByText('Results for ab')).toBeInTheDocument()

    // Another key before the pause is over: the first result stays until the new pause ends.
    await user.type(box, 'c')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAY - 1)
    })

    expect(screen.getByText('Results for ab')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(screen.getByText('Results for abc')).toBeInTheDocument()
  })

  // Regression: the default user used to hang here, because its `setTimeout(0)` pauses never fired
  // on a clock that only the test moves. The short timeout makes a hang fail fast.
  it(
    'way 2: the default user does not hang after startManualClock',
    { timeout: 2000 },
    async () => {
      startManualClock()
      const { user } = renderWithProviders(<DebouncedSearch />)
      const box = screen.getByRole('textbox', { name: 'Search' })

      await user.type(box, 'ab')
      await user.clear(box)
      await user.type(box, 'cd')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DELAY - 1)
      })

      expect(screen.getByText('Results for nothing')).toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })

      expect(screen.getByText('Results for cd')).toBeInTheDocument()
    },
  )

  it('way 2: delay null makes user-event skip its pauses, so advanceTimers is not needed', async () => {
    startManualClock()
    const { user } = renderWithProviders(<DebouncedSearch />, {
      userEventOptions: { delay: null },
    })

    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'q')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAY)
    })

    expect(screen.getByText('Results for q')).toBeInTheDocument()
  })

  it('way 2: findBy pushes the manual clock forward while it waits', async () => {
    startManualClock()
    const { user } = renderWithProviders(<DebouncedSearch />, {
      userEventOptions: { advanceTimers: vi.advanceTimersByTime },
    })

    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'x')

    expect(await screen.findByText('Results for x')).toBeInTheDocument()
  })

  // Runs right after a test that called startManualClock (tests in a file run in order).
  it('startManualClock leaves nothing behind: the jest stand-in is gone after the test', () => {
    expect(vi.isFakeTimers()).toBe(false)
    expect('jest' in globalThis).toBe(false)
  })

  it('way 2: fireEvent needs no helper at all, because it never waits', async () => {
    vi.useFakeTimers()
    renderWithProviders(<DebouncedSearch />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'z' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAY - 1)
    })

    expect(screen.getByText('Results for nothing')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(screen.getByText('Results for z')).toBeInTheDocument()
  })
})

// Why the header of render.tsx says "never in beforeAll": setup.ts puts the real timers back after
// every test, so a clock started once lasts for the first test only. These two tests run in order.
describe('a clock started in beforeAll', () => {
  beforeAll(() => {
    vi.useFakeTimers()
  })

  it('is on in the first test', () => {
    expect(vi.isFakeTimers()).toBe(true)
  })

  it('is gone in the second test, so start the clock inside each test or in beforeEach', () => {
    expect(vi.isFakeTimers()).toBe(false)
  })
})
