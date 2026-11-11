/**
 * The one way the website talks to the backend.
 *
 * `api` is a typed openapi-fetch client. Its paths and types come from `openapi.json` (run
 * `npm run types` after the backend contract changes). The base URL is the relative `/api/v1`,
 * never an absolute address: in development Vite proxies `/api` to the backend, and a test checks
 * that no source file holds the backend's address.
 *
 * A failed call becomes an `ApiProblem` (title, detail, code, status, field errors, run id,
 * request id). Use `unwrap(await api.GET(...))` to get the data or throw the problem. TanStack
 * Query catches the throw, and `ErrorState` shows it.
 *
 * Every call has a time limit (PLAN-V15 T2-2): 20 seconds for the server to start answering, more
 * for an upload, a CSV download or a long change (`timeLimitFor`). A call that runs out becomes a
 * `timeout` problem. A failure to reach the server becomes `offline` (the browser says so) or
 * `unreachable`. A deploy's proxy page (a 502, 503 or 504 with no JSON) becomes `updating`. Only
 * these four codes are made here; every other code is the backend's own. The words are in
 * `words.ts`.
 */
import createClient from 'openapi-fetch'
import type { FieldError, paths } from './types'
import { plainFieldMessage, statusWords, WORDS, type Words } from './words'

export const API_BASE_URL = '/api/v1'

/** What a failed call says, in the shape of the backend's `ProblemDetails`. */
export interface ApiProblemFields {
  title: string
  detail?: string | null
  code?: string | null
  status: number
  errors?: FieldError[]
  run_id?: string | null
  /** Why a session ended, on a 401 `auth_required`: `idle`, `expired` or `ended`. */
  reason?: string | null
  /**
   * How long to wait before trying again: from a sign-in's 401 or 429 (PLAN-V6 B4), or the
   * `Retry-After` header of a 503 (PLAN-V15).
   */
  retry_after_seconds?: number | null
  /** The code that ties this to a line in the backend's log, like `7F3K92QD` (PLAN-V15 T1-2). */
  request_id?: string | null
}

/**
 * A failed API call. `title` is short and safe to show. `detail` says what to do next. `code` is
 * a stable word to switch on (`run_already_active`). `status` is the HTTP status, or 0 when the
 * backend could not be reached at all. `errors` lists the wrong fields of a 422. `run_id` is set
 * when the problem is about a run (a 409 `run_already_active` names the run that is going).
 * `reason` and `retry_after_seconds` come with the sign-in's answers (PLAN-V6 B3, B4) and a 503.
 * `request_id` is the code to send to an admin, and `at` is when it happened.
 */
export class ApiProblem extends Error {
  readonly title: string
  readonly detail: string | null
  readonly code: string | null
  readonly status: number
  readonly errors: FieldError[]
  readonly run_id: string | null
  readonly reason: string | null
  readonly retry_after_seconds: number | null
  readonly request_id: string | null
  readonly at: Date

  constructor(fields: ApiProblemFields) {
    super(fields.detail ? `${fields.title}. ${fields.detail}` : fields.title)
    this.name = 'ApiProblem'
    this.title = fields.title
    this.detail = fields.detail ?? null
    this.code = fields.code ?? null
    this.status = fields.status
    this.errors = fields.errors ?? []
    this.run_id = fields.run_id ?? null
    this.reason = fields.reason ?? null
    this.retry_after_seconds = fields.retry_after_seconds ?? null
    this.request_id = fields.request_id ?? null
    this.at = new Date()
  }
}

/** True for the 401 a route gives when no one is signed in (or the session ended). */
export function isSignInNeeded(value: unknown): value is ApiProblem {
  return value instanceof ApiProblem && value.status === 401 && value.code === 'auth_required'
}

export function isApiProblem(value: unknown): value is ApiProblem {
  return value instanceof ApiProblem
}

/** True for the error fetch throws when a request is cancelled (a component left the page). */
export function isAbort(value: unknown): boolean {
  // Not `instanceof DOMException`: the page and Node have different DOMException classes.
  return (
    typeof value === 'object' && value !== null && 'name' in value && value.name === 'AbortError'
  )
}

function made(words: Words, code: string, status = 0): ApiProblem {
  return new ApiProblem({ ...words, code, status })
}

/** True when the browser says it has no network. A browser that can't tell counts as online. */
function browserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/**
 * The problem for a server that can't be reached at all (status 0): `offline` when the browser
 * says so, else `unreachable`.
 */
