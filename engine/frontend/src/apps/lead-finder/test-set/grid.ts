/**
 * The Test set grid (PLAN-V13 T2-7): the companies down the side, the last runs across, and
 * which cells changed from the run before. Pure functions, so the view stays about layout and
 * the tests can check the sums.
 */
import type { LeadResult, TestPage, TestReport } from '@/api/types'

export type TestSummary = TestPage['items'][number]
export type TestItem = TestReport['items'][number]

/** How many runs the grid shows across. */
export const RUNS_ACROSS = 5

export interface GridCell {
  run: TestSummary
  /** What this run said about the company, or nothing when the run has no row for it. */
  item: TestItem | undefined
  /** The result differs from the run before (the column to the left). */
  changed: boolean
}

export interface GridRow {
  name: string
  city: string | null
  expected: readonly LeadResult[] | null
  cells: GridCell[]
}

export interface Grid {
  /** Oldest first, so "the run before" is the column to the left. */
  runs: TestSummary[]
  rows: GridRow[]
}

/**
 * Builds the grid from the newest runs (as the API lists them, newest first) and their reports.
 * The rows are the companies of the newest run that has a report, in its order, then any company
 * only an older run had. A report still loading leaves its column empty.
 */
export function buildGrid(
  newestFirst: readonly TestSummary[],
  reports: ReadonlyMap<string, TestReport | undefined>,
): Grid {
  const runs = newestFirst.slice(0, RUNS_ACROSS).reverse()
  const names: string[] = []
  const seen = new Set<string>()
  for (const run of [...runs].reverse()) {
    for (const item of reports.get(run.run_id)?.items ?? []) {
      if (!seen.has(item.name)) {
        seen.add(item.name)
        names.push(item.name)
      }
    }
  }
  const rows = names.map((name) => {
    let previous: TestItem | undefined
    let known = false
    const cells = runs.map((run) => {
      const report = reports.get(run.run_id)
      const item = report?.items.find((row) => row.name === name)
      const changed = known && report !== undefined && resultOf(item) !== resultOf(previous)
      if (report !== undefined) {
        previous = item
        known = true
      }
      return { run, item, changed }
    })
    const newest = [...cells].reverse().find((cell) => cell.item)?.item
    return { name, city: newest?.city ?? null, expected: newest?.expected ?? null, cells }
  })
  return { runs, rows }
}

/** A result, or "failed" for a company the run could not research, or null for no row. */
export function resultOf(item: TestItem | undefined): string | null {
  if (!item) return null
  return item.result ?? 'failed'
}

/** "8 of 10 as expected, US$4.10, 3 Nov 2026". */
export function summaryLine(
  run: TestSummary,
  words: { money: (value: string) => string; date: (value: string) => string },
): string {
  return `${run.matched} of ${run.expected} as expected, ${words.money(run.total_cost_usd)}, ${words.date(run.created_at)}`
}

/** How the newest run compares with the one before: better, the same, or worse. */
export function compared(newest: TestSummary, before: TestSummary): 'better' | 'same' | 'worse' {
  const a = newest.expected ? newest.matched / newest.expected : 0
  const b = before.expected ? before.matched / before.expected : 0
  if (a > b) return 'better'
  if (a < b) return 'worse'
  return 'same'
}

/** What changed for one company between two runs, in words, or null when nothing did. */
export function changeWords(
  before: TestItem | undefined,
  after: TestItem | undefined,
  label: (result: string) => string,
): string | null {
  const from = resultOf(before)
  const to = resultOf(after)
  if (from === to) {
    if (before?.score != null && after?.score != null && before.score !== after.score) {
      return `Score ${before.score} to ${after.score}`
    }
    return null
  }
  if (from === null) return `New: ${label(to ?? '')}`
  if (to === null) return `Not in this run (was ${label(from)})`
  return `${label(from)} to ${label(to)}`
}
