import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DESIGN_RULES,
  isExcluded,
  OUTSIDE_SRC_RULES,
  SCANNED_EXTENSIONS,
  scanSource,
  type Violation,
} from './design-rules'

const SRC = join(import.meta.dirname, '..')
const ROOT = join(SRC, '..')

function collect(dir: string, extensions: readonly string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      return collect(full, extensions)
    }
    return extensions.some((ext) => entry.name.endsWith(ext)) ? [full] : []
  })
}

function slashes(base: string, full: string): string {
  return relative(base, full).split(sep).join('/')
}

const files = collect(SRC, SCANNED_EXTENSIONS)
  .map((full) => slashes(SRC, full))
  .filter((path) => !isExcluded(path))
  .sort()

const violations: Violation[] = files.flatMap((path) =>
  scanSource(path, readFileSync(join(SRC, path), 'utf8')),
)

/*
  Outside src: index.html, everything text in public/, and the config files in the frontend root
  (vite.config.ts, eslint.config.js, ...). They hold the page title, the favicon title and
  comments, so the em dash rule runs on them. The other rules do not: a favicon draws with hex
  colours on purpose, and a config file may name a banned class in a rule.
*/
const PUBLIC_TEXT_EXTENSIONS = [
  '.html',
  '.svg',
  '.css',
  '.js',
  '.mjs',
  '.json',
  '.txt',
  '.xml',
  '.webmanifest',
  '.md',
]
const ROOT_CONFIG_PATTERN = /\.[cm]?[jt]s$/

const outsideFiles = [
  ...readdirSync(ROOT, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && (entry.name === 'index.html' || ROOT_CONFIG_PATTERN.test(entry.name)),
    )
    .map((entry) => entry.name),
  ...(existsSync(join(ROOT, 'public'))
    ? collect(join(ROOT, 'public'), PUBLIC_TEXT_EXTENSIONS).map((full) => slashes(ROOT, full))
    : []),
].sort()

const outsideViolations: Violation[] = outsideFiles.flatMap((path) =>
  scanSource(path, readFileSync(join(ROOT, path), 'utf8'), OUTSIDE_SRC_RULES),
)

function describeViolations(found: Violation[]): string {
  return found.map((v) => `${v.file}:${v.line} [${v.rule}] ${v.text}`).join('\n')
}

describe('design lint: every rule catches what it should', () => {
  it('has a unique id, a message, and at least one bad and one good example per rule', () => {
    const ids = DESIGN_RULES.map((rule) => rule.id)

    expect(new Set(ids).size).toBe(ids.length)
    for (const rule of DESIGN_RULES) {
      expect(rule.message.length, `${rule.id} needs a message`).toBeGreaterThan(10)
      expect(rule.bad.length, `${rule.id} needs a bad example`).toBeGreaterThan(0)
      expect(rule.good.length, `${rule.id} needs a good example`).toBeGreaterThan(0)
    }
  })

  it('covers the banned items in DESIGN.md that a machine can read', () => {
    expect(DESIGN_RULES.map((rule) => rule.id)).toEqual(
      expect.arrayContaining([
        'em-dash',
        'pills',
        'big-radius',
        'arbitrary-radius',
        'inline-radius',
        'looping-motion',
        'animation-infinite',
        'animate-arbitrary',
        'shimmer',
        'backdrop-blur',
        'blur',
        'gradients',
        'hover-size-or-shadow',
        'hover-translate-active-scale',
        'uppercase',
        'sparkles',
        'emoji',
        'hex-colour',
        'colour-function',
        'palette-colour',
        'font-weight',
        'type-scale',
        'motion-timing',
        'shadow',
      ]),
    )
  })

  for (const rule of DESIGN_RULES) {
    it(`${rule.id}: flags its bad examples and leaves its good ones`, () => {
      for (const sample of rule.bad) {
        expect(rule.pattern.test(sample), `should flag: ${sample}`).toBe(true)
      }
      for (const sample of rule.good) {
        expect(rule.pattern.test(sample), `should allow: ${sample}`).toBe(false)
      }
    })

    it(`${rule.id}: the scanner reports its bad examples under its own id`, () => {
      for (const sample of rule.bad) {
        const found = scanSource('components/example.tsx', `before\n${sample}\nafter`)

        expect(
          found.filter((v) => v.rule === rule.id).map((v) => v.line),
          `scanSource should flag on line 2: ${sample}`,
        ).toEqual([2])
      }
    })
  }

  it('lets colours live in styles/tokens.css and nowhere else', () => {
    const hex = scanSource('styles/tokens.css', 'color: #233A56;')
    const other = scanSource('components/ui/button.tsx', 'color: #233A56;')

    expect(hex).toEqual([])
    expect(other.map((v) => v.rule)).toEqual(['hex-colour'])
  })

  it('does not mistake tokens and enter animations for banned things', () => {
    const fine = [
      'className="rounded-lg bg-card text-ui font-semibold hover:bg-muted duration-150 normal-case"',
      'className="animate-in fade-in-0 data-closed:animate-out rounded-[inherit]"',
      "const label = 'About 3,000 m\\u00B2'",
    ].join('\n')

    expect(scanSource('components/example.tsx', fine)).toEqual([])
  })
})

describe('design lint: src follows engine/DESIGN.md', () => {
  it('scans the source files', () => {
    expect(files).toContain('styles/tokens.css')
    expect(files).toContain('styles/index.css')
    expect(files).toContain('components/ui/button.tsx')
    expect(files.some((path) => path.startsWith('test/'))).toBe(false)
  })

  for (const rule of DESIGN_RULES) {
    it(`${rule.id}: ${rule.message}`, () => {
      const found = violations.filter((v) => v.rule === rule.id)

      expect(describeViolations(found)).toBe('')
    })
  }
})

describe('design lint: no em dash in index.html, public/ and the config files', () => {
  it('runs only the em dash rule outside src', () => {
    expect(OUTSIDE_SRC_RULES.map((rule) => rule.id)).toEqual(['em-dash'])
    expect(
      scanSource(
        'public/favicon.svg',
        'fill: #233A56; text-transform: uppercase',
        OUTSIDE_SRC_RULES,
      ),
    ).toEqual([])
    expect(
      // Written as escapes, so this file holds no literal em dash (see design-rules.ts).
      scanSource('index.html', '<title>Lead Finder \u2014 results</title>', OUTSIDE_SRC_RULES).map(
        (v) => `${v.file}:${v.line}:${v.rule}`,
      ),
    ).toEqual(['index.html:1:em-dash'])
    expect(
      scanSource('vite.config.ts', '// the dev server \u2014 localhost', OUTSIDE_SRC_RULES),
    ).toHaveLength(1)
  })

  it('scans the page, the public files and the root config files', () => {
    expect(outsideFiles).toContain('index.html')
    expect(outsideFiles).toContain('public/favicon.svg')
    expect(outsideFiles).toContain('vite.config.ts')
    expect(outsideFiles).toContain('eslint.config.js')
    expect(outsideFiles.some((path) => path.startsWith('src/'))).toBe(false)
    expect(outsideFiles.some((path) => path.includes('node_modules'))).toBe(false)
  })

  it('finds none', () => {
    expect(describeViolations(outsideViolations)).toBe('')
  })
})
