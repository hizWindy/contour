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

  it('uses plain words for the status when the body is not a problem, and shows no raw text', async () => {
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
    expect(problem.title).toBe("The backend isn't answering")
    expect(problem.detail).toBe('Check that the backend is running, then try again.')
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

    expect(problem.title).toBe('The request failed')
    expect(problem.detail).toBeNull()
  })

  it('turns a network failure into the "can\'t reach the backend" problem', async () => {
    mockFetch(() => {
      throw new TypeError('Failed to fetch')
    })

    const problem = await failure(api.GET('/health').then(unwrap))

    expect(problem.status).toBe(0)
    expect(problem.code).toBe('network')
    expect(problem.title).toBe("Can't reach the backend")
    expect(problem.detail).toContain('uv run engine serve')
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
    expect(problem.title).toBe('Something went wrong')
    expect(problem.code).toBe('unknown')
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
