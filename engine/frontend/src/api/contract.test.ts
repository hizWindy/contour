// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
  The website follows the backend contract (engine/frontend/openapi.json):
   - every call the client code makes names a path and a method that the contract has,
   - the generated types (src/api/schema.d.ts) match the contract, so nobody forgot `npm run types`,
   - the base URL is relative, and no source file holds the backend's address.
  These read the files, so they need no browser.
*/

const SRC = join(import.meta.dirname, '..')
const ROOT = join(SRC, '..')

interface OpenApi {
  servers?: Array<{ url: string }>
  paths: Record<string, Record<string, unknown>>
}

const spec = JSON.parse(readFileSync(join(ROOT, 'openapi.json'), 'utf8')) as OpenApi

function collect(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      return collect(full)
    }
    return /\.(?:ts|tsx|css|html)$/.test(entry.name) ? [full] : []
  })
}

function slashes(full: string): string {
  return relative(SRC, full).split(sep).join('/')
}

/** Production code: not a test, not a test helper, not the generated types. */
const productionFiles = collect(SRC)
  .map((full) => ({ path: slashes(full), text: readFileSync(full, 'utf8') }))
  .filter(
    ({ path }) =>
      !path.startsWith('test/') && !/\.test\.(?:ts|tsx)$/.test(path) && path !== 'api/schema.d.ts',
  )

describe('the contract and the client', () => {
  it('has a relative base URL in the contract', () => {
    expect(spec.servers).toEqual([{ url: '/api/v1' }])
  })

  it('only calls paths and methods that openapi.json has', () => {
    const call = /\b(?:api|client)\s*\.\s*(GET|POST|PUT|PATCH|DELETE)\s*\(\s*(['"`])(\/[^'"`]*)\2/g
    const found: Array<{ file: string; method: string; path: string }> = []
    for (const { path: file, text } of productionFiles) {
      for (const match of text.matchAll(call)) {
        found.push({ file, method: (match[1] ?? '').toLowerCase(), path: match[3] ?? '' })
      }
    }

    // The client code has at least the main groups, so a broken pattern cannot pass by finding none.
    expect(found.length).toBeGreaterThanOrEqual(30)
    const unknown = found.filter(({ method, path }) => !spec.paths[path]?.[method])
    expect(
      unknown.map(({ file, method, path }) => `${file}: ${method.toUpperCase()} ${path}`),
    ).toEqual([])
  })

  it('uses every route group the pages build on', () => {
    const used = new Set<string>()
    const call = /\b(?:api|client)\s*\.\s*(GET|POST|PUT|PATCH|DELETE)\s*\(\s*(['"`])(\/[^'"`]*)\2/g
    for (const { text } of productionFiles) {
      for (const match of text.matchAll(call)) {
        used.add(`${(match[1] ?? '').toUpperCase()} ${match[3] ?? ''}`)
      }
    }
    for (const needed of [
      'GET /runs',
      'POST /runs',
      'POST /runs/estimate',
      'GET /runs/{run_id}',
      'POST /runs/{run_id}/cancel',
      'POST /runs/{run_id}/resume',
      'GET /settings',
      'PATCH /settings',
      'GET /lead-finder/run-options',
      'GET /lead-finder/leads',
      'GET /lead-finder/leads/{lead_id}',
      'PATCH /lead-finder/leads/{lead_id}',
      'GET /lead-finder/watchlist',
      'GET /lead-finder/tests',
      'GET /searches',
      'GET /memory/search',
      'POST /hubspot/import',
      'GET /hubspot/summary',
    ]) {
      expect(used.has(needed), needed).toBe(true)
    }
  })

  it('has the run events stream in the contract at the path the hook opens', () => {
    expect(spec.paths['/runs/{run_id}/events']?.get).toBeDefined()
    const hook = productionFiles.find(({ path }) => path === 'hooks/useRunEvents.ts')
    expect(hook?.text).toContain('/runs/${encodeURIComponent(runId)}/events?after=')
    expect(hook?.text).toContain('API_BASE_URL')
  })

  it('keeps src/api/schema.d.ts in step with openapi.json (run `npm run types` if this fails)', async () => {
    const { default: openapiTS, astToString } = await import('openapi-typescript')
    const generated = astToString(
      await openapiTS(spec as unknown as Parameters<typeof openapiTS>[0]),
    )
    const committed = readFileSync(join(SRC, 'api', 'schema.d.ts'), 'utf8')

    const normal = (text: string) => text.replace(/\r\n/g, '\n').trim()
    expect(normal(committed).endsWith(normal(generated))).toBe(true)
  })
})

describe('no absolute API address in the source', () => {
  // Written in pieces so this file does not contain what it looks for.
  const host = ['127', '0', '0', '1'].join('.')
  const needles = [`${host}:8000`, `${'localhost'}:8000`, `0.0.0.0:8000`, `[::1]:8000`]

  it('holds no backend address in any production source file', () => {
    const hits = productionFiles.flatMap(({ path, text }) =>
      needles.filter((needle) => text.includes(needle)).map((needle) => `${path}: ${needle}`),
    )

    expect(hits).toEqual([])
  })

  it('opens no absolute address with fetch, EventSource or the client', () => {
    // The only absolute addresses in the code are the OpenStreetMap tile server and its credit page.
    const opens = /(?:\bfetch|\bEventSource|\bRequest|\bbaseUrl)\s*[(:]\s*['"`]https?:/
    const hits = productionFiles.filter(({ text }) => opens.test(text)).map(({ path }) => path)

    expect(hits).toEqual([])
  })
})
