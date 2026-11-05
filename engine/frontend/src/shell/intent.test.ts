import { QueryClient } from '@tanstack/react-query'
import { fireEvent } from '@testing-library/react'
import type { RouteObject } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POINT_MS } from '@/lib/pointing'
import { preloadOnIntent } from './intent'

/** A table with one page whose code and data we can watch. */
function pages() {
  const code = vi.fn(() => Promise.resolve({ Component: () => null }))
  const data = vi.fn()
  const routes: RouteObject[] = [
    { path: '/start', handle: { prefetch: data }, lazy: code },
    { path: '/results', handle: { prefetch: data }, lazy: code },
  ]
  return { routes, code, data }
}

let stop: () => void = () => undefined

function watch(routes: RouteObject[]): void {
  stop = preloadOnIntent(routes, new QueryClient())
}

function link(attributes: Record<string, string> = {}): HTMLAnchorElement {
  const anchor = document.createElement('a')
  anchor.href = '/start'
  anchor.textContent = 'Start a run'
  for (const [name, value] of Object.entries(attributes)) {
    anchor.setAttribute(name, value)
  }
  document.body.append(anchor)
  return anchor
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  stop()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('preloading when someone is about to open a page (PLAN-V7 C2)', () => {
  it('starts the code and the data once a pointer has rested on a link for a moment', () => {
    const { routes, code, data } = pages()
    watch(routes)
    const anchor = link()

    fireEvent.pointerOver(anchor, { pointerType: 'mouse' })
    vi.advanceTimersByTime(POINT_MS - 1)
    expect(data).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)

    expect(data).toHaveBeenCalledTimes(1)
    expect(code).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the pointer only sweeps past', () => {
    const { routes, code, data } = pages()
    watch(routes)
    const anchor = link()

    fireEvent.pointerOver(anchor, { pointerType: 'mouse' })
    vi.advanceTimersByTime(POINT_MS - 20)
    fireEvent.pointerOut(anchor, { pointerType: 'mouse' })
    vi.advanceTimersByTime(500)

    expect(data).not.toHaveBeenCalled()
    expect(code).not.toHaveBeenCalled()
  })

  it('starts at once when a link gets the keyboard focus', () => {
    const { routes, data } = pages()
    watch(routes)
    const anchor = link()

    anchor.focus()

    expect(data).toHaveBeenCalledTimes(1)
  })

  it('starts at once on a press, which is how a touch screen says it', () => {
    const { routes, data } = pages()
    watch(routes)
    const anchor = link()

    fireEvent.pointerOver(anchor, { pointerType: 'touch' })
    vi.advanceTimersByTime(POINT_MS * 3)
    expect(data).not.toHaveBeenCalled() // a touch has no resting
    fireEvent.pointerDown(anchor, { pointerType: 'touch' })

    expect(data).toHaveBeenCalledTimes(1)
  })

  it('reads the address of the link it starts, search included', () => {
    const { routes, data } = pages()
    watch(routes)
    const anchor = link()
    anchor.href = '/results?result=hot&city=Perth'

    anchor.focus()

    const args = data.mock.calls[0] as unknown as [{ search: URLSearchParams }]
    expect(args[0].search.get('city')).toBe('Perth')
  })

  it('leaves alone links to another site, links that open a new tab and downloads', () => {
    const { routes, data } = pages()
    watch(routes)

    for (const anchor of [
      link({ href: 'https://example.com/start' }),
      link({ target: '_blank' }),
      link({ download: 'leads.csv' }),
    ]) {
      anchor.focus()
    }

    expect(data).not.toHaveBeenCalled()
  })

  it('does nothing on a connection that asks to save data', () => {
    const { routes, code, data } = pages()
    vi.stubGlobal('navigator', { ...navigator, connection: { saveData: true } })
    watch(routes)

    link().focus()

    expect(data).not.toHaveBeenCalled()
    expect(code).not.toHaveBeenCalled()
  })

  it('stops watching when told to', () => {
    const { routes, data } = pages()
    watch(routes)
    stop()

    link().focus()

    expect(data).not.toHaveBeenCalled()
  })
})
