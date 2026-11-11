import { describe, expect, it, vi } from 'vitest'
import {
  api,
  ApiProblem,
  API_BASE_URL,
  fieldErrorMap,
  hubspotUploadForm,
  isApiProblem,
  newIdempotencyKey,
  problemFromResponse,
  TIME_LIMITS,
  timeLimitFor,
  toApiProblem,
  unwrap,
  uploadHubspotExport,
} from './client'

const PAGE = window.location.href

function pathOf(request: Request): string {
  const url = new URL(request.url)
  return `${url.pathname}${url.search}`
}

/** Replaces the global fetch with a mock that answers with `respond`, and returns the mock. */
function mockFetch(respond: (request: Request) => Response | Promise<Response>) {
  const mock = vi.fn((request: Request) => Promise.resolve(respond(request)))
  vi.stubGlobal('fetch', mock)
  return mock
}

function problemJson(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  })
}

async function failure(call: Promise<unknown>): Promise<ApiProblem> {
  try {
    await call
  } catch (error) {
    if (error instanceof ApiProblem) {
      return error
    }
    throw error
  }
  throw new Error('The call should have failed')
}

describe('the client', () => {
  it('calls the relative base /api/v1, never an absolute backend address', async () => {
    const fetchMock = mockFetch(() => Response.json({ status: 'ok' }))

    await api.GET('/health')

    expect(API_BASE_URL).toBe('/api/v1')
    const request = fetchMock.mock.calls[0]?.[0]
    expect(request && new URL(request.url).origin).toBe(new URL(PAGE).origin)
    expect(request && pathOf(request)).toBe('/api/v1/health')
  })

  it('sends a repeated key for each value of a list filter', async () => {
    const fetchMock = mockFetch(() => Response.json({ total: 0, items: [] }))

    await api.GET('/lead-finder/leads', {
      params: { query: { result: ['pass', 'watch'], city: ['Melbourne'], min_score: 70 } },
    })

    const request = fetchMock.mock.calls[0]?.[0]
    expect(request && pathOf(request)).toBe(
      '/api/v1/lead-finder/leads?result=pass&result=watch&city=Melbourne&min_score=70',
    )
  })

  it('looks the global fetch up on every call, so a test can replace it at any time', async () => {
    const first = mockFetch(() => Response.json({ status: 'ok' }))
    await api.GET('/health')
    const second = mockFetch(() => Response.json({ status: 'ok' }))
    await api.GET('/health')

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('makes an idempotency key that is a UUID', () => {
    expect(newIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey())
  })
})

describe('unwrap and ApiProblem', () => {
  it('returns the data of a good answer', async () => {
    mockFetch(() => Response.json({ status: 'ok', database: true }))

    const data = unwrap(await api.GET('/health'))

    expect(data).toEqual({ status: 'ok', database: true })
  })

  it('returns undefined for a 204, which has no body', async () => {
    mockFetch(() => new Response(null, { status: 204 }))

    const data = unwrap(
      await api.GET('/runs/{run_id}/events', { params: { path: { run_id: 'r1' } } }),
    )

    expect(data).toBeUndefined()
  })

  it('throws a typed problem with every field of a 409', async () => {
    mockFetch(() =>
      problemJson(409, {
        type: 'about:blank',
        title: 'A run is already going',
        status: 409,
        detail: 'Stop it, or wait for it to finish.',
        code: 'run_already_active',
        run_id: '8a4d3a0e-0000-4000-8000-000000000001',
      }),
    )

    const problem = await failure(
      api.POST('/runs', { body: { app: 'lead_finder', mode: 'discovery' } }).then(unwrap),
    )

    expect(isApiProblem(problem)).toBe(true)
    expect(problem).toBeInstanceOf(Error)
    expect(problem.title).toBe('A run is already going')
    expect(problem.detail).toBe('Stop it, or wait for it to finish.')
    expect(problem.code).toBe('run_already_active')
    expect(problem.status).toBe(409)
    expect(problem.run_id).toBe('8a4d3a0e-0000-4000-8000-000000000001')
    expect(problem.errors).toEqual([])
    expect(problem.message).toContain('A run is already going')
  })

  it('keeps the field errors of a 422', async () => {
    mockFetch(() =>
      problemJson(422, {
        title: "A value isn't valid",
        status: 422,
        errors: [
          { field: 'body.params.cities', message: 'Pick at least one city.' },
          { field: 'body.params.since_days', message: 'Use 7 or 30.' },
        ],
      }),
    )

    const problem = await failure(
      api.POST('/runs/estimate', { body: { app: 'lead_finder', mode: 'discovery' } }).then(unwrap),
    )

    expect(problem.status).toBe(422)
    expect(problem.errors).toHaveLength(2)
    expect(fieldErrorMap(problem)).toEqual({
      cities: 'Pick at least one city.',
      since_days: 'Use 7 or 30.',
    })
  })

  it('reads FastAPI default validation errors as field errors too', () => {
    const problem = problemFromResponse(new Response(null, { status: 422 }), {
      detail: [{ loc: ['query', 'limit'], msg: 'Input should be at most 200' }],
    })

    expect(problem.errors).toEqual([
      { field: 'query.limit', message: 'Input should be at most 200' },
    ])
    expect(fieldErrorMap(problem)).toEqual({ limit: 'Input should be at most 200' })
  })

  it('reads a proxy page (a 502 with no JSON) as "updating", and shows no raw text', async () => {
    mockFetch(
      () =>
        new Response(
          '<html><body><h1>502 Bad Gateway</h1><script>alert(1)</script></body></html>',
          {
            status: 502,
          },
        ),
    )

    const problem = await failure(api.GET('/health').then(unwrap))

    expect(problem.status).toBe(502)
    expect(problem.code).toBe('updating')
    expect(problem.title).toBe('Contour is updating')
    expect(problem.detail).toBe("It'll be back in about a minute. This page will reload by itself.")
    expect(problem.message).not.toContain('<html>')
    expect(problem.message).not.toContain('alert')
  })

  it('has a title and a next step for every status it names', () => {
    for (const status of [400, 403, 404, 409, 413, 422, 429, 500, 501, 502, 503, 504]) {
      const problem = problemFromResponse(new Response(null, { status }), undefined)
      expect(problem.title, `${status} title`).not.toBe('The request failed')
      expect(problem.detail, `${status} detail`).toBeTruthy()
    }
  })

  it('falls back to a generic title for a status it does not know', () => {
    const problem = problemFromResponse(new Response(null, { status: 418 }), undefined)

    expect(problem.title).toBe("That didn't work")
    expect(problem.detail).toBe('Try again.')
  })

  it('turns a network failure into the "can\'t reach its server" problem', async () => {
    mockFetch(() => {
      throw new TypeError('Failed to fetch')
    })

    const problem = await failure(api.GET('/health').then(unwrap))

    expect(problem.status).toBe(0)
    expect(problem.code).toBe('unreachable')
    expect(problem.title).toBe("Contour can't reach its server")
    expect(problem.detail).toBe("We'll try again in 10 seconds.")
  })

  it('lets a cancelled request through as it is, so the caller can ignore it', async () => {
    const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    mockFetch(() => {
      throw abort
    })

    await expect(api.GET('/health')).rejects.toBe(abort)
  })

  it('never shows the text of an unknown error', () => {
    const problem = toApiProblem(new Error('password=hunter2 at C:\\secret\\file.py'))

    expect(problem.message).not.toContain('hunter2')
    expect(problem.title).toBe("This page couldn't be shown")
    expect(problem.code).toBe('page_error')
  })

  it('never reads a bug in page code as "can\'t reach the server" (PLAN-V15 T2-2)', () => {
    const problem = toApiProblem(new TypeError("Cannot read properties of undefined (reading 'x')"))

    expect(problem.code).toBe('page_error')
    expect(problem.title).not.toContain('reach')
  })

  it('passes an ApiProblem through unchanged', () => {
    const original = new ApiProblem({ title: 'T', status: 400 })

    expect(toApiProblem(original)).toBe(original)
  })

  it('maps field errors for settings and queries too, and keeps the first message of a field', () => {
    const problem = new ApiProblem({
      title: 'x',
      status: 422,
      errors: [
        { field: 'values.run_cap_usd', message: 'Too high' },
        { field: 'values.run_cap_usd', message: 'Second' },
        { field: 'query.limit', message: 'Too big' },
        { field: 'plain', message: 'No prefix' },
      ],
    })

    expect(fieldErrorMap(problem)).toEqual({
      run_cap_usd: 'Too high',
      limit: 'Too big',
      plain: 'No prefix',
    })
  })
})

/** A fetch that never answers: it only ends when its request is cancelled. */
function hangingFetch() {
  return mockFetch(
    (request) =>
      new Promise<Response>((_, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
        })
      }),
  )
}

