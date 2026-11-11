/**
 * Call prep's error words on the card (PLAN-V15 T3-7): one instruction at a time, a status check
 * that keeps failing stops on "Lost touch with the server", a script with nothing sure enough falls
 * back to the free one, edits that fail to load say so, and an old HubSpot copy says how old.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PREP_MISSES, PREP_POLL_MS, prepLost, prepPollMs } from '@/api/hooks/companies'
import type { PrepScript } from '@/api/types'
import { mockApi } from '@/test/mock-api'
import { renderWithProviders } from '@/test/render'
import { detail, JASON, TODAY } from './guide-fixtures'
import { guideText } from './playbook'
import { ScriptHeader, type ScriptHeaderProps } from './script-header'
import { COPY_OLD_DAYS, copyWords, toneHint } from './style-words'
import { EDITS_FAILED, NOTHING_SURE, useGuide, type UseGuideInput } from './use-guide'

const EDITS = '/api/v1/companies/script-edits'
const TECHNICAL = /uv run|docker|engine serve|\.env\b|localhost|127\.0\.0\.1|[A-Z]{3,}_[A-Z_]{3,}/

function Copied(props: Partial<UseGuideInput>) {
  const guide = useGuide({
    script: null,
    labels: new Map(),
    company: detail(),
    picking: false,
    person: JASON,
    caller: 'Mia Wong',
    today: TODAY,
    companyKey: '101',
    contactId: '201',
    ...props,
  })
  return (
    <>
      <p data-testid="notices">{guide?.notices?.join(' | ') ?? ''}</p>
      <pre data-testid="copied">{guide ? guideText(guide, 'Jason Reeds') : 'no guide'}</pre>
    </>
  )
}

const EMPTY = {
  still_there: 'unknown',
  still_there_note: null,
  news: [],
  opener: [],
  why_now: [],
  questions: [],
  if_they_say: [],
  goal: null,
  dropped: 6,
} as unknown as PrepScript

describe('status checks that keep failing', () => {
  it(`stop after ${String(PREP_MISSES)} failures in a row, and only while searching`, () => {
    expect(prepPollMs('searching', 0)).toBe(PREP_POLL_MS)
    expect(prepPollMs('searching', PREP_MISSES - 1)).toBe(PREP_POLL_MS)
    expect(prepPollMs('searching', PREP_MISSES)).toBe(false)
    expect(prepPollMs('ready', 0)).toBe(false)
    expect(prepLost('searching', PREP_MISSES)).toBe(true)
    expect(prepLost('searching', 1)).toBe(false)
    expect(prepLost('failed', PREP_MISSES)).toBe(false)
  })
})

describe("the card's script", () => {
  it("falls back to the free script when every line of Claude's was left out", async () => {
    mockApi({ [EDITS]: [] })
    renderWithProviders(<Copied script={EMPTY} />)
    await waitFor(() => {
      expect(screen.getByTestId('notices').textContent).toBe(NOTHING_SURE)
    })
    // The free script, with its own opener, not an empty one.
    expect(screen.getByTestId('copied').textContent).toContain(
      "Hi Jason, it's Mia from Contour. We spoke on 1 Oct.",
    )
  })

  it("says so in one line when the person's own lines can't be loaded", async () => {
    mockApi({})
    renderWithProviders(<Copied />)
    await waitFor(() => {
      expect(screen.getByTestId('notices').textContent).toBe(EDITS_FAILED)
    })
    expect(screen.getByTestId('copied').textContent).toContain('1. Opener')
  })
})

describe('the script header', () => {
  const props = (changes: Partial<ScriptHeaderProps> = {}): ScriptHeaderProps => ({
    madeFrom: 'hubspot',
    prep: undefined,
    enabled: true,
    namesOk: true,
    capUsd: '0.25',
    running: false,
    stage: 0,
    failed: false,
    onResearch: () => undefined,
    ...changes,
  })
  const daysAgo = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString()

  it(`says the HubSpot copy is old once it is over ${String(COPY_OLD_DAYS)} days old`, () => {
    const { rerender } = render(<ScriptHeader {...props({ copyAt: daysAgo(3) })} />)
    expect(screen.getByText('HubSpot copy from 3 days ago.')).toBeInTheDocument()
    rerender(<ScriptHeader {...props({ copyAt: daysAgo(1) })} />)
    expect(screen.queryByText(/^HubSpot copy from/)).not.toBeInTheDocument()
    expect(copyWords(null)).toBeNull()
    expect(copyWords('2026-10-01T00:00:00Z', new Date('2026-11-12T00:00:00Z'))).toBe(
      'HubSpot copy from 1 Oct 2026.',
    )
  })
})

describe('no technical words', () => {
  it('in any message the card adds', () => {
    const messages = [
      NOTHING_SURE,
      EDITS_FAILED,
      "Call prep couldn't finish. Try again.",
      'Lost touch with the server. The script below is from our HubSpot copy.',
      copyWords(daysAgo(5)),
      toneHint('friendly', 'formal'),
    ]
    for (const message of messages) {
      expect(message, String(message)).not.toMatch(TECHNICAL)
      expect(message).not.toMatch(/Research again.*Try again|Try again.*Research again/)
    }
  })
})

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}
