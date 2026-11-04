import { act, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Run, RunEvent, RunStatus } from '@/api/types'
import { FakeEventSource } from '@/test/fake-event-source'
import { useRunEvents } from './useRunEvents'

const RUN_ID = '8a4d3a0e-0000-4000-8000-000000000001'

function event(seq: number, type: RunEvent['type'], data: Record<string, unknown> = {}): RunEvent {
  return { seq, type, created_at: '2026-10-26T04:00:00Z', data } as unknown as RunEvent
}

const COUNTS = {
  slices: 0,
  slices_done: 0,
  slices_failed: 0,
  candidates: 0,
  unique: 0,
  chosen: 0,
  researched: 1,
  skipped: 0,
  failed: 0,
  by_result: { pass: 1 },
  resumes: 0,
}

function run(status: RunStatus): Run {
  return {
    id: RUN_ID,
    app: 'lead_finder',
    mode: 'discovery',
    status,
    params: {},
    caps: { run_cap_usd: '20', max_companies: 20, company_cap_usd: '2.5', discovery_cap_usd: '8' },
    rules_version: 'r',
    prompt_versions: 'p',
    cost_usd: '1.2',
    web_searches: 3,
    claude_requests: 3,
    counts: COUNTS,
    stop_reason: null,
    error: null,
    error_id: null,
    schedule_id: null,
    cancel_requested_at: null,
    created_at: '2026-10-26T04:00:00Z',
    started_at: '2026-10-26T04:00:01Z',
    finished_at: status === 'running' || status === 'queued' ? null : '2026-10-26T04:05:00Z',
  }
}

