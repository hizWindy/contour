import { useQueryClient } from '@tanstack/react-query'
import { screen } from '@testing-library/react'
import { useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { FakeEventSource } from './fake-event-source'
import { renderWithProviders } from './render'

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
