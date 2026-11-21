import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
  The website's Docker image installs its packages with no install script (PLAN-V24 review):
  .npmrc's `ignore-scripts=true` is copied in before `npm ci`. Without it, onnxruntime-node's
  script downloads CUDA files from NuGet on Linux x64, at no fixed version.
*/

const frontend = join(import.meta.dirname, '..', '..')

/** A file's lines, trimmed, without blank lines or comments. */
function linesOf(file: string): string[] {
  return readFileSync(join(frontend, file), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
}

describe('the website image', () => {
  it('runs no install script: .npmrc says so', () => {
    expect(linesOf('.npmrc')).toContain('ignore-scripts=true')
  })

  it('has .npmrc in place before npm ci', () => {
    const steps = linesOf('Dockerfile')
    const install = steps.findIndex((step) => /^RUN\s+npm\s+ci\b/.test(step))
    const copied = steps.findIndex(
      (step) => /^COPY\s/.test(step) && step.split(/\s+/).includes('frontend/.npmrc'),
    )

    expect(install).toBeGreaterThan(-1)
    expect(copied).toBeGreaterThan(-1)
    expect(copied).toBeLessThan(install)
  })
})
