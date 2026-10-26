/**
 * `useRunEvents(runId)`: the live feed of one run.
 *
 * It opens a server-sent events stream on `/api/v1/runs/{id}/events?after=<lastSeq>`. The server
 * sends one JSON `RunEvent` in each message and no `event:` line, so the hook reads every message
 * with `onmessage` and switches on `data.type` (in the reducer, `run-events.ts`).
 *
 * What it does when the connection breaks, or ends:
 *  1. It closes the stream itself (the browser's own retry would ignore a 204 and keep trying).
 *  2. It waits (right away when the last event was `run_finished`, otherwise 1 s, then 2 s, 4 s ...
 *     up to 15 s) and asks `GET /runs/{id}` for the truth.
 *  3. A run that is still going: it reopens the stream with `?after=<lastSeq>`, so no event is
 *     missed and none is counted twice (events are deduplicated by `seq`).
 *  4. A run that has ended and whose `run_finished` was seen: done, the connection is `closed`.
 *     A run that has ended but whose end was not seen: one more read of the stream, to collect
 *     what is left, then done.
 *  5. A 4xx from the poll (404 for an unknown run) stops with `error` set. A network error or a
 *     5xx keeps trying with the backoff.
 *
 * It closes on unmount, and it is safe under React StrictMode (two mounts open two streams, the
 * first one is closed again at once).
 *
 * `connection` is `live` while the stream is open, `reconnecting` while it is being (re)opened or
 * waiting to retry, and `closed` when there is nothing more to read.
 */
import { useEffect, useReducer, useRef } from 'react'
import { API_BASE_URL, api, isAbort, toApiProblem, unwrap, type ApiProblem } from '@/api/client'
import type { Run, RunEvent, RunStatus } from '@/api/types'
import { isTerminalRunStatus } from '@/lib/labels'
import {
  initialRunEventsState,
  parseRunEvent,
  runEventsReducer,
  type RunEventsState,
} from './run-events'

export {
  describeEvent,
  foldRunEvents,
  initialRunEventsState,
  parseRunEvent,
  runEventsReducer,
  type FeedItem,
  type FeedTone,
  type RunEventsAction,
  type RunEventsState,
  type SliceState,
} from './run-events'

export type RunConnection = 'live' | 'reconnecting' | 'closed'

export interface UseRunEventsOptions {
  /** Pass `false` to keep the stream closed (for example while the run id is not known yet). */
  enabled?: boolean
  /** The first wait before a retry, in milliseconds. It doubles each time. Default 1000. */
  backoffMs?: number
  /** The longest wait before a retry, in milliseconds. Default 15000. */
  maxBackoffMs?: number
}

export interface UseRunEventsResult {
  state: RunEventsState
  connection: RunConnection
  /** The run's status: from the last poll when the run has ended, otherwise from the events. */
  status: RunStatus | null
  /** The run as the last poll saw it. `null` until the stream has broken once. */
  run: Run | null
  /** Set when the run could not be read (for example 404, an unknown run). */
  error: ApiProblem | null
}

interface Store {
  runId: string | null
  state: RunEventsState
  connection: RunConnection
  run: Run | null
  error: ApiProblem | null
}

type StoreAction = { runId: string } & (
  | { type: 'event'; event: RunEvent }
  | { type: 'connection'; connection: RunConnection }
  | { type: 'run'; run: Run }
  | { type: 'error'; error: ApiProblem }
)

/** What the stream and the poll report. The hook adds the run id. */
type StoreMessage = StoreAction extends infer A
  ? A extends unknown
    ? Omit<A, 'runId'>
    : never
  : never

function freshStore(runId: string | null): Store {
  return {
    runId,
    state: initialRunEventsState,
    connection: 'reconnecting',
    run: null,
    error: null,
  }
}

function storeReducer(store: Store, action: StoreAction): Store {
  // An action for a run id that is no longer the current one starts over from nothing.
  const base = store.runId === action.runId ? store : freshStore(action.runId)
  switch (action.type) {
    case 'event': {
      const state = runEventsReducer(base.state, { type: 'event', event: action.event })
      return state === base.state ? base : { ...base, state, connection: 'live' }
    }
    case 'connection':
      return base.connection === action.connection
        ? base
        : { ...base, connection: action.connection }
    case 'run':
      return { ...base, run: action.run, error: null }
    case 'error':
      return { ...base, error: action.error }
  }
}