describe('the request layer (PLAN-V15 T2-2)', () => {
  it('gives up after 20 seconds with no answer, as a "timeout" problem', async () => {
    vi.useFakeTimers()
    const fetchMock = hangingFetch()

    const call = failure(api.GET('/health').then(unwrap))
    await vi.advanceTimersByTimeAsync(TIME_LIMITS.normal - 1)
    expect(fetchMock.mock.calls[0]?.[0].signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const problem = await call

    expect(problem.code).toBe('timeout')
    expect(problem.status).toBe(0)
    expect(problem.title).toBe('Contour took too long to answer')
    expect(problem.detail).toBe('Nothing was lost. Try again.')
  })

  it("keeps the page's own cancel a cancel, not a timeout", async () => {
    hangingFetch()
    const controller = new AbortController()

    const call = api.GET('/health', { signal: controller.signal })
    controller.abort()

    await expect(call).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('has a longer limit for an upload, a CSV download and a HubSpot write, and none for a stream', () => {
    const at = (path: string, init?: RequestInit) =>
      timeLimitFor(new Request(`http://localhost:3000/api/v1${path}`, init))

    expect(at('/lead-finder/leads')).toBe(TIME_LIMITS.normal)
    expect(at('/hubspot/import', { method: 'POST' })).toBe(TIME_LIMITS.long)
    expect(at('/lead-finder/leads/export')).toBe(TIME_LIMITS.long)
    expect(at('/lead-finder/review/send', { method: 'POST' })).toBe(TIME_LIMITS.long)
    expect(at('/lead-finder/leads/abc/hubspot/send', { method: 'POST' })).toBe(TIME_LIMITS.long)
    expect(at('/hubspot/profiles/rebuild', { method: 'POST' })).toBe(TIME_LIMITS.rebuild)
    expect(at('/runs/r1/events', { headers: { accept: 'text/event-stream' } })).toBeNull()
  })

  it('says "offline" when the browser has no network', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    mockFetch(() => {
      throw new TypeError('Failed to fetch')
    })

    const problem = await failure(api.GET('/health').then(unwrap))

    expect(problem.code).toBe('offline')
    expect(problem.title).toBe("You're offline")
    expect(problem.detail).toBe('Contour will carry on when your connection is back.')
  })

  it('reads a 503 or 504 with no JSON as "updating" too', async () => {
    for (const status of [503, 504]) {
      mockFetch(() => new Response('upstream connect error', { status }))
      const problem = await failure(api.GET('/health').then(unwrap))
      expect(problem.code, `${status}`).toBe('updating')
    }
  })

  it('keeps the backend\'s own 503 "busy", with its wait from Retry-After', async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            title: 'Contour is busy',
            detail: 'Try again in a few seconds.',
            status: 503,
            code: 'busy',
          }),
          {
            status: 503,
            headers: { 'content-type': 'application/problem+json', 'retry-after': '5' },
          },
        ),
    )

    const problem = await failure(api.GET('/health').then(unwrap))

    expect(problem.code).toBe('busy')
    expect(problem.retry_after_seconds).toBe(5)
  })

  it('reads the request id from the error body, or else from the X-Request-ID header', async () => {
    mockFetch(() => problemJson(500, { title: 'x', status: 500, request_id: '7F3K92QD' }))
    expect((await failure(api.GET('/health').then(unwrap))).request_id).toBe('7F3K92QD')

    mockFetch(() => new Response(null, { status: 500, headers: { 'x-request-id': 'AB12CD34' } }))
    const problem = await failure(api.GET('/health').then(unwrap))
    expect(problem.request_id).toBe('AB12CD34')
    expect(problem.title).toBe('Something went wrong on our side')
    expect(problem.detail).toBe(
      'Try again. If it happens again, send this code to an admin: AB12CD34.',
    )
  })

  it('drops a request id that is not letters, digits and dashes', () => {
    const problem = problemFromResponse(
      new Response(null, { status: 500, headers: { 'x-request-id': '<b>id</b>' } }),
      undefined,
    )

    expect(problem.request_id).toBeNull()
    expect(problem.detail).toBe('Try again. If it happens again, tell an admin.')
  })

  it("turns Pydantic's field messages into plain words", () => {
    const problem = problemFromResponse(new Response(null, { status: 422 }), {
      detail: [
        { loc: ['body', 'name'], msg: 'Field required' },
        { loc: ['body', 'limit'], msg: 'Input should be greater than or equal to 1' },
        { loc: ['body', 'result'], msg: "Input should be 'pass', 'watch' or 'drop'" },
        { loc: ['body', 'note'], msg: 'Value error, Pick a city first.' },
      ],
    })

    expect(fieldErrorMap(problem)).toEqual({
      name: 'Fill this in.',
      limit: 'Use 1 or more.',
      result: 'Pick one of: pass, watch or drop.',
      note: 'Pick a city first.',
    })
  })
})

describe('the HubSpot upload', () => {
  const file = new File(['a,b\n1,2'], 'COMPANIES.xlsx', { type: 'application/octet-stream' })

  it('puts the file in a FormData that keeps its name and bytes', async () => {
    const form = hubspotUploadForm(file)
    const sent = form.get('file')

    expect(sent).toBeInstanceOf(File)
    expect((sent as File).name).toBe('COMPANIES.xlsx')
    expect(await (sent as File).text()).toBe('a,b\n1,2')
  })

  it('posts multipart to /hubspot/import and lets the browser set the boundary', async () => {
    const fetchMock = mockFetch(() =>
      Response.json({
        companies: 3,
        deals: 1,
        offices: 4,
        skipped_rows: 0,
        skipped_sheets: [],
        profiles_rebuilt: 3,
      }),
    )

    const result = unwrap(await uploadHubspotExport(file))

    const request = fetchMock.mock.calls[0]?.[0]
    expect(request?.method).toBe('POST')
    expect(request && pathOf(request)).toBe('/api/v1/hubspot/import')
    expect(request?.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/)
    expect(result.companies).toBe(3)
  })
})
