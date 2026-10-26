/**
 * Relative URLs in tests.
 *
 * The site calls the API with the relative base `/api/v1`, never an absolute URL. A browser
 * resolves that against the page. Node does not: its `Request` and `fetch` have no base URL, so
 * `new Request('/api/v1/runs')` throws "Failed to parse URL". openapi-fetch builds a `Request`
 * before it calls any custom `fetch`, so even a client with a mocked `fetch` fails.
 *
 * `setup.ts` wraps `Request` and `fetch` with the helpers below. A string that is not an
 * absolute URL is resolved against the page URL (`document.baseURI`, which is
 * http://localhost:3000/ under jsdom), the same as a browser does. Absolute strings, `URL`
 * objects and `Request` objects pass through untouched. The page URL is read on every call,
 * so a test that moves the page with `history.pushState` sees the new base.
 *
 * What a test sees: a code path that calls `fetch('/api/v1/x')` reaches a mock `fetch` with the
 * string unchanged. openapi-fetch builds the `Request` first, so a mock reaches it as a `Request`
 * with an absolute `url`: compare `new URL(request.url).pathname`.
 */

/** Marks a wrapper, so importing `setup.ts` twice never wraps twice. */
export const RELATIVE_URLS = Symbol.for('contour.test.relativeUrls')

/** Turns a page-relative string into an absolute URL string. Anything else is returned as is. */
export function resolveRelativeUrl<T>(input: T): T | string {
  if (typeof input !== 'string' || URL.canParse(input)) {
    return input
  }
  return new URL(input, document.baseURI).href
}

/** `fetch` that accepts page-relative strings. */
export function withRelativeUrlsFetch(nativeFetch: typeof fetch): typeof fetch {
  if (RELATIVE_URLS in nativeFetch) {
    return nativeFetch
  }
  const wrapped = function fetch(input: RequestInfo | URL, init?: RequestInit) {
    return nativeFetch.call(globalThis, resolveRelativeUrl(input), init)
  }
  return Object.assign(wrapped, { [RELATIVE_URLS]: true })
}

/** `Request` that accepts page-relative strings. */
export function withRelativeUrlsRequest(BaseRequest: typeof Request): typeof Request {
  if (RELATIVE_URLS in BaseRequest) {
    return BaseRequest
  }
  class RelativeUrlRequest extends BaseRequest {
    static readonly [RELATIVE_URLS] = true

    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(resolveRelativeUrl(input), init)
    }
  }
  return RelativeUrlRequest
}
