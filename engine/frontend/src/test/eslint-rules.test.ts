// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { ESLint, type Linter } from 'eslint'
import tseslint from 'typescript-eslint'
import { beforeAll, describe, expect, it } from 'vitest'

/*
  Runs ESLint's Node API over small pieces of code and checks that each safety rule in
  eslint.config.js fires, and that safe code passes. A typo in the config (a wrong selector or a
  rule name) would otherwise switch a rule off with no sign of it.

  The real eslint.config.js is used. Only the type-aware rules are turned off (the sample files do
  not exist on disk, so TypeScript has nothing to read), by adding typescript-eslint's
  `disableTypeChecked` on top. The rules under test do not need type information.
*/

const ROOT = join(import.meta.dirname, '..', '..')
const DEFAULT_FILE = 'src/lib/sample.tsx'

let eslint: ESLint

beforeAll(async () => {
  eslint = new ESLint({
    cwd: ROOT,
    overrideConfig: tseslint.configs.disableTypeChecked as Linter.Config,
  })
  // The first run loads the TypeScript parser and the React plugin, which takes a moment.
  await eslint.lintText('export const warm = 1\n', { filePath: DEFAULT_FILE })
}, 60_000)

interface Found {
  ruleId: string | null
  severity: number
  message: string
}

async function lint(code: string, filePath = DEFAULT_FILE): Promise<Found[]> {
  const [result] = await eslint.lintText(code, { filePath })
  const messages = result?.messages ?? []
  const fatal = messages.find((message) => message.fatal)
  if (fatal) {
    throw new Error(`The sample did not parse: ${fatal.message}\n${code}`)
  }
  return messages.map(({ ruleId, severity, message }) => ({ ruleId, severity, message }))
}

async function ruleIds(code: string, filePath = DEFAULT_FILE): Promise<string[]> {
  return (await lint(code, filePath)).map((found) => found.ruleId ?? 'none')
}