export function networkProblem(): ApiProblem {
  return browserOffline() ? made(WORDS.offline, 'offline') : made(WORDS.unreachable, 'unreachable')
}

/** The problem for a call that ran out of time (status 0, code `timeout`). */
export function timeoutProblem(): ApiProblem {
  return made(WORDS.timeout, 'timeout')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** A safe request id: up to 64 letters, digits and dashes (the backend's own rule). */
function asRequestId(value: unknown): string | null {
  const text = asText(value)?.trim() ?? null
  return text && /^[A-Za-z0-9-]{1,64}$/.test(text) ? text : null
}

function readFieldErrors(value: unknown): FieldError[] {
  if (!Array.isArray(value)) {
    return []
  }
  const found: FieldError[] = []
  for (const item of value) {
    if (isRecord(item)) {
      const message = asText(item.message) ?? asText(item.msg)
      if (message) {
        const field = asText(item.field) ?? (Array.isArray(item.loc) ? item.loc.join('.') : null)
        found.push({ field: field ?? '', message: plainFieldMessage(message) })
      }
    }
  }
  return found
}

/** Seconds to wait, from the body's `retry_after_seconds` or the `Retry-After` header. */
function readRetryAfter(response: Response, record: Record<string, unknown>): number | null {
  const fromBody = record.retry_after_seconds
  if (typeof fromBody === 'number' && Number.isFinite(fromBody) && fromBody >= 0) {
    return fromBody
  }
  const header = response.headers.get('retry-after')?.trim()
  if (header && /^\d+$/.test(header)) {
    return Number(header)
  }
  return null
}

/** A deploy's proxy answers 502, 503 or 504 with its own page, not the backend's JSON. */
const UPDATING_STATUSES = new Set([502, 503, 504])

/**
 * Builds the problem for a failed response. `body` is what openapi-fetch parsed: the backend's
 * `ProblemDetails`, or plain text (a proxy's error page) that is never shown to a person. The
 * status decides the words when the body has none.
 */
export function problemFromResponse(response: Response, body?: unknown): ApiProblem {
  const status = response.status
  const json = isRecord(body)
  const record = json ? body : {}
  const requestId =
    asRequestId(record.request_id) ?? asRequestId(response.headers.get('x-request-id'))
  const retryAfter = readRetryAfter(response, record)
  if (!json && UPDATING_STATUSES.has(status)) {
    return new ApiProblem({
      ...WORDS.updating,
      code: 'updating',
      status,
      request_id: requestId,
      retry_after_seconds: retryAfter,
    })
  }
  // The backend's own words win. FastAPI's `{detail: "text"}` is accepted too.
  const fallback = statusWords(status, requestId)
  return new ApiProblem({
    title: asText(record.title) ?? fallback?.title ?? "That didn't work",
    detail: asText(record.detail) ?? fallback?.detail ?? 'Try again.',
    code: asText(record.code),
    status,
    errors: readFieldErrors(record.errors ?? record.detail),
    run_id: asText(record.run_id),
    reason: asText(record.reason),
    retry_after_seconds: retryAfter,
    request_id: requestId,
  })
}

/**
 * Any thrown value as an `ApiProblem`. A failed call is already one (the client below makes the
 * network, time limit and proxy problems). Anything else broke in the page's own code, which says
 * nothing about the connection, so it never reads "can't reach the server". Nothing from an
 * unknown error is shown, because it could hold text the person should not see.
 */
export function toApiProblem(error: unknown): ApiProblem {
  if (error instanceof ApiProblem) {
    return error
  }
  return made(WORDS.page, 'page_error')
}

interface ApiResult<Data> {
  data?: Data
  error?: unknown
  response: Response
}

/**
 * Returns the data of an openapi-fetch result, or throws the `ApiProblem`.
 *
 *     const run = unwrap(await api.GET('/runs/{run_id}', { params: { path: { run_id } } }))
 *
 * A 204 has no body, so `data` is `undefined` there.
 */
export function unwrap<Data>(result: ApiResult<Data>): Data {
  if (result.error !== undefined || !result.response.ok) {
    throw problemFromResponse(result.response, result.error)
  }
  return result.data as Data
}

/** Field errors by field name, for a form: `{ cities: 'Pick at least one city.' }`. */
export function fieldErrorMap(
  problem: ApiProblem,
  prefixes: readonly string[] = ['body.params.', 'body.', 'values.', 'query.'],
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const { field, message } of problem.errors) {
    const prefix = prefixes.find((candidate) => field.startsWith(candidate))
    const name = prefix ? field.slice(prefix.length) : field
    if (!(name in map)) {
      map[name] = message
    }
  }
  return map
}

/*
  Time limits, in ms: how long the server has to start answering (TBC: PLAN-V15 T2-2). The body
  then arrives with no limit, so a big CSV is never cut off halfway.
*/
export const TIME_LIMITS = {
  /** Every read and most changes. */
  normal: 20_000,
  /** An upload, a CSV download, and a change that writes to HubSpot. */
  long: 120_000,
  /** Rebuilding every HubSpot profile, which embeds them all inside the request. */
  rebuild: 600_000,
} as const

const LONG_CALLS: readonly [string, RegExp, number][] = [
  ['POST', /\/hubspot\/import$/, TIME_LIMITS.long],
  ['POST', /\/hubspot\/profiles\/rebuild$/, TIME_LIMITS.rebuild],
  ['GET', /\/lead-finder\/leads\/export$/, TIME_LIMITS.long],
  ['POST', /\/lead-finder\/review\/send$/, TIME_LIMITS.long],
  ['POST', /\/lead-finder\/leads\/[^/]+\/hubspot\/send$/, TIME_LIMITS.long],
]

/** The time limit for one call, or `null` for none (a live stream of updates). */
export function timeLimitFor(request: Request): number | null {
  if (request.headers.get('accept')?.includes('text/event-stream')) {
    return null
  }
  const path = new URL(request.url).pathname
  const long = LONG_CALLS.find(
    ([method, pattern]) => method === request.method && pattern.test(path),
  )
  return long ? long[2] : TIME_LIMITS.normal
}

/**
 * Calls `fetchFn` with the request's own cancel signal and the time limit joined in one. A
 * cancel (the page left) stays an `AbortError`; the time limit running out is a `timeout`
 * problem; any other failure to fetch is `offline` or `unreachable`.
 */
async function fetchWithLimit(fetchFn: typeof fetch, request: Request): Promise<Response> {
  const limit = timeLimitFor(request)
  const controller = new AbortController()
  const outer = request.signal
  const forward = (): void => {
    controller.abort(outer.reason)
  }
  if (outer.aborted) {
    forward()
  } else {
    outer.addEventListener('abort', forward, { once: true })
  }
  let timedOut = false
  const timer =
    limit === null
      ? undefined
      : setTimeout(() => {
          timedOut = true
          controller.abort()
        }, limit)
  try {
    return await fetchFn(new Request(request, { signal: controller.signal }))
  } catch (error) {
    if (timedOut) {
      throw timeoutProblem()
    }
    if (isAbort(error)) {
      throw error
    }
    throw networkProblem()
  } finally {
    clearTimeout(timer)
    outer.removeEventListener('abort', forward)
  }
}

export interface ApiClientOptions {
  /** A fetch to use instead of the global one. For tests. */
  fetch?: typeof fetch
}

/**
 * Makes a client. The app uses the shared `api` below. The global fetch is looked up on every
 * call, so a test can replace it with `vi.stubGlobal('fetch', ...)` at any time.
 */
export function createApiClient(options: ApiClientOptions = {}) {
  return createClient<paths>({
    baseUrl: API_BASE_URL,
    fetch: (request) => fetchWithLimit(options.fetch ?? globalThis.fetch, request),
  })
}

export const api = createApiClient()

/** A new key for the `Idempotency-Key` header of `POST /runs`, so a double click starts one run. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID()
}

/**
 * Sends a HubSpot export (.xlsx) to `POST /hubspot/import`.
 *
 * The upload is `multipart/form-data`. openapi-typescript types the file field as a string, so
 * the typed body carries the file's name and the custom `bodySerializer` builds the real
 * `FormData` from the `File`. The browser then sets the content type and the boundary itself.
 */
export function uploadHubspotExport(file: File, client: typeof api = api) {
  return client.POST('/hubspot/import', {
    body: { file: file.name },
    bodySerializer: () => hubspotUploadForm(file),
  })
}

/** The form a HubSpot export goes in. Exported so a test can read it back. */
export function hubspotUploadForm(file: File): FormData {
  const form = new FormData()
  form.append('file', file, file.name)
  return form
}