/** Answers `GET /runs/{id}` with each status in turn (the last one repeats). */
function mockRunPolls(...answers: Array<RunStatus | Response | Error>) {
  let call = 0
  const mock = vi.fn((_request: Request) => {
    const answer = answers[Math.min(call, answers.length - 1)]
    call += 1
    if (answer instanceof Error) {
      return Promise.reject(answer)
    }
    if (answer instanceof Response) {
      return Promise.resolve(answer.clone())
    }
    return Promise.resolve(Response.json(run(answer ?? 'running')))
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

function deliver(source: FakeEventSource, ...events: RunEvent[]) {
  act(() => {
    for (const item of events) {
      source.emitMessage(item)
    }
  })
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function urlOf(source: FakeEventSource): string {
  return source.url
}

describe('useRunEvents: the stream', () => {
  it('opens the stream for the run, after seq 0, and is not live until it opens', () => {
    const { result } = renderHook(() => useRunEvents(RUN_ID))

    expect(FakeEventSource.instances).toHaveLength(1)
    expect(urlOf(FakeEventSource.last())).toBe(`/api/v1/runs/${RUN_ID}/events?after=0`)
    expect(result.current.connection).toBe('reconnecting')
    expect(result.current.status).toBeNull()
    expect(result.current.state.lastSeq).toBe(0)

    act(() => {
      FakeEventSource.last().emitOpen()
    })

    expect(result.current.connection).toBe('live')
  })

  it('reads every message with onmessage, whatever the type, and builds the state', () => {
    const { result } = renderHook(() => useRunEvents(RUN_ID))
    const source = FakeEventSource.last()
    act(() => {
      source.emitOpen()
    })

    deliver(
      source,
      event(1, 'run_started', {
        mode: 'discovery',
        caps: {
          run_cap_usd: '20',
          max_companies: 20,
          company_cap_usd: '2.5',
          discovery_cap_usd: '8',
        },
        rules_version: 'r',
      }),
      event(2, 'company_started', { name: 'Acme' }),
      event(3, 'progress', {
        cost_usd: '0.42',
        web_searches: 2,
        claude_requests: 2,
        counts: COUNTS,
      }),
    )

    expect(result.current.state.lastSeq).toBe(3)
    expect(result.current.state.costUsd).toBe('0.42')
    expect(result.current.state.counts.researched).toBe(1)
    expect(result.current.state.inFlight).toEqual(['Acme'])
    expect(result.current.state.feed.map((item) => item.type)).toEqual([
      'run_started',
      'company_started',
    ])
    expect(result.current.status).toBe('running')
    expect(result.current.connection).toBe('live')
  })

  it('counts a message twice sent as one', () => {
    const { result } = renderHook(() => useRunEvents(RUN_ID))
    const source = FakeEventSource.last()

    deliver(
      source,
      event(1, 'company_started', { name: 'A' }),
      event(1, 'company_started', { name: 'A' }),
    )
    deliver(
      source,
      event(2, 'company_started', { name: 'B' }),
      event(1, 'company_started', { name: 'A' }),
    )

    expect(result.current.state.lastSeq).toBe(2)
    expect(result.current.state.feed).toHaveLength(2)
    expect(result.current.state.inFlight).toEqual(['A', 'B'])
  })

  it('ignores messages that are not events', () => {
    const { result } = renderHook(() => useRunEvents(RUN_ID))
    const source = FakeEventSource.last()

    act(() => {
      source.emitMessage('not json')
      source.emitMessage({ seq: 1, type: 'from_the_future', created_at: 'x', data: {} })
      source.emitMessage({ nope: true })
    })

    expect(result.current.state.lastSeq).toBe(0)
    expect(result.current.state.feed).toEqual([])
  })

  it('closes the stream on unmount', () => {
    const { unmount } = renderHook(() => useRunEvents(RUN_ID))
    const source = FakeEventSource.last()

    unmount()

    expect(source.closedByClient).toBe(true)
  })

  it('opens nothing without a run id, or when disabled, and says closed', () => {
    const none = renderHook(() => useRunEvents(undefined))
    const off = renderHook(() => useRunEvents(RUN_ID, { enabled: false }))

    expect(FakeEventSource.instances).toHaveLength(0)
    expect(none.result.current.connection).toBe('closed')
    expect(off.result.current.connection).toBe('closed')
  })

  it('starts over for another run, with its own stream and an empty state', () => {
    const { result, rerender } = renderHook(({ id }) => useRunEvents(id), {
      initialProps: { id: RUN_ID },
    })
    const first = FakeEventSource.last()
    deliver(first, event(1, 'company_started', { name: 'A' }))
    expect(result.current.state.lastSeq).toBe(1)

    rerender({ id: 'another-run' })

    expect(first.closedByClient).toBe(true)
    expect(urlOf(FakeEventSource.last())).toBe('/api/v1/runs/another-run/events?after=0')
    expect(result.current.state.lastSeq).toBe(0)
    expect(result.current.state.feed).toEqual([])
  })

  it('escapes the run id in the address', () => {
    renderHook(() => useRunEvents('a/b?c'))

    expect(urlOf(FakeEventSource.last())).toBe('/api/v1/runs/a%2Fb%3Fc/events?after=0')
  })
})

describe('useRunEvents: StrictMode', () => {
  it('survives a double mount: the first stream is closed, the second one works', () => {
    const { result } = renderHook(() => useRunEvents(RUN_ID), { wrapper: StrictMode })

    expect(FakeEventSource.instances).toHaveLength(2)
    const [first, second] = FakeEventSource.instances
    expect(first?.closedByClient).toBe(true)
    expect(second?.closedByClient).toBe(false)

    act(() => {
      second?.emitOpen()
    })
    deliver(second, event(1, 'company_started', { name: 'A' }))

    expect(result.current.connection).toBe('live')
    expect(result.current.state.feed).toHaveLength(1)
  })

  it('does not hear a message that arrives on the closed first stream', () => {
    const { result } = renderHook(() => useRunEvents(RUN_ID), { wrapper: StrictMode })
    const [first, second] = FakeEventSource.instances

    deliver(first, event(1, 'company_started', { name: 'Ghost' }))
    deliver(second, event(1, 'company_started', { name: 'Real' }))

    expect(result.current.state.inFlight).toEqual(['Real'])
  })
})

describe('useRunEvents: when the stream breaks', () => {
  it('asks GET /runs/{id}, then reopens with ?after=lastSeq while the run is going', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchMock = mockRunPolls('running')
    const { result } = renderHook(() => useRunEvents(RUN_ID))
    const first = FakeEventSource.last()
    act(() => {
      first.emitOpen()
    })
    deliver(
      first,
      event(1, 'run_started', { mode: 'discovery', rules_version: 'r' }),
      event(2, 'company_started', { name: 'A' }),
    )

    act(() => {
      first.emitError()
    })

    // The hook closes the stream itself, so the browser does not retry on its own.
    expect(first.closedByClient).toBe(true)
    expect(result.current.connection).toBe('reconnecting')
    expect(FakeEventSource.instances).toHaveLength(1)

    await tick(1000)

    const request = fetchMock.mock.calls[0]?.[0]
    expect(request && new URL(request.url).pathname).toBe(`/api/v1/runs/${RUN_ID}`)
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(urlOf(FakeEventSource.last())).toBe(`/api/v1/runs/${RUN_ID}/events?after=2`)
    expect(result.current.run?.status).toBe('running')

    act(() => {
      FakeEventSource.last().emitOpen()
    })
    expect(result.current.connection).toBe('live')
  })

  it('shows nothing twice when the new stream replays events it already sent', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockRunPolls('running')
    const { result } = renderHook(() => useRunEvents(RUN_ID))
    deliver(
      FakeEventSource.last(),
      event(1, 'company_started', { name: 'A' }),
      event(2, 'company_started', { name: 'B' }),
    )
    act(() => {
      FakeEventSource.last().emitError()
    })
    await tick(1000)

    deliver(
      FakeEventSource.last(),
      event(2, 'company_started', { name: 'B' }),
      event(3, 'company_started', { name: 'C' }),
    )

    expect(result.current.state.feed.map((item) => item.seq)).toEqual([1, 2, 3])
  })

  it('closes for good once run_finished was read and the run is over, with no new stream', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchMock = mockRunPolls('done')
    const { result } = renderHook(() => useRunEvents(RUN_ID))
    const source = FakeEventSource.last()
    deliver(
      source,
      event(1, 'run_started', { mode: 'discovery', rules_version: 'r' }),
      event(2, 'run_finished', {
        status: 'done',
        stop_reason: null,
        cost_usd: '1.25',
        counts: COUNTS,
      }),
    )

    // The server ends the stream after run_finished. The browser reports that as an error.
    act(() => {
      source.emitError()
    })
    expect(result.current.connection).toBe('reconnecting')
    await tick(0)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(result.current.connection).toBe('closed')
    expect(result.current.status).toBe('done')
    expect(result.current.state.finished).toBe(true)

    await tick(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('treats a 204 (the stream is refused for good) of a finished run as done', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchMock = mockRunPolls('cancelled')
    const { result } = renderHook(() => useRunEvents(RUN_ID))
    deliver(
      FakeEventSource.last(),
      event(1, 'run_finished', {
        status: 'cancelled',
        stop_reason: 'Stopped by a person',
        cost_usd: '1',
        counts: COUNTS,
      }),
    )

    act(() => {
      FakeEventSource.last().emitError({ closed: true })
    })
    await tick(0)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.connection).toBe('closed')
    expect(result.current.status).toBe('cancelled')
  })

  it('reads once more when the run is over but its end was never read, then stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchMock = mockRunPolls('failed')
    const { result } = renderHook(() => useRunEvents(RUN_ID))
    deliver(FakeEventSource.last(), event(1, 'company_started', { name: 'A' }))

    act(() => {
      FakeEventSource.last().emitError()
    })
    await tick(1000)

    // Over, but no run_finished was read: collect what is left.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(urlOf(FakeEventSource.last())).toBe(`/api/v1/runs/${RUN_ID}/events?after=1`)
    expect(result.current.status).toBe('failed')

    // The server sends the rest, with run_finished, and ends the stream.
    deliver(
      FakeEventSource.last(),
      event(2, 'run_finished', {
        status: 'failed',
        stop_reason: 'Claude is unavailable.',
        cost_usd: '0.1',
        counts: COUNTS,
      }),
    )
    act(() => {
      FakeEventSource.last().emitError()
    })
    await tick(0)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(result.current.connection).toBe('closed')
    expect(result.current.state.stopReason).toBe('Claude is unavailable.')
  })

  it('stops after one extra read when a finished run has no events left (204)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchMock = mockRunPolls('done')
    const { result } = renderHook(() => useRunEvents(RUN_ID))

    act(() => {
      FakeEventSource.last().emitError({ closed: true })
    })
    await tick(1000)
    expect(FakeEventSource.instances).toHaveLength(2)

    act(() => {
      FakeEventSource.last().emitError({ closed: true })
    })
    await tick(2000)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(result.current.connection).toBe('closed')
    expect(result.current.status).toBe('done')
  })

  it('keeps the run live when it was resumed after a finished run in the replay', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockRunPolls('running')
    const { result } = renderHook(() => useRunEvents(RUN_ID))
    // A replay: the old end, then the resume, then the stream breaks.
    deliver(
      FakeEventSource.last(),
      event(1, 'run_finished', {
        status: 'interrupted',
        stop_reason: 'x',
        cost_usd: '1',
        counts: COUNTS,
      }),
      event(2, 'run_resumed', { from_status: 'interrupted' }),
    )
    act(() => {
      FakeEventSource.last().emitError()
    })
    await tick(1000)

    expect(FakeEventSource.instances).toHaveLength(2)
    expect(result.current.status).toBe('running')
    expect(result.current.connection).toBe('reconnecting')
  })

  it('stops with an error when the run is unknown (404)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchMock = mockRunPolls(
      new Response(JSON.stringify({ title: 'Not found', status: 404, detail: 'No such run.' }), {
        status: 404,
        headers: { 'content-type': 'application/problem+json' },
      }),
    )
    const { result } = renderHook(() => useRunEvents(RUN_ID))

    act(() => {
      FakeEventSource.last().emitError({ closed: true })
    })
    await tick(1000)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.connection).toBe('closed')
    expect(result.current.error?.status).toBe(404)
    expect(result.current.error?.title).toBe('Not found')
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('waits longer each time the backend cannot be reached, and starts again from 1 s after a good open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchMock = mockRunPolls(new TypeError('Failed to fetch'))
    const { result } = renderHook(() => useRunEvents(RUN_ID))

    act(() => {
      FakeEventSource.last().emitError()
    })
    await tick(999)
    expect(fetchMock).toHaveBeenCalledTimes(0)
    await tick(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.error?.status).toBe(0)
    expect(result.current.connection).toBe('reconnecting')

    // The second wait is 2 s, the third 4 s.
    await tick(1999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await tick(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await tick(3999)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await tick(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('caps the wait at the longest backoff', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchMock = mockRunPolls(new TypeError('Failed to fetch'))
    renderHook(() => useRunEvents(RUN_ID, { backoffMs: 1000, maxBackoffMs: 3000 }))

    act(() => {
      FakeEventSource.last().emitError()
    })
    await tick(1000)
    await tick(2000)
    await tick(3000)
    await tick(3000)

    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('resets the wait after the stream opens again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchMock = mockRunPolls('running')
    renderHook(() => useRunEvents(RUN_ID))

    act(() => {
      FakeEventSource.last().emitError()
    })
    await tick(1000)
    act(() => {
      FakeEventSource.last().emitOpen()
      FakeEventSource.last().emitError()
    })
    // Back to 1 s, not 2 s.
    await tick(1000)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('stops waiting, and asks nothing more, after unmount', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchMock = mockRunPolls('running')
    const { unmount } = renderHook(() => useRunEvents(RUN_ID))
    act(() => {
      FakeEventSource.last().emitError()
    })

    unmount()
    await tick(60_000)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('takes the final status from the poll even when the events never said it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockRunPolls('cancelled')
    const { result } = renderHook(() => useRunEvents(RUN_ID))
    deliver(
      FakeEventSource.last(),
      event(1, 'run_started', { mode: 'discovery', rules_version: 'r' }),
    )
    expect(result.current.status).toBe('running')

    act(() => {
      FakeEventSource.last().emitError()
    })
    await tick(1000)

    expect(result.current.state.status).toBe('running')
    expect(result.current.status).toBe('cancelled')
  })
})