/** [rule, code that must trigger it]. */
const MUST_FIRE: Array<[string, string]> = [
  // React: HTML from a string
  [
    'react/no-danger',
    `export const A = () => <div dangerouslySetInnerHTML={{ __html: '<b>x</b>' }} />`,
  ],
  [
    'react/no-danger-with-children',
    `export const A = () => <div dangerouslySetInnerHTML={{ __html: 'x' }}>child</div>`,
  ],

  // React: links
  [
    'react/jsx-no-target-blank',
    `export const A = () => <a href="https://example.com" target="_blank">site</a>`,
  ],
  [
    'react/jsx-no-target-blank',
    `export const A = ({ url }: { url: string }) => <a href={url} target="_blank">site</a>`,
  ],
  [
    'react/jsx-no-target-blank',
    `export const A = () => <a href="https://example.com" target="_blank" rel="noopener">site</a>`,
  ],
  [
    'react/jsx-no-target-blank',
    `import { Link } from 'react-router'\nexport const A = () => <Link to="https://example.com" target="_blank">site</Link>`,
  ],
  ['react/jsx-no-script-url', `export const A = () => <a href="javascript:alert(1)">x</a>`],
  [
    'react/jsx-no-script-url',
    `import { Link } from 'react-router'\nexport const A = () => <Link to="javascript:alert(1)">x</Link>`,
  ],
  ['react/jsx-no-comment-textnodes', `export const A = () => <p>// not a comment</p>`],
  ['react/jsx-no-comment-textnodes', `export const A = () => <p>/* not a comment */</p>`],

  // Hooks: the one warning that matters is an error, so `npm run lint` shows a clear message
  [
    'react-hooks/exhaustive-deps',
    `import { useEffect, useState } from 'react'
export function A() {
  const [count] = useState(0)
  useEffect(() => { track(count) }, [])
  return null
}
declare function track(n: number): void`,
  ],

  // Writing HTML from a string
  ['no-restricted-properties', `export function f(el: Element, x: string) { el.innerHTML = x }`],
  ['no-restricted-properties', `export function f(el: Element, x: string) { el.outerHTML = x }`],
  [
    'no-restricted-properties',
    `export function f(el: Element, x: string) { el.insertAdjacentHTML('beforeend', x) }`,
  ],
  ['no-restricted-properties', `export function f(x: string) { document.write(x) }`],
  ['no-restricted-properties', `export function f(x: string) { document.writeln(x) }`],
  [
    'no-restricted-properties',
    `export function f(el: Element) { const { innerHTML } = el; return innerHTML }`,
  ],
  ['no-restricted-properties', `export function f(el: Element) { return el['innerHTML'] }`],
  ['no-restricted-properties', `export function f(el: Element, x: string) { el.setHTMLUnsafe(x) }`],
  [
    'no-restricted-properties',
    `export function f(x: string) { return Document.parseHTMLUnsafe(x) }`,
  ],
  [
    'no-restricted-properties',
    `export function f(r: Range, x: string) { return r.createContextualFragment(x) }`,
  ],
  [
    'no-restricted-properties',
    `export function f(frame: HTMLIFrameElement, x: string) { frame.srcdoc = x }`,
  ],
  [
    'no-restricted-properties',
    `export function f(frame: HTMLIFrameElement) { const { srcdoc } = frame; return srcdoc }`,
  ],

  // Writing HTML in shapes the property rule cannot see
  ['no-restricted-syntax', `export function f(x: string) { window.document.write(x) }`],
  ['no-restricted-syntax', `export function f(x: string) { globalThis.document.write(x) }`],
  ['no-restricted-syntax', `export function f(x: string) { window.document.writeln(x) }`],
  ['no-restricted-syntax', `export function f(x: string) { window['document'].write(x) }`],
  ['no-restricted-syntax', `export function f(x: string) { globalThis.document['write'](x) }`],
  ['no-restricted-syntax', `export const p = new DOMParser()`],
  ['no-restricted-syntax', `export const p = new window.DOMParser()`],
  ['no-restricted-syntax', `export const p = new globalThis.DOMParser()`],
  [
    'no-restricted-syntax',
    `export function f(frame: HTMLIFrameElement, x: string) { frame.setAttribute('srcdoc', x) }`,
  ],
  [
    'no-restricted-syntax',
    `export function f(frame: HTMLIFrameElement, x: string) { frame.setAttribute('srcDoc', x) }`,
  ],

  // dangerouslySetInnerHTML and srcDoc written as an object or an attribute, not only as JSX
  [
    'no-restricted-syntax',
    `import { createElement } from 'react'\nexport const A = ({ x }: { x: string }) => createElement('div', { dangerouslySetInnerHTML: { __html: x } })`,
  ],
  [
    'no-restricted-syntax',
    `import { cloneElement, type ReactElement } from 'react'\nexport const A = (el: ReactElement, x: string) => cloneElement(el, { dangerouslySetInnerHTML: { __html: x } })`,
  ],
  [
    'no-restricted-syntax',
    `export const props = (x: string) => ({ 'dangerouslySetInnerHTML': { __html: x } })`,
  ],
  [
    'no-restricted-syntax',
    `export const A = ({ x }: { x: string }) => <div {...{ dangerouslySetInnerHTML: { __html: x } }} />`,
  ],
  ['no-restricted-syntax', `export const A = ({ x }: { x: string }) => <iframe srcDoc={x} />`],
  ['no-restricted-syntax', `export const A = () => <iframe srcDoc="<b>x</b>" title="x" />`],
  ['no-restricted-syntax', `export const A = ({ x }: { x: string }) => <iframe srcdoc={x} />`],
  [
    'no-restricted-syntax',
    `import { createElement } from 'react'\nexport const A = ({ x }: { x: string }) => createElement('iframe', { srcDoc: x })`,
  ],

  // Leaflet: HTML strings
  ['no-restricted-syntax', `export function f(m: L.Marker, x: string) { m.bindPopup(x) }`],
  ['no-restricted-syntax', `export function f(m: L.Marker) { m.bindPopup('<b>x</b>') }`],
  ['no-restricted-syntax', `export function f(m: L.Marker, x: string) { m.bindTooltip(x) }`],
  ['no-restricted-syntax', `export function f(m: L.Marker, x: string) { m.setPopupContent(x) }`],
  ['no-restricted-syntax', `export function f(m: L.Marker, x: string) { m.setTooltipContent(x) }`],
  ['no-restricted-syntax', `export function f(p: L.Popup, x: string) { p.setContent(x) }`],
  ['no-restricted-syntax', `export const i = divIcon({ html: '<b>x</b>' })`],
  ['no-restricted-syntax', `export const i = L.divIcon({ className: 'pin', html: name })`],
  ['no-restricted-syntax', `export const i = L.divIcon({ 'html': name })`],
  ['no-restricted-syntax', `export const i = new L.DivIcon({ html: name })`],
  ['no-restricted-syntax', `export const i = divIcon(options)`],
  ['no-restricted-syntax', `export const i = L.divIcon({ className: 'pin', ...options })`],
]

