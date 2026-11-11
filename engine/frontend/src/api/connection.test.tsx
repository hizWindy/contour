/**
 * The request layer's shared parts (PLAN-V15 T2-2): what kind of failure a problem is, which
 * reads are retried and after how long, the connection state that every failed call feeds, and
 * `/auth/me` asked again after a failure.
 */
import {
  onlineManager,
  QueryClientProvider,
  useQuery,
  type QueryClient,
} from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signedIn, SAMPLE_USER } from '@/test/fake-auth'
import { createTestQueryClient } from '@/test/render'
import { api, ApiProblem, unwrap } from './client'
import { connectionOf, problemKind, RETRY_EVERY_MS, useConnectionWatch } from './connection'
import { meQueryOptions } from './hooks'
import { createQueryClient, retryDelay, shouldRetry } from './query'

const problem = (status: number, code: string | null = null, retryAfter: number | null = null) =>
  new ApiProblem({ title: 't', status, code, retry_after_seconds: retryAfter })

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

/** A fetch whose answers the test switches: down (a network error) or up (`/health` is ok). */
function switchableBackend() {
  const backend = { up: false, calls: [] as string[] }
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request) => {
      const path = new URL(request.url).pathname
      backend.calls.push(path)
      if (!backend.up) return Promise.reject(new TypeError('Failed to fetch'))
      return Promise.resolve(Response.json({ status: 'ok', path }))
    }),
  )
  return backend
}

afterEach(() => {
  onlineManager.setOnline(true)
})

describe('what kind of failure it is', () => {
  it('tells the cases apart', () => {
    expect(problemKind(problem(0, 'offline'))).toBe('offline')
    expect(problemKind(problem(0, 'unreachable'))).toBe('unreachable')
    expect(problemKind(problem(0, 'timeout'))).toBe('timeout')
    expect(problemKind(problem(502, 'updating'))).toBe('updating')
    expect(problemKind(problem(503, 'starting'))).toBe('updating')
    expect(problemKind(problem(503, 'busy'))).toBe('busy')
    expect(problemKind(problem(500))).toBe('server')
    expect(problemKind(problem(503, 'runs_not_ready'))).toBe('server')
    expect(problemKind(problem(404))).toBe('answer')
    expect(problemKind(problem(501))).toBe('answer')
    expect(problemKind(new TypeError('a bug in page code'))).toBeNull()
  })
})

describe('which reads are retried', () => {
  it('retries when trying again could help', () => {
    for (const failed of [
      problem(0, 'offline'),
      problem(0, 'unreachable'),
      problem(0, 'timeout'),
      problem(502, 'updating'),
      problem(503, 'busy'),
      problem(500),
    ]) {
      expect(shouldRetry(0, failed), failed.code ?? String(failed.status)).toBe(true)
    }
  })

  it('never retries an answer, a page bug or a cancel, and stops after two tries', () => {
    expect(shouldRetry(0, problem(404))).toBe(false)
    expect(shouldRetry(0, problem(422))).toBe(false)
    expect(shouldRetry(0, problem(501))).toBe(false)
    expect(shouldRetry(0, new TypeError('bug'))).toBe(false)
    expect(shouldRetry(0, Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(false)
    expect(shouldRetry(2, problem(500))).toBe(false)
  })

  it("waits for the server's Retry-After, at most 30 s; 5 s while updating; else 1 s, then 2 s", () => {
    expect(retryDelay(0, problem(503, 'busy', 5))).toBe(5000)
    expect(retryDelay(0, problem(503, 'busy', 600))).toBe(30_000)
    expect(retryDelay(0, problem(502, 'updating'))).toBe(5000)
    expect(retryDelay(0, problem(500))).toBe(1000)
    expect(retryDelay(1, problem(500))).toBe(2000)
  })
})

describe('the connection state', () => {
  it('is fed by every failed read, and back online runs the failed reads again', async () => {
    const backend = switchableBackend()
    const client = createQueryClient()
    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['leads'],
          queryFn: async () => unwrap(await api.GET('/lead-finder/leads')),
          retry: false,
        }),
      { wrapper: wrapperFor(client) },
    )

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
    expect(connectionOf(client).get().state).toBe('unreachable')

    backend.up = true
    await client.fetchQuery({ queryKey: ['other'], queryFn: () => Promise.resolve('ok') })

    expect(connectionOf(client).get().state).toBe('online')
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(backend.calls.filter((path) => path === '/api/v1/lead-finder/leads')).toHaveLength(2)
  })

  it('is fed by failed changes too', async () => {
    switchableBackend()
    const client = createQueryClient()

    await client
      .getMutationCache()
      .build(client, {
        mutationFn: async () => unwrap(await api.POST('/memory', { body: {} as never })),
      })
      .execute(undefined)
      .catch(() => undefined)

    expect(connectionOf(client).get().state).toBe('unreachable')
  })

  it('ignores a single slow answer, a busy server and a 404: the page shows those itself', () => {
    const connection = connectionOf(createTestQueryClient())

    connection.noteError(problem(0, 'timeout'))
    connection.noteError(problem(503, 'busy'))
    connection.noteError(problem(404))
    connection.noteError(problem(500))

    expect(connection.get().state).toBe('online')
  })

  it('goes offline with the browser, and checks the server when it comes back', async () => {
    const backend = switchableBackend()
    const client = createTestQueryClient()
    const { result } = renderHook(() => useConnectionWatch(), { wrapper: wrapperFor(client) })

    act(() => {
      onlineManager.setOnline(false)
    })
    expect(result.current.state).toBe('offline')

    backend.up = true
    act(() => {
      onlineManager.setOnline(true)
    })

    await waitFor(() => {
      expect(result.current.state).toBe('online')
    })
    expect(backend.calls).toContain('/api/v1/health')
  })

  it("checks the server every 10 seconds while it can't be reached", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const backend = switchableBackend()
    const client = createTestQueryClient()
    const { result } = renderHook(() => useConnectionWatch(), { wrapper: wrapperFor(client) })

    act(() => {
      connectionOf(client).noteError(problem(0, 'unreachable'))
    })
    expect(result.current.state).toBe('unreachable')
    expect(result.current.nextCheckAt).not.toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETRY_EVERY_MS)
    })
    expect(backend.calls.filter((path) => path === '/api/v1/health')).toHaveLength(1)
    expect(result.current.state).toBe('unreachable')

    backend.up = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETRY_EVERY_MS)
    })
    await waitFor(() => {
      expect(result.current.state).toBe('online')
    })
  })
})

describe('/auth/me (the account menu)', () => {
  it('is asked again after a failure, and ends signed in', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        calls += 1
        if (calls === 1) return Promise.reject(new TypeError('Failed to fetch'))
        return Promise.resolve(signedIn())
      }),
    )
    const client = createTestQueryClient()

    const me = client.fetchQuery(meQueryOptions())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    await expect(me).resolves.toEqual({ state: 'signed_in', user: SAMPLE_USER })
    expect(calls).toBe(2)
  })
})
