import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PrepScript } from '@/api/types'
import { mockApi } from '@/test/mock-api'
import { renderWithProviders } from '@/test/render'
import { detail, JASON, TODAY } from './guide-fixtures'
import { guideText } from './playbook'
import { useGuide, type UseGuideInput } from './use-guide'

const EDITS = '/api/v1/companies/script-edits'
const LABELS: ReadonlyMap<string, string> = new Map([['F7', 'HubSpot: Perth office']])
const COMPANY = detail()

/** What "Copy script" would copy: the modal passes the same guide to `guideText`. */
function Copied(props: Partial<UseGuideInput>) {
  const guide = useGuide({
    script: null,
    labels: LABELS,
    company: COMPANY,
    picking: false,
    person: JASON,
    caller: 'Mia Wong',
    today: TODAY,
    companyKey: '101',
    contactId: '201',
    ...props,
  })
  return <pre data-testid="copied">{guide ? guideText(guide, 'Jason Reeds') : 'no guide'}</pre>
}

const copied = (): string => screen.getByTestId('copied').textContent

describe('the guide the card shows and copies', () => {
  it('"Copy script" copies a line the person edited, for this call', async () => {
    const calls = mockApi({
      [EDITS]: [{ slot: 'opener.1', text: 'Calling about the Perth move.', updated_at: TODAY }],
    })
    renderWithProviders(<Copied />)

    await waitFor(() => {
      expect(copied()).toContain('- Calling about the Perth move.')
    })
    expect(copied()).not.toContain('I wanted to follow up on Perth fit-out.')
    // The edits asked for are this call's: the company and the person.
    expect(calls.find((call) => call.path === EDITS)?.search).toBe(
      '?company_key=101&contact_id=201',
    )
  })

  it('shows the draft while the edits load, and when they fail', async () => {
    const calls = mockApi({}) // every call is a 404
    renderWithProviders(<Copied />)
    expect(copied()).toContain('I wanted to follow up on Perth fit-out.')
    await waitFor(() => {
      expect(calls.some((call) => call.path === EDITS)).toBe(true)
    })
    expect(copied()).toContain('I wanted to follow up on Perth fit-out.')
  })

  it('a cold call asks for the edits with no contact', async () => {
    const calls = mockApi({ [EDITS]: [] })
    renderWithProviders(<Copied person={null} contactId={null} />)
    await waitFor(() => {
      expect(calls.find((call) => call.path === EDITS)?.search).toBe('?company_key=101')
    })
  })

  it('asks for nothing while "Who are you calling?" is open', () => {
    const calls = mockApi({ [EDITS]: [] })
    renderWithProviders(<Copied picking />)
    expect(copied()).toBe('no guide')
    expect(calls).toHaveLength(0)
  })

  it("lays the edits over Claude's script too, and gives it the free script's tone", async () => {
    mockApi({ [EDITS]: [{ slot: 'goal', text: 'Get a site visit booked.', updated_at: TODAY }] })
    const script = {
      still_there: 'yes',
      still_there_note: null,
      news: [],
      opener: [{ text: 'Hi Jason.', sources: ['F7'] }],
      why_now: [],
      questions: [],
      if_they_say: [],
      goal: { text: 'Book a site visit.', sources: ['F7'] },
      dropped: 0,
    } as unknown as PrepScript
    renderWithProviders(<Copied script={script} />)

    await waitFor(() => {
      expect(copied()).toContain('5. Goal of the call\n- Get a site visit booked.')
    })
    expect(copied()).toContain('Tone: Warm. You have spoken before, so pick up where you left off.')
  })
})