describe('the safety rules in eslint.config.js fire', () => {
  it.each(MUST_FIRE)('%s: %s', async (rule, code) => {
    const found = await lint(code)
    const hit = found.find((item) => item.ruleId === rule)

    expect(hit, `${rule} did not fire. Found: ${JSON.stringify(found)}`).toBeDefined()
    expect(hit?.severity, `${rule} must be an error, not a warning`).toBe(2)
  })

  it('says what to do instead', async () => {
    const [html] = await lint(`export function f(el: Element) { el.innerHTML = 'x' }`)
    const [leaflet] = await lint(`export function f(m: L.Marker) { m.bindPopup('x') }`)

    expect(html?.message).toMatch(/React children/)
    expect(leaflet?.message).toMatch(/React children/)
  })
})

describe('safe code passes every rule', () => {
  it('lets a plain external link, an internal link and a real JSX comment through', async () => {
    const code = `
import { Link } from 'react-router'

export function Sample({ name }: { name: string }) {
  return (
    <section>
      <a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">
        {name}
      </a>
      <a href="/leads/1">Open</a>
      <Link to="/leads/2">Open</Link>
      <Link to="https://example.com" target="_blank" rel="noopener noreferrer nofollow">
        Source
      </Link>
      {/* a real comment */}
      <p>{'// shown as text on purpose'}</p>
    </section>
  )
}
`

    expect(await lint(code)).toEqual([])
  })

  it('lets text content and a divIcon without html through', async () => {
    const code = `
import { divIcon } from 'leaflet'

export const pin = divIcon({ className: 'pin', iconSize: [12, 12] })
export const plain = divIcon()

export function show(el: Element, text: string) {
  el.textContent = text
  return el.childElementCount
}
`

    expect(await lint(code)).toEqual([])
  })

  // The project does not use the React Compiler, so `react-hooks/incompatible-library` (which says
  // "this library cannot be compiled") has nothing to tell us. The spec needs both libraries below
  // on pages, and `npm run lint` fails on any warning, so the rule is off in eslint.config.js.
  it('lets TanStack Table through (useReactTable)', async () => {
    const code = `
import { getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'

interface Row {
  id: string
  name: string
}

const columns: ColumnDef<Row>[] = [{ accessorKey: 'name', header: 'Name' }]

export function RowsTable({ rows }: { rows: Row[] }) {
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() })
  return (
    <table>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id}>
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id}>{String(cell.getValue())}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
`

    expect(await lint(code)).toEqual([])
  })

  it('lets React Hook Form through (watch from useForm)', async () => {
    const code = `
import { useForm } from 'react-hook-form'

interface Values {
  city: string
  days: number
}

export function StartForm() {
  const { register, watch } = useForm<Values>({ defaultValues: { city: 'Melbourne', days: 30 } })
  const city = watch('city')
  return (
    <form>
      <input {...register('city')} />
      <p>{city}</p>
    </form>
  )
}

export function StartFormAsObject() {
  const form = useForm<Values>({ defaultValues: { city: 'Perth', days: 7 } })
  const days = form.watch('days')
  return (
    <form>
      <input {...form.register('days', { valueAsNumber: true })} />
      <p>{days}</p>
    </form>
  )
}
`

    expect(await lint(code)).toEqual([])
  })

  it('lets other write calls and other document members through', async () => {
    const code = `
import type { ServerResponse } from 'node:http'

export function f(res: ServerResponse, doc: Document) {
  res.write('chunk')
  process.stdout.write('line')
  window.document.title = 'Lead Finder'
  return [doc.title, window.document.createTextNode('plain text')]
}

export const srcdocs = { srcdocument: 1, source: 'x' }
`

    expect(await lint(code, 'src/lib/sample.ts')).toEqual([])
    expect(
      await lint(`export const A = () => <iframe src="/frame" title="x" />`),
      'an iframe with src is not srcDoc',
    ).toEqual([])
  })

  it('does not mistake the word html in other code for a divIcon option', async () => {
    const code = `
export const options = { html: 'not a Leaflet option' }
export const label = divider({ html: 'also not' })
`

    expect(await ruleIds(code)).not.toContain('no-restricted-syntax')
  })
})

