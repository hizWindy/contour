import { vi } from 'vitest'

/**
 * A fake API for page tests: `mockApi({ '/api/v1/settings': answer })` answers each path with a
 * JSON value, or with a function that gets the call and may return a Response (or nothing, to
 * fall through to a 404). It records every call, so a test can check what was sent. It uses
 * `vi.stubGlobal`, which vite.config.ts undoes after the test.
 *
 * Shared by the Admin tabs' tests (PLAN-V13 T2-5 split them, one file per page, so the two
 * tracks never edit the same test file).
 */
export interface Call {
  method: string
  path: string
  search: string
  body: unknown
}

export type Answer = (call: Call) => Response | undefined

/** Answers by path; records every call. A path with no answer is a 404. */
export function mockApi(answers: Record<string, unknown>): Call[] {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const url = new URL(request.url)
      const text = request.method === 'GET' ? '' : await request.text()
      let body: unknown = text
      try {
        body = text ? JSON.parse(text) : null
      } catch {
        body = text
      }
      const call = { method: request.method, path: url.pathname, search: url.search, body }
      calls.push(call)
      const answer = answers[url.pathname]
      if (typeof answer === 'function') {
        const response = (answer as Answer)(call)
        if (response) return response
      } else if (answer !== undefined) {
        return Response.json(answer)
      }
      return Response.json({ title: 'Not found', status: 404 }, { status: 404 })
    }),
  )
  return calls
}

/** A run id the tests share. */
export const TEST_RUN_ID = '0f3c9a2e-1111-2222-3333-444444444444'
