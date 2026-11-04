/**
 * The one way the website talks to the backend.
 *
 * `api` is a typed openapi-fetch client. Its paths and types come from `openapi.json` (run
 * `npm run types` after the backend contract changes). The base URL is the relative `/api/v1`,
 * never an absolute address: in development Vite proxies `/api` to the backend, and a test checks
 * that no source file holds the backend's address.
 *
 * A failed call becomes an `ApiProblem` (title, detail, code, status, field errors, run id). Use
 * `unwrap(await api.GET(...))` to get the data or throw the problem. TanStack Query catches the
 * throw, and `ErrorState` shows it.
 */
import createClient from 'openapi-fetch'
import type { FieldError, paths } from './types'

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
  /** How long to wait before the next sign-in try, on a 401 or a 429 from `POST /auth/login`. */
  retry_after_seconds?: number | null
}

/**
 * A failed API call. `title` is short and safe to show. `detail` says what to do next. `code` is
 * a stable word to switch on (`run_already_active`). `status` is the HTTP status, or 0 when the
 * backend could not be reached at all. `errors` lists the wrong fields of a 422. `run_id` is set
 * when the problem is about a run (a 409 `run_already_active` names the run that is going).
 * `reason` and `retry_after_seconds` come with the sign-in's answers (PLAN-V6 B3, B4).
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

const STATUS_TITLES: Partial<Record<number, string>> = {
  400: "The request can't be understood",
  403: 'Not allowed',
  404: 'Not found',
  409: 'Not possible right now',
  413: 'Too much data',
  422: "A value isn't valid",
  429: 'Too many requests',
  500: 'Something went wrong in the backend',
  501: "This part isn't built yet",
  502: "The backend isn't answering",
  503: "The backend isn't available",
  504: "The backend isn't answering",
}

const STATUS_DETAILS: Partial<Record<number, string>> = {
  400: 'Reload the page and try again.',
  403: 'The backend refused this request. Open the site at http://localhost:5173.',
  404: 'It may have been removed, or the link is wrong.',
  409: 'Reload the page to see the current state.',
  413: 'Narrow the request and try again.',
  422: 'Check the highlighted fields and try again.',
  429: 'Wait a few seconds and try again.',
  500: 'Nothing was lost. Try again, and tell the team if it keeps happening.',
  501: 'This feature is still being built.',
  502: 'Check that the backend is running, then try again.',
  503: 'Check that the backend and the database are running, then try again.',
  504: 'Check that the backend is running, then try again.',
}

/** The problem for a backend that cannot be reached at all (status 0). */
export function networkProblem(): ApiProblem {
  return new ApiProblem({
    title: "Can't reach the backend",
    detail: 'Check that it is running (uv run engine serve), then try again.',
    code: 'network',
    status: 0,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
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
        found.push({ field: field ?? '', message })
      }
    }
  }
  return found
}

/**
 * Builds the problem for a failed response. `body` is what openapi-fetch parsed: the backend's
 * `ProblemDetails`, or plain text (a proxy's error page) that is never shown to a person. The
 * status decides the words when the body has none.
 */
export function problemFromResponse(response: Response, body?: unknown): ApiProblem {
  const status = response.status
  const record = isRecord(body) ? body : {}
  // The backend's own words win. FastAPI's `{detail: "text"}` is accepted too.
  const title = asText(record.title) ?? STATUS_TITLES[status] ?? 'The request failed'
  const detail = asText(record.detail) ?? STATUS_DETAILS[status] ?? null
  const errors = readFieldErrors(record.errors ?? record.detail)
  const wait = record.retry_after_seconds
  return new ApiProblem({
    title,
    detail,
    code: asText(record.code),
    status,
    errors,
    run_id: asText(record.run_id),
    reason: asText(record.reason),
    retry_after_seconds:
      typeof wait === 'number' && Number.isFinite(wait) && wait >= 0 ? wait : null,
  })
}

/**
 * Any thrown value as an `ApiProblem`. A network failure (fetch throws a TypeError) becomes the
 * "can't reach the backend" problem. Nothing from an unknown error is shown, because it could
 * hold text the person should not see.
 */
export function toApiProblem(error: unknown): ApiProblem {
  if (error instanceof ApiProblem) {
    return error
  }
  if (error instanceof TypeError) {
    return networkProblem()
  }
  return new ApiProblem({
    title: 'Something went wrong',
    detail: 'Try again. If it keeps happening, tell the team.',
    status: 0,
    code: 'unknown',
  })
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
    fetch: async (request) => {
      try {
        return await (options.fetch ?? globalThis.fetch)(request)
      } catch (error) {
        if (isAbort(error)) {
          throw error
        }
        throw toApiProblem(error)
      }
    },
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