describe('tests may read innerHTML, but the rest stays banned', () => {
  const TEST_FILE = 'src/shell/sample.test.tsx'

  it('allows reading and writing innerHTML and outerHTML in a test file', async () => {
    const code = `
export function read(container: HTMLElement) {
  container.innerHTML = '<div id="root"></div>'
  return container.innerHTML + container.outerHTML
}
`

    expect(await ruleIds(code, TEST_FILE)).toEqual([])
    expect(await ruleIds(code)).toEqual([
      'no-restricted-properties',
      'no-restricted-properties',
      'no-restricted-properties',
    ])
  })

  it('still bans the other HTML writers, document.write and the Leaflet calls in a test file', async () => {
    expect(
      await ruleIds(
        `export function f(el: Element) { el.insertAdjacentHTML('beforeend', 'x') }`,
        TEST_FILE,
      ),
    ).toEqual(['no-restricted-properties'])
    expect(
      await ruleIds(`export function f(el: Element) { el.setHTMLUnsafe('x') }`, TEST_FILE),
    ).toEqual(['no-restricted-properties'])
    expect(await ruleIds(`export function f() { document.write('x') }`, TEST_FILE)).toEqual([
      'no-restricted-properties',
    ])
    expect(await ruleIds(`export function f() { window.document.write('x') }`, TEST_FILE)).toEqual([
      'no-restricted-syntax',
    ])
    expect(await ruleIds(`export const p = new DOMParser()`, TEST_FILE)).toEqual([
      'no-restricted-syntax',
    ])
    expect(await ruleIds(`export function f(m: L.Marker) { m.bindPopup('x') }`, TEST_FILE)).toEqual(
      ['no-restricted-syntax'],
    )
  })
})

