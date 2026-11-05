import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string): string => readFileSync(join(import.meta.dirname, file), 'utf8')

describe('the parts of Results that few visits need (PLAN-V7 D1)', () => {
  it('are not imported by the page itself, or its code file would carry their libraries', () => {
    for (const file of ['index.tsx', 'filter-bar.tsx', 'lead-panel.tsx', 'columns.tsx']) {
      const source = read(file)

      // The date picker library (react-day-picker with date-fns) and the panel library.
      expect(source, file).not.toMatch(/from ['"]@\/components\/ui\/(calendar|resizable)['"]/)
      expect(source, file).not.toMatch(/from ['"]\.\/map-split['"]/)
    }
  })

  it('load only through lazy-parts.ts, which the page and the filter bar read', () => {
    const parts = read('lazy-parts.ts')

    expect(parts).toContain("import('./map-split')")
    expect(parts).toContain("import('@/components/ui/calendar')")
    expect(read('index.tsx')).toContain("from './lazy-parts'")
    expect(read('filter-bar.tsx')).toContain("from './lazy-parts'")
  })
})
