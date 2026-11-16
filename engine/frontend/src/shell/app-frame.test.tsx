import { act, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signInOff, stubAuthBackend } from '@/test/fake-auth'
import { renderWithProviders, startManualClock } from '@/test/render'
import { AppFrame, MAIN_ID } from './app-frame'

/** The app frame with a Home page and a page whose code arrives only when the test lets it. */
function renderApp() {
  let arrive: () => void = () => undefined
  const code = new Promise<void>((resolve) => {
    arrive = resolve
  })
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <AppFrame />,
        children: [
          { index: true, element: <p>The home page</p> },
          {
            path: 'slow',
            lazy: async () => {
              await code
              return { Component: () => <p>The slow page</p> }
            },
          },
        ],
      },
    ],
    { initialEntries: ['/'] },
  )
  stubAuthBackend({ me: signInOff() })
  renderWithProviders(<RouterProvider router={router} />, { withRouter: false })
  return { router, arrive }
}

const page = () => document.getElementById(MAIN_ID)

describe('a click on a page whose code is on its way (PLAN-V7 B3)', () => {
  it('dims the page you are leaving once it has waited 200 ms, and undims when the next one is there', async () => {
    startManualClock()
    const { router, arrive } = renderApp()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(screen.getByText('The home page')).toBeInTheDocument()

    // The click first, so React draws the waiting state and starts its 200 ms timer.
    await act(async () => {
      void router.navigate('/slow')
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(199)
    })
    expect(page()).not.toHaveAttribute('aria-busy')
    expect(page()).not.toHaveClass('opacity-60')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(page()).toHaveAttribute('aria-busy', 'true')
    expect(page()).toHaveClass('opacity-60')
    expect(screen.getByText('The home page')).toBeInTheDocument() // still the old page

    await act(async () => {
      arrive()
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(screen.getByText('The slow page')).toBeInTheDocument()
    expect(page()).not.toHaveAttribute('aria-busy')
    expect(page()).not.toHaveClass('opacity-60')
  })

  it('does not dim for a page that arrives within 200 ms', async () => {
    startManualClock()
    const { router, arrive } = renderApp()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    await act(async () => {
      void router.navigate('/slow')
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(page()).not.toHaveClass('opacity-60')
    await act(async () => {
      arrive()
      await vi.advanceTimersByTimeAsync(0)
    })
    // Well past 200 ms since the click: a timer that was not cleared would dim the new page now.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(screen.getByText('The slow page')).toBeInTheDocument()
    expect(page()).not.toHaveClass('opacity-60')
  })
})

describe('a new page eases in (Improvements 1, #8)', () => {
  /** jsdom has no Web Animations: a stand-in that remembers what each page was asked to do. */
  function watchAnimations() {
    const runs: { keyframes: Keyframe[]; options: KeyframeAnimationOptions }[] = []
    const cancel = vi.fn()
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: (keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
        runs.push({ keyframes, options })
        return { cancel }
      },
    })
    return runs
  }

  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'animate')
  })

  it('fades the page in from 55% to full in 160ms when you go to another page, and not on the first', async () => {
    const runs = watchAnimations()
    const { router, arrive } = renderApp()
    expect(await screen.findByText('The home page')).toBeInTheDocument()
    // The first page of a visit has the frame's own fade.
    expect(runs).toHaveLength(0)

    arrive()
    await act(async () => {
      await router.navigate('/slow')
    })
    expect(await screen.findByText('The slow page')).toBeInTheDocument()
    expect(runs.length).toBeGreaterThanOrEqual(1)
    const run = runs.at(-1)
    // Only the opacity moves: a transform would make the page the home of its fixed bars.
    expect(run?.keyframes).toEqual([{ opacity: 0.55 }, { opacity: 1 }])
    expect(run?.options.duration).toBe(160)
  })

  it('does not fade for a change inside the same page (a tab, a filter, a search)', async () => {
    const runs = watchAnimations()
    const { router } = renderApp()
    expect(await screen.findByText('The home page')).toBeInTheDocument()
    await act(async () => {
      await router.navigate('/?tab=history')
    })
    expect(runs).toHaveLength(0)
  })
})