describe('the one exception mechanism: a file named *.raw-html.ts or *.raw-html.tsx', () => {
  const RAW = `
export function f(el: Element, m: L.Marker, x: string) {
  el.innerHTML = x
  el.insertAdjacentHTML('beforeend', x)
  m.bindPopup(x)
  m.setContent(x)
}
`

  it('turns off the HTML rules for such a file only', async () => {
    expect(await ruleIds(RAW, 'src/lib/legacy.raw-html.ts')).toEqual([])
    expect(await ruleIds(RAW, 'src/lib/legacy.raw-html.tsx')).toEqual([])
    expect(await ruleIds(RAW, 'src/lib/legacy.ts')).toContain('no-restricted-properties')
    expect(await ruleIds(RAW, 'src/lib/legacy.ts')).toContain('no-restricted-syntax')
    // A look-alike name is not an exception.
    expect(await ruleIds(RAW, 'src/lib/raw-html.ts')).toContain('no-restricted-properties')
    expect(await ruleIds(RAW, 'src/lib/legacy.raw-html.js.ts')).toContain('no-restricted-syntax')
  })

  it('lets the other HTML writers through in such a file: DOMParser, setHTMLUnsafe, window.document.write', async () => {
    const code = `
export function f(el: Element, frame: HTMLIFrameElement, x: string) {
  el.setHTMLUnsafe(x)
  frame.srcdoc = x
  frame.setAttribute('srcdoc', x)
  window.document.write(x)
  return new DOMParser().parseFromString(x, 'text/html')
}
`

    expect(await ruleIds(code, 'src/lib/legacy.raw-html.ts')).toEqual([])
    expect(await ruleIds(code, 'src/lib/legacy.ts')).toContain('no-restricted-syntax')
  })

  it('wins over the test-file block as well', async () => {
    expect(await ruleIds(RAW, 'src/test/helper.raw-html.ts')).toEqual([])
  })

  it('never allows dangerouslySetInnerHTML or an unsafe link, even in such a file', async () => {
    const code = `
export const A = () => <div dangerouslySetInnerHTML={{ __html: 'x' }} />
export const B = () => <a href="javascript:alert(1)">x</a>
`

    expect(await ruleIds(code, 'src/lib/legacy.raw-html.tsx')).toEqual([
      'react/no-danger',
      'react/jsx-no-script-url',
    ])
  })

  it('never allows dangerouslySetInnerHTML as an object or srcDoc, even in such a file', async () => {
    const code = `
import { cloneElement, createElement, type ReactElement } from 'react'

export const A = (x: string) => createElement('div', { dangerouslySetInnerHTML: { __html: x } })
export const B = (el: ReactElement, x: string) =>
  cloneElement(el, { dangerouslySetInnerHTML: { __html: x } })
export const C = (x: string) => <div {...{ dangerouslySetInnerHTML: { __html: x } }} />
export const D = (x: string) => <iframe srcDoc={x} title="x" />
export const E = (x: string) => createElement('iframe', { srcDoc: x })
`
    const found = await ruleIds(code, 'src/lib/legacy.raw-html.tsx')

    // One no-restricted-syntax hit for each of A, B, C, D and E.
    expect(found.filter((id) => id === 'no-restricted-syntax')).toHaveLength(5)
  })

  it('has no exception today. Adding one means changing this list, which a reviewer sees', () => {
    const found: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
        } else if (/\.raw-html\.(?:ts|tsx)$/.test(entry.name)) {
          found.push(relative(ROOT, full).split(sep).join('/'))
        }
      }
    }
    walk(join(ROOT, 'src'))

    const ALLOWED_EXCEPTIONS: string[] = []

    expect(found.sort()).toEqual(ALLOWED_EXCEPTIONS)
  })
})

