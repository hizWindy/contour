import { describe, expect, it } from 'vitest'
import { goodLine, listWords, runLine, topSigns, whereWords } from './home-words'

const NOW = new Date('2026-11-11T02:00:00Z') // 1 pm in Melbourne

function run(over: Partial<Parameters<typeof runLine>[0]> = {}): Parameters<typeof runLine>[0] {
  return {
    status: 'done',
    mode: 'discovery',
    params: { cities: ['Perth'] },
    created_at: '2026-11-10T21:55:00Z', // 8:55 am in Melbourne, the same day
    counts: {
      researched: 4,
      by_result: { pass: 1, watch: 1 },
      candidates: 0,
      chosen: 0,
      failed: 0,
      resumes: 0,
      skipped: 0,
      slices: 0,
      slices_done: 0,
      slices_failed: 0,
      unique: 0,
    },
    ...over,
  }
}

describe('the line under the greeting', () => {
  it("says what today's run checked and found", () => {
    expect(runLine(run(), NOW)).toBe(
      "Today's run checked 4 companies in Perth and found 1 good lead and 1 to watch.",
    )
  })

  it('names yesterday, and an older run by its date', () => {
    expect(runLine(run({ created_at: '2026-11-10T01:00:00Z' }), NOW)).toMatch(/^Yesterday's run/)
    expect(runLine(run({ created_at: '2026-11-03T01:00:00Z' }), NOW)).toMatch(
      /^The run on 3 Nov 2026 checked/,
    )
  })

  it('says only what the run found', () => {
    const none = run({ counts: { ...run().counts, by_result: {} } })
    expect(runLine(none, NOW)).toBe(
      "Today's run checked 4 companies in Perth and found no new leads.",
    )
    const watch = run({ counts: { ...run().counts, by_result: { watch: 2, drop: 3 } } })
    expect(runLine(watch, NOW)).toBe(
      "Today's run checked 4 companies in Perth and added 2 to watch.",
    )
  })

  it('says a run is going, failed or stopped', () => {
    expect(runLine(run({ status: 'running' }), NOW)).toBe(
      'A run is going now in Perth: 4 companies researched so far.',
    )
    expect(runLine(run({ status: 'failed' }), NOW)).toBe(
      "Today's run in Perth failed. Open it to see why.",
    )
    expect(runLine(run({ status: 'cancelled' }), NOW)).toBe(
      "Today's run in Perth stopped after 4 companies.",
    )
  })

  it('names the test set, and leaves the place out when there is none', () => {
    expect(runLine(run({ mode: 'testset', params: {} }), NOW)).toBe(
      "Today's run checked 4 companies in the test set and found 1 good lead and 1 to watch.",
    )
    expect(whereWords({ mode: 'company', params: {} })).toBe('')
  })
})

describe('the words on the Lead Finder card', () => {
  it('joins a list in plain words', () => {
    expect(listWords([])).toBe('')
    expect(listWords(['Perth'])).toBe('Perth')
    expect(listWords(['Perth', 'Sydney', 'Brisbane'])).toBe('Perth, Sydney and Brisbane')
  })

  it('says how the good leads split', () => {
    const counts = new Map([
      ['pass', 2],
      ['director_review', 7],
    ])
    expect(goodLine(counts, 59)).toBe('2 pass and 7 for the director, out of 59 found.')
    expect(goodLine(new Map([['director_review', 1]]), 3)).toBe(
      '1 for the director, out of 3 found.',
    )
    expect(goodLine(new Map(), 5)).toBe('None yet, out of 5 found.')
  })

  it('keeps the four biggest signs, with none left out and ties in order', () => {
    const signs = topSigns([
      { id: 'a', label: 'A', count: 2 },
      { id: 'b', label: 'B', count: 0 },
      { id: 'c', label: 'C', count: 5 },
      { id: 'd', label: 'D', count: 2 },
      { id: 'e', label: 'E', count: 1 },
      { id: 'f', label: 'F', count: 1 },
    ])
    expect(signs.map((sign) => sign.id)).toEqual(['c', 'a', 'd', 'e'])
  })
})
