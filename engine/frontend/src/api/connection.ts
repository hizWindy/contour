/**
 * Whether the website can talk to Contour's server right now (PLAN-V15 T2-2, T2-4).
 *
 * One small store per query client holds the state: `online`, `offline` (the browser says so),
 * `updating` (a deploy: the proxy answers 502, 503 or 504 with no JSON, or the backend says it is
 * `starting`) or `unreachable` (a network error while the browser is online). Every failed query
 * and change feeds it (`createQueryClient` wires the caches), and any good answer puts it back to
 * `online`. The connection bar and the full error pages read it, so a page never has to.
 *
 * When the state comes back to `online`, the reads that failed run again by themselves. That is
 * how the account menu comes back after a deploy without a reload: `/auth/me` is one of them.
 *
 * A single slow answer (`timeout`) or a busy server (`busy`) is not a connection problem: the page
 * that asked shows it, and the rest of the site carries on.
 */
import { onlineManager, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect, useSyncExternalStore } from 'react'
import { api, isApiProblem, problemFromResponse, type ApiProblem } from './client'

export type ConnectionState = 'online' | 'offline' | 'updating' | 'unreachable'

/**
 * What kind of failure a thrown value is. `answer` is any other answer from the server (a 403, a
 * 404, a 409, a 422): the connection is fine. `null` is anything that isn't a failed call.
 */
export type ProblemKind =
  'offline' | 'unreachable' | 'timeout' | 'updating' | 'busy' | 'server' | 'answer'

/** How long between two checks while the server can't be reached or is updating. */
export const RETRY_EVERY_MS = 10_000

export function problemKind(error: unknown): ProblemKind | null {
  if (!isApiProblem(error)) {
    return null
  }
  return kindOf(error)
}

function kindOf(problem: ApiProblem): ProblemKind {
  switch (problem.code) {
    case 'offline':
    case 'unreachable':
    case 'timeout':
    case 'updating':
      return problem.code
  }
  if (problem.status === 503 && problem.code === 'busy') {
    return 'busy'
  }
  if (problem.status === 503 && problem.code === 'starting') {
    return 'updating'
  }
  if (problem.status >= 500 && problem.status !== 501) {
    return 'server'
  }
  return 'answer'
}

/** The state a failure puts the connection in, or `null` when the connection is fine. */
function stateFor(kind: ProblemKind | null): Exclude<ConnectionState, 'online'> | null {
  return kind === 'offline' || kind === 'unreachable' || kind === 'updating' ? kind : null
}

export interface ConnectionSnapshot {
  state: ConnectionState
  /** When the next automatic check runs (ms since 1970), while one is waiting. */
  nextCheckAt: number | null
}

const ONLINE: ConnectionSnapshot = { state: 'online', nextCheckAt: null }

/** The store. Made by `connectionOf`, one per query client. */
export class Connection {
  private snapshot: ConnectionSnapshot = ONLINE
  private readonly listeners = new Set<() => void>()
  private checking: Promise<boolean> | null = null
  private readonly onBack: () => void

  constructor(onBack: () => void) {
    this.onBack = onBack
  }

  readonly get = (): ConnectionSnapshot => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Moves to `state`. Back to `online` from anything else runs the failed reads again. */
  set(state: ConnectionState, nextCheckAt: number | null = null): void {
    const was = this.snapshot
    if (was.state === state && was.nextCheckAt === nextCheckAt) {
      return
    }
    this.snapshot = state === 'online' ? ONLINE : { state, nextCheckAt }
    for (const listener of this.listeners) {
      listener()
    }
    if (was.state !== 'online' && state === 'online') {
      this.onBack()
    }
  }

  /** A failed query or change. Only the connection's own failures change the state. */
  readonly noteError = (error: unknown): void => {
    const next = stateFor(problemKind(error))
    if (next && next !== this.snapshot.state) {
      this.set(next)
    }
  }

  /** Any good answer: the server is there. */
  readonly noteSuccess = (): void => {
    this.set('online')
  }

  /**
   * Asks the server's health route once. True when it answered (any answer that isn't a
   * connection failure), and the state is then `online`. One check at a time.
   */
  check(): Promise<boolean> {
    this.checking ??= this.askHealth().finally(() => {
      this.checking = null
    })
    return this.checking
  }

  private async askHealth(): Promise<boolean> {
    if (!onlineManager.isOnline()) {
      this.set('offline')
      return false
    }
    let failure: Exclude<ConnectionState, 'online'> | null = null
    try {
      const { response, error } = await api.GET('/health')
      if (!response.ok) {
        failure = stateFor(problemKind(problemFromResponse(response, error)))
      }
    } catch (error) {
      failure = stateFor(problemKind(error)) ?? 'unreachable'
    }
    if (failure === null) {
      // The server answered. A 503 with JSON (its database is out of reach) is still an answer:
      // each page says what it couldn't load.
      this.set('online')
      return true
    }
    this.set(failure)
    return false
  }
}

const connections = new WeakMap<QueryClient, Connection>()

/** The reads that failed and are on screen now, asked again. */
function runFailedReadsAgain(client: QueryClient): void {
  void client.refetchQueries({
    type: 'active',
    predicate: (query) => query.state.status === 'error',
  })
}

/** The store for this query client, made on first use. */
export function connectionOf(client: QueryClient): Connection {
  let connection = connections.get(client)
  if (!connection) {
    connection = new Connection(() => {
      runFailedReadsAgain(client)
    })
    connections.set(client, connection)
  }
  return connection
}

/** The connection's state, for a part that only reads it. */
export function useConnection(): ConnectionSnapshot {
  const connection = connectionOf(useQueryClient())
  return useSyncExternalStore(connection.subscribe, connection.get, connection.get)
}

/**
 * The state, plus the automatic checks. Used once, by the connection bar (T2-4):
 * - the browser going offline sets `offline`; coming back online checks the server at once;
 * - while `updating` or `unreachable`, the server is checked every 10 seconds;
 * - back to `online`, the failed reads run again (`Connection.set`).
 */
export function useConnectionWatch(): ConnectionSnapshot & { checkNow: () => void } {
  const connection = connectionOf(useQueryClient())
  const snapshot = useSyncExternalStore(connection.subscribe, connection.get, connection.get)

  useEffect(() => {
    if (!onlineManager.isOnline()) {
      connection.set('offline')
    }
    return onlineManager.subscribe((online) => {
      if (online) {
        void connection.check()
      } else {
        connection.set('offline')
      }
    })
  }, [connection])

  const { state } = snapshot
  useEffect(() => {
    if (state !== 'updating' && state !== 'unreachable') {
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const wait = (): void => {
      const at = Date.now() + RETRY_EVERY_MS
      connection.set(state, at)
      timer = setTimeout(() => {
        void connection.check().then((back) => {
          if (!back && !stopped && connection.get().state === state) {
            wait()
          }
        })
      }, RETRY_EVERY_MS)
    }
    wait()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [connection, state])

  return {
    ...snapshot,
    checkNow: () => {
      void connection.check()
    },
  }
}
