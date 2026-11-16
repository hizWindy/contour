import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
  type MockInstance,
} from 'vitest'
import { browser } from '@/lib/reload'
import {
  register,
  registerServiceWorker,
  RELOAD,
  SKIP_WAITING,
  UPDATE_HINT,
  UPDATE_READY,
} from './register'

vi.mock('sonner', () => ({ toast: vi.fn() }))
const { toast } = await import('sonner')

/*
  Registering the worker and telling the person when a new version waits (Improvements 1, #9):
  only in the real build, quiet on the first install, one notice that stays, nothing that reloads
  by itself, and a look for a newer version now and then.
*/

class FakeWorker extends EventTarget {
  state = 'installing'
}

class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null
  waiting: { postMessage: Mock } | null = null
  update: Mock<() => Promise<void>> = vi.fn(() => Promise.resolve())
}

class FakeContainer extends EventTarget {
  controller: object | null = {}
  registration = new FakeRegistration()
  register = vi.fn(() => Promise.resolve(this.registration))
}

function asContainer(fake: FakeContainer): ServiceWorkerContainer {
  return fake as unknown as ServiceWorkerContainer
}

interface Shown {
  id: string
  description: string
  duration: number
  action: { label: string; onClick: () => void }
}

/** The words and the options the update notice was shown with. */
function shown(): [string, Shown] {
  const call = vi.mocked(toast).mock.calls[0]
  return [call?.[0] as string, call?.[1] as Shown]
}

/** The new worker finished installing while an older one is in charge. */
function newVersionInstalled(container: FakeContainer): void {
  const worker = new FakeWorker()
  container.registration.installing = worker
  container.registration.dispatchEvent(new Event('updatefound'))
  worker.state = 'installed'
  worker.dispatchEvent(new Event('statechange'))
}

let reload: MockInstance<() => void>

beforeEach(() => {
  reload = vi.spyOn(browser, 'reload').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  Reflect.deleteProperty(navigator, 'serviceWorker')
})

describe('registering', () => {
  it('does nothing in the dev server, where a worker that keeps files would hide every edit', () => {
    const container = new FakeContainer()
    Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true })
    registerServiceWorker()
    expect(container.register).not.toHaveBeenCalled()
  })

  it('does nothing in a browser without service workers', () => {
    vi.stubEnv('PROD', true)
    expect(() => {
      registerServiceWorker()
    }).not.toThrow()
  })

  it('registers /sw.js for the whole site in the real build, never reading it from the browser cache', () => {
    vi.stubEnv('PROD', true)
    const container = new FakeContainer()
    Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true })
    registerServiceWorker()
    expect(container.register).toHaveBeenCalledWith('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    })
  })

  it('says nothing when it cannot register: the website works without it', async () => {
    const container = new FakeContainer()
    container.register.mockRejectedValue(new Error('blocked'))
    await expect(register(asContainer(container))).resolves.toBeUndefined()
    expect(toast).not.toHaveBeenCalled()
  })
})

describe('a new version', () => {
  it('is announced once, with a Reload button that stays until it is used', async () => {
    const container = new FakeContainer()
    await register(asContainer(container))
    expect(toast).not.toHaveBeenCalled()
    newVersionInstalled(container)
    expect(toast).toHaveBeenCalledTimes(1)
    const [words, options] = shown()
    expect(words).toBe(UPDATE_READY)
    expect(options).toMatchObject({
      description: UPDATE_HINT,
      duration: Infinity,
      action: { label: RELOAD },
    })
    // The same id, so a second announcement replaces the first rather than stacking up.
    expect(options.id).toBe('contour-update')
  })

  it('is not announced for the very first install: there was no version before it', async () => {
    const container = new FakeContainer()
    container.controller = null
    await register(asContainer(container))
    newVersionInstalled(container)
    expect(toast).not.toHaveBeenCalled()
  })

  it('is announced at once when one is already waiting as the page opens', async () => {
    const container = new FakeContainer()
    container.registration.waiting = { postMessage: vi.fn() }
    await register(asContainer(container))
    expect(toast).toHaveBeenCalledTimes(1)
  })

  it('takes over only when the person presses Reload, and the page reloads once it has', async () => {
    const container = new FakeContainer()
    const waiting = { postMessage: vi.fn() }
    container.registration.waiting = waiting
    await register(asContainer(container))
    // The new worker taking over before anyone asked (it can't: it waits) changes nothing.
    container.dispatchEvent(new Event('controllerchange'))
    expect(reload).not.toHaveBeenCalled()

    const [, options] = shown()
    options.action.onClick()
    expect(waiting.postMessage).toHaveBeenCalledWith(SKIP_WAITING)
    // Nothing reloads until the new worker is in charge; then once, however many times it says so.
    expect(reload).not.toHaveBeenCalled()
    container.dispatchEvent(new Event('controllerchange'))
    container.dispatchEvent(new Event('controllerchange'))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads at once when Reload is pressed and nothing waits any more', async () => {
    const container = new FakeContainer()
    container.registration.waiting = { postMessage: vi.fn() }
    await register(asContainer(container))
    container.registration.waiting = null
    const [, options] = shown()
    options.action.onClick()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('looking for a newer version', () => {
  it('looks every hour, and when the page comes back into view after 10 minutes away, not sooner', async () => {
    vi.useFakeTimers()
    const container = new FakeContainer()
    await register(asContainer(container))
    const update = container.registration.update

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(update).toHaveBeenCalledTimes(1)

    const seen = (state: DocumentVisibilityState): void => {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    }
    // Back in view a minute later: no look. Eleven minutes later: a look.
    await vi.advanceTimersByTimeAsync(60 * 1000)
    seen('visible')
    expect(update).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000)
    seen('visible')
    expect(update).toHaveBeenCalledTimes(2)
    // Going out of view looks at nothing.
    seen('hidden')
    expect(update).toHaveBeenCalledTimes(2)
    Reflect.deleteProperty(document, 'visibilityState')
  })
})
