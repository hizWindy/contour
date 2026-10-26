import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DESIGN_RULES,
  isExcluded,
  SCANNED_EXTENSIONS,
  scanSource,
  type Violation,
} from './design-rules'

const SRC = join(import.meta.dirname, '..')

function collect(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      return collect(full)
    }
    return SCANNED_EXTENSIONS.some((ext) => entry.name.endsWith(ext)) ? [full] : []
  })
}

const files = collect(SRC)
  .map((full) => relative(SRC, full).split(sep).join('/'))
  .filter((path) => !isExcluded(path))
  .sort()

const violations: Violation[] = files.flatMap((path) =>
  scanSource(path, readFileSync(join(SRC, path), 'utf8')),
)

function describeViolations(found: Violation[]): string {
  return found.map((v) => `${v.file}:${v.line} [${v.rule}] ${v.text}`).join('\n')
}

describe('design lint: every rule catches what it should', () => {
  for (const rule of DESIGN_RULES) {
    it(`${rule.id}: flags its bad examples and leaves its good ones`, () => {
      for (const sample of rule.bad) {
        expect(rule.pattern.test(sample), `should flag: ${sample}`).toBe(true)
      }
      for (const sample of rule.good) {
        expect(rule.pattern.test(sample), `should allow: ${sample}`).toBe(false)
      }
    })
  }

  it('lets colours live in styles/tokens.css and nowhere else', () => {
    const hex = scanSource('styles/tokens.css', 'color: #233A56;')
    const other = scanSource('components/ui/button.tsx', 'color: #233A56;')

    expect(hex).toEqual([])
    expect(other.map((v) => v.rule)).toEqual(['hex-colour'])
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
