import createClient from 'openapi-fetch'
import { describe, expect, it, vi } from 'vitest'
import {
  RELATIVE_URLS,
  resolveRelativeUrl,
  withRelativeUrlsFetch,
  withRelativeUrlsRequest,
} from './relative-urls'

/** The absolute form of a page path, against the page jsdom is showing. */
function onPage(path: string): string {
  return new URL(path, window.location.href).href
}

/** The shape openapi-typescript generates, cut down to the two calls these tests make. */
interface Paths {
  '/runs': {
    get: {
      parameters: { query?: { limit?: number }; header?: never; path?: never; cookie?: never }
      requestBody?: never
      responses: {
        200: {
          headers: Record<string, unknown>
          content: { 'application/json': { ids: string[] } }
        }
      }
    }
  }
  '/hubspot/import': {
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never }
      requestBody: { content: { 'multipart/form-data': { file: File } } }
      responses: {
        200: {
          headers: Record<string, unknown>
          content: { 'application/json': { imported: number } }
        }
      }
    }
  }
}

describe('resolveRelativeUrl', () => {
  it('resolves a page path against the page URL, query string included', () => {
    expect(resolveRelativeUrl('/api/v1/runs')).toBe(onPage('/api/v1/runs'))
    expect(resolveRelativeUrl('/api/v1/runs?after=3&limit=5')).toBe(
      onPage('/api/v1/runs?after=3&limit=5'),
    )
  })

  it('leaves absolute strings, URL objects and Request objects alone', () => {
    const url = new URL('https://tile.openstreetmap.org/1/2/3.png')
    const request = new Request('https://example.com/a')

    expect(resolveRelativeUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(resolveRelativeUrl(url)).toBe(url)
    expect(resolveRelativeUrl(request)).toBe(request)
  })

  it('reads the page URL on every call, so a moved page changes the base', () => {
    try {
      window.history.pushState({}, '', '/admin/runs')

      expect(resolveRelativeUrl('/api/v1/runs')).toBe(onPage('/api/v1/runs'))
      expect(resolveRelativeUrl('detail')).toBe(onPage('/admin/detail'))
    } finally {
      window.history.pushState({}, '', '/')
    }
  })
})

describe('setup.ts', () => {
  it('lets Request take a relative URL, which plain Node cannot', () => {
    const request = new Request('/api/v1/health')

    expect(request.url).toBe(onPage('/api/v1/health'))
    expect(request.method).toBe('GET')
    expect(request).toBeInstanceOf(Request)
  })

  it('keeps Request working with an init, an absolute URL and another Request', () => {
    const posted = new Request('/api/v1/runs', { method: 'POST', body: '{}' })
    const absolute = new Request('https://example.com/a')
    const copy = new Request(posted, { method: 'PUT' })

    expect(posted.method).toBe('POST')
    expect(absolute.url).toBe('https://example.com/a')
    expect(copy.url).toBe(onPage('/api/v1/runs'))
    expect(copy.method).toBe('PUT')
  })

  it('has wrapped both Request and fetch, and wrapping again changes nothing', () => {
    expect(RELATIVE_URLS in Request).toBe(true)
    expect(RELATIVE_URLS in fetch).toBe(true)
    expect(withRelativeUrlsRequest(Request)).toBe(Request)
    expect(withRelativeUrlsFetch(fetch)).toBe(fetch)
  })
})

describe('withRelativeUrlsFetch', () => {
  function fakeNative() {
    return vi.fn<typeof fetch>(() => Promise.resolve(new Response('ok')))
  }

  it('resolves a relative string, and passes init and the result through', async () => {
    const native = fakeNative()
    const init = { method: 'POST', body: '{}' }

    const response = await withRelativeUrlsFetch(native)('/api/v1/runs', init)

    expect(native).toHaveBeenCalledWith(onPage('/api/v1/runs'), init)
    expect(await response.text()).toBe('ok')
  })

  it('does not touch an absolute string, a URL or a Request', async () => {
    const native = fakeNative()
    const wrapped = withRelativeUrlsFetch(native)
    const url = new URL('https://example.com/b')
    const request = new Request('https://example.com/c')

    await wrapped('https://example.com/a')
    await wrapped(url)
    await wrapped(request)

    expect(native.mock.calls.map(([input]) => input)).toEqual([
      'https://example.com/a',
      url,
      request,
    ])
  })
})

describe('the API client with the relative base /api/v1', () => {
  function mockFetch(body: unknown) {
    return vi.fn((_request: Request) => Promise.resolve(Response.json(body)))
  }

  it('builds a Request openapi-fetch can use, and a mocked fetch receives it', async () => {
    const fetchMock = mockFetch({ ids: ['a', 'b'] })
    const client = createClient<Paths>({ baseUrl: '/api/v1', fetch: fetchMock })

    const { data, error } = await client.GET('/runs')

    expect(error).toBeUndefined()
    expect(data).toEqual({ ids: ['a', 'b'] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const request = fetchMock.mock.calls[0]?.[0]
    expect(request?.url).toBe(onPage('/api/v1/runs'))
    expect(request?.method).toBe('GET')
  })

  it('keeps query parameters on the resolved URL', async () => {
    const fetchMock = mockFetch({ ids: [] })
    const client = createClient<Paths>({ baseUrl: '/api/v1', fetch: fetchMock })

    await client.GET('/runs', { params: { query: { limit: 5 } } })

    expect(fetchMock.mock.calls[0]?.[0].url).toBe(onPage('/api/v1/runs?limit=5'))
  })

  it('sends a FormData body as multipart, through a custom bodySerializer', async () => {
    const fetchMock = mockFetch({ imported: 3 })
    const client = createClient<Paths>({ baseUrl: '/api/v1', fetch: fetchMock })
    const file = new File(['a,b\n1,2'], 'hubspot.csv', { type: 'text/csv' })
    const serialized: FormData[] = []

    await client.POST('/hubspot/import', {
      body: { file },
      bodySerializer: (body) => {
        const form = new FormData()
        form.append('file', body.file)
        serialized.push(form)
        return form
      },
    })

    const request = fetchMock.mock.calls[0]?.[0]
    expect(request?.url).toBe(onPage('/api/v1/hubspot/import'))
    expect(request?.method).toBe('POST')
    expect(request?.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/)
    // The FormData the serializer built keeps the file. See the note about uploads in setup.ts.
    const sent = serialized[0]?.get('file')
    expect(sent).toBeInstanceOf(File)
    expect((sent as File).name).toBe('hubspot.csv')
    expect(await (sent as File).text()).toBe('a,b\n1,2')
  })
})
