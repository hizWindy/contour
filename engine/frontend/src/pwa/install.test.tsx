import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('sonner', () => ({ toast: vi.fn() }))

/*
  Installing the website as an app (Improvements 1, #9): the browser's own dialog where it has
  one, steps on an iPhone, nothing once it is installed. The module keeps its state for the page's
  life, so each test starts from a fresh copy of it.
*/

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
// An iPad asks for the desktop site by default, so it says it is a Mac.
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

async function fresh() {
  vi.resetModules()
  const sonner = await import('sonner')
  const module = await import('./install')
  module.watchInstall()
  return { ...module, toast: vi.mocked(sonner.toast) }
}

/** The browser saying the site can be installed. */
function offered() {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: Mock<() => Promise<void>>
    userChoice: Promise<{ outcome: string }>
  }
  event.prompt = vi.fn(() => Promise.resolve())
  event.userChoice = Promise.resolve({ outcome: 'accepted' })
  window.dispatchEvent(event)
  return event
}

/** What kind of device this visit is on. A desktop browser unless told otherwise. */
function viewAs(options: { agent?: string; standalone?: boolean; touch?: number }) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(options.agent ?? WINDOWS)
  // jsdom has no touch screen property at all, so there is nothing to spy on.
  Object.defineProperty(navigator, 'maxTouchPoints', {
    value: options.touch ?? 0,
    configurable: true,
  })
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: options.standalone === true && query === '(display-mode: standalone)',
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  )
}

beforeEach(() => {
  viewAs({})
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'maxTouchPoints')
  Reflect.deleteProperty(navigator, 'standalone')
})

describe('how this visit can install', () => {
  it('cannot, until the browser says it can (a desktop browser with nothing to offer yet)', async () => {
    const { installWay } = await fresh()
    expect(installWay()).toBeNull()
  })

  it('uses the browser dialog once the browser has offered it, and keeps its own bar out of the way', async () => {
    const { installWay } = await fresh()
    const event = offered()
    expect(event.defaultPrevented).toBe(true)
    expect(installWay()).toBe('prompt')
  })

  it('gives steps on an iPhone, which has no dialog', async () => {
    viewAs({ agent: IPHONE, touch: 5 })
    expect((await fresh()).installWay()).toBe('steps')
  })

  it('gives steps on an iPad too, although it says it is a Mac, because it has a touch screen', async () => {
    viewAs({ agent: MAC, touch: 5 })
    expect((await fresh()).installWay()).toBe('steps')
  })

  it('gives no steps on a real Mac: its Safari installs from its own menu', async () => {
    viewAs({ agent: MAC, touch: 0 })
    expect((await fresh()).installWay()).toBeNull()
  })

  it('offers nothing when this window already is the installed app', async () => {
    viewAs({ standalone: true })
    const { installWay } = await fresh()
    offered()
    expect(installWay()).toBeNull()
  })

  it("offers nothing in Safari's home-screen app, which says so in its own way", async () => {
    viewAs({ agent: IPHONE, touch: 5 })
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
    expect((await fresh()).installWay()).toBeNull()
  })

  it('offers nothing once it has been installed', async () => {
    const { installWay } = await fresh()
    offered()
    window.dispatchEvent(new Event('appinstalled'))
    expect(installWay()).toBeNull()
  })
})

describe('installing', () => {
  it("asks the browser's own dialog once, and the offer is gone after it", async () => {
    const { install, installWay } = await fresh()
    const event = offered()
    await install()
    expect(event.prompt).toHaveBeenCalledTimes(1)
    // The browser lets each offer ask once: it comes back on a later visit if the answer was no.
    expect(installWay()).toBeNull()
  })

  it('says how to add it to the home screen where there is no dialog', async () => {
    viewAs({ agent: IPHONE, touch: 5 })
    const { install, toast, INSTALL_STEPS, INSTALL_STEPS_HINT } = await fresh()
    await install()
    expect(toast).toHaveBeenCalledWith(INSTALL_STEPS, { description: INSTALL_STEPS_HINT })
  })

  it('shows the offer in a page, and takes it away as the browser offers and installs', async () => {
    const { useInstallWay } = await fresh()
    function Offer() {
      return <p>{useInstallWay() ?? 'none'}</p>
    }
    render(<Offer />)
    expect(screen.getByText('none')).toBeInTheDocument()
    act(() => {
      offered()
    })
    expect(screen.getByText('prompt')).toBeInTheDocument()
    act(() => {
      window.dispatchEvent(new Event('appinstalled'))
    })
    expect(screen.getByText('none')).toBeInTheDocument()
  })
})