describe('no inline switch-off of a safety rule', () => {
  // Written in two parts, so that a search for the directive does not find this file.
  const DISABLE = 'eslint-' + 'disable'
  const SAFETY_RULES = [
    'no-restricted-properties',
    'no-restricted-syntax',
    'react/no-danger',
    'react/no-danger-with-children',
    'react/jsx-no-script-url',
    'react/jsx-no-target-blank',
  ]

  /**
   * True for a comment that turns off every rule, turns off a safety rule, or sets one in the
   * file (the "/* eslint rule: off *\/" form). A comment for any other rule is not this test's job.
   */
  function switchesOffSafetyRule(line: string): boolean {
    const at = line.indexOf(DISABLE)
    if (at !== -1) {
      const rest = line.slice(at + DISABLE.length).replace(/^-(?:next-)?line/, '')
      const [list = ''] = rest.replace(/\*\/.*$/, '').split(' -- ')
      const names = list
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
      return names.length === 0 || names.some((name) => SAFETY_RULES.includes(name))
    }
    return /\/\*\s*eslint\s/.test(line) && SAFETY_RULES.some((name) => line.includes(name))
  }

  it('is the reason for this search: a comment does silence the rule', async () => {
    const code = `// ${DISABLE}-next-line no-restricted-properties\nexport function f(el: Element) { el.innerHTML = 'x' }\n`

    expect(await ruleIds(code)).toEqual([])
  })

  it('spots a comment that switches off a safety rule or every rule, and only those', () => {
    const bad = [
      `/* ${DISABLE} */`,
      `/* ${DISABLE}-next-line */`,
      `/* ${DISABLE} no-restricted-properties */`,
      `// ${DISABLE}-next-line no-restricted-syntax -- needed for the map`,
      `el.innerHTML = x // ${DISABLE}-line no-restricted-properties`,
      `// ${DISABLE}-next-line react-hooks/exhaustive-deps, react/no-danger`,
      '/* eslint no-restricted-syntax: "off" */',
    ]
    const good = [
      `// ${DISABLE}-next-line @typescript-eslint/no-explicit-any`,
      `/* ${DISABLE} react-refresh/only-export-components */`,
      '// A note that names no-restricted-properties and is not a directive',
      'export const rule = "no-restricted-properties"',
    ]

    for (const line of bad) {
      expect(switchesOffSafetyRule(line), `should flag: ${line}`).toBe(true)
    }
    for (const line of good) {
      expect(switchesOffSafetyRule(line), `should allow: ${line}`).toBe(false)
    }
  })

  it('finds none in src. A file that needs an exception is named *.raw-html.ts instead', () => {
    const found: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
        } else if (/\.(?:ts|tsx)$/.test(entry.name) && full !== import.meta.filename) {
          readFileSync(full, 'utf8')
            .split(/\r?\n/)
            .forEach((line, index) => {
              if (switchesOffSafetyRule(line)) {
                found.push(`${relative(ROOT, full).split(sep).join('/')}:${index + 1}`)
              }
            })
        }
      }
    }
    walk(join(ROOT, 'src'))

    expect(found).toEqual([])
  })
})

describe('npm run lint', () => {
  it('fails on a warning, so a rule set to "warn" cannot slip through', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(pkg.scripts.lint).toBe('eslint . --max-warnings 0')
  })

  // A warning fails `npm run lint`, but with a message that is easy to miss and fix wrongly. Every
  // rule is therefore either an error or off. If a plugin update adds a rule at "warn", this test
  // names it, and eslint.config.js decides: set it to 'error' or 'off', with a comment.
  it('has no rule set to warn, in any kind of file', async () => {
    const files = [
      DEFAULT_FILE,
      'src/lib/sample.ts',
      'src/shell/sample.test.tsx',
      'src/test/helper.ts',
      'src/components/ui/sample.tsx',
      'src/lib/legacy.raw-html.tsx',
    ]
    const warned: string[] = []
    for (const file of files) {
      const config = (await eslint.calculateConfigForFile(file)) as {
        rules?: Record<string, unknown>
      }
      for (const [rule, setting] of Object.entries(config.rules ?? {})) {
        const level: unknown = Array.isArray(setting) ? setting[0] : setting
        if (level === 1 || level === 'warn') warned.push(`${file}: ${rule}`)
      }
    }

    expect(warned).toEqual([])
  })

  it('makes exhaustive-deps an error', async () => {
    const config = (await eslint.calculateConfigForFile(DEFAULT_FILE)) as {
      rules?: Record<string, unknown>
    }
    const setting = config.rules?.['react-hooks/exhaustive-deps']
    const level: unknown = Array.isArray(setting) ? setting[0] : setting

    expect(level === 2 || level === 'error').toBe(true)
  })

  it('does not run the React Compiler checks that need the compiler', async () => {
    const config = (await eslint.calculateConfigForFile(DEFAULT_FILE)) as {
      rules?: Record<string, unknown>
    }
    const setting = config.rules?.['react-hooks/incompatible-library']
    const level: unknown = Array.isArray(setting) ? setting[0] : setting

    expect(level === 0 || level === 'off').toBe(true)
  })
})