const DEFAULT_BACKOFF_MS = 1000
const DEFAULT_MAX_BACKOFF_MS = 15_000

export function useRunEvents(
  runId: string | null | undefined,
  options: UseRunEventsOptions = {},
): UseRunEventsResult {
  const enabled = (options.enabled ?? true) && typeof runId === 'string' && runId !== ''
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS

  const [store, dispatch] = useReducer(storeReducer, null, () => freshStore(runId ?? null))
  // The highest seq read for a run. It outlives an effect run, so a second mount asks for
  // `?after=<lastSeq>` and not for everything again.
  const seen = useRef<{ runId: string | null; seq: number }>({ runId: null, seq: 0 })

  useEffect(() => {
    if (!enabled || !runId) {
      return undefined
    }
    if (seen.current.runId !== runId) {
      seen.current = { runId, seq: 0 }
    }
    const progress = seen.current

    let disposed = false
    let source: EventSource | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    let attempt = 0
    let finishedSeen = false
    let reopenedAfterEnd = false

    const send = (message: StoreMessage): void => {
      if (!disposed) {
        dispatch({ runId, ...message })
      }
    }

    const stop = (): void => {
      source?.close()
      source = null
      send({ type: 'connection', connection: 'closed' })
    }

    const open = (): void => {
      if (disposed) {
        return
      }
      const url = `${API_BASE_URL}/runs/${encodeURIComponent(runId)}/events?after=${progress.seq}`
      const stream = new EventSource(url)
      source = stream
      stream.onopen = () => {
        attempt = 0
        send({ type: 'connection', connection: 'live' })
      }
      stream.onmessage = (message: MessageEvent) => {
        const event = parseRunEvent(typeof message.data === 'string' ? message.data : '')
        if (!event || event.seq <= progress.seq) {
          return
        }
        progress.seq = event.seq
        attempt = 0
        finishedSeen = event.type === 'run_finished'
        send({ type: 'event', event })
      }
      stream.onerror = () => {
        // The stream broke, or ended. Close it so the browser does not retry by itself.
        stream.close()
        if (source === stream) {
          source = null
        }
        streamEnded()
      }
    }

    const streamEnded = (): void => {
      if (disposed) {
        return
      }
      send({ type: 'connection', connection: 'reconnecting' })
      const delay = finishedSeen ? 0 : Math.min(backoffMs * 2 ** attempt, maxBackoffMs)
      attempt += 1
      timer = setTimeout(() => {
        void check()
      }, delay)
    }

    const check = async (): Promise<void> => {
      controller = new AbortController()
      let run: Run
      try {
        run = unwrap(
          await api.GET('/runs/{run_id}', {
            params: { path: { run_id: runId } },
            signal: controller.signal,
          }),
        )
      } catch (error) {
        if (disposed || isAbort(error)) {
          return
        }
        const problem = toApiProblem(error)
        send({ type: 'error', error: problem })
        const permanent = problem.status >= 400 && problem.status < 500 && problem.status !== 429
        if (permanent) {
          stop()
        } else {
          streamEnded()
        }
        return
      }
      if (disposed) {
        return
      }
      send({ type: 'run', run })
      if (isTerminalRunStatus(run.status)) {
        if (finishedSeen || reopenedAfterEnd) {
          stop()
          return
        }
        // The run is over but its end was not read. Read what is left once.
        reopenedAfterEnd = true
      } else {
        reopenedAfterEnd = false
      }
      open()
    }

    open()

    return () => {
      disposed = true
      source?.close()
      source = null
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      controller?.abort()
    }
  }, [enabled, runId, backoffMs, maxBackoffMs])

  const current = store.runId === (runId ?? null) ? store : freshStore(runId ?? null)
  const polled = current.run
  const status =
    polled && isTerminalRunStatus(polled.status)
      ? polled.status
      : (current.state.status ?? polled?.status ?? null)

  return {
    state: current.state,
    connection: enabled ? current.connection : 'closed',
    status,
    run: polled,
    error: current.error,
  }
}
