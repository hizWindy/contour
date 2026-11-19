/**
 * Today's "Pre-reads for you" (PLAN-V23 T2-4, choice 9) against a fake server: the part right after
 * the meetings, each row's time, company, title and sender, Open and Enter to the pre-read, the
 * empty line, and the part only where the server lists it. At a laptop's width (1440px) and a
 * phone's (390px). Made-up names only: Sample Logistics Pty Ltd, Vitera Pty Ltd, Sam Sample.
 */
import { act, screen, within } from '@testing-library/react'
import { useLocation } from 'react-router'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/api/query'
import type { CallNoteOptions, Today } from '@/api/types'
import { mockApi } from '@/test/mock-api'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { asLaptop, asPhone } from '@/test/screen'
import { closeCard } from '../card/store'
import { showOnScreen } from '../voice/on-screen'
import { closeVoiceBar } from '../voice/store'
import { SAMPLE, TEST_NOW, today, VITERA } from './fixtures'
import TodayPage from './index'
import { nothingToday, rowsOf, type TodayPreRead } from './rows'

const TODAY = '/api/v1/companies/assistant/today'
const OPTIONS = '/api/v1/companies/call-notes/options'

const FORM_TOMORROW = '7a1c2b3d-1111-2222-3333-444444444444'
const FORM_LATER = '7a1c2b3d-5555-6666-7777-888888888888'

function preRead(change: Partial<TodayPreRead> = {}): TodayPreRead {
  return {
    form_id: FORM_TOMORROW,
    title: 'Design review',
    starts_at: '2026-11-20T14:00:00+11:00',
    company: SAMPLE,
    sent_by: 'Sam Sample',
    ...change,
  }
}

/** Two pre-reads sent to me: tomorrow's, and one next week from someone whose account is gone. */
const SENT_TO_ME = [
  preRead(),
  preRead({
    form_id: FORM_LATER,
    title: 'Site walk-through',
    starts_at: '2026-11-26T09:30:00+11:00',
    company: VITERA,
    sent_by: null,
  }),
]

function options(): CallNoteOptions {
  return {
    enabled: true,
    ai_enabled: true,
    sending_ready: true,
    waiting_for: null,
    outcomes: ['Connected'],
    fields: [],
    soft_seconds: 180,
    max_chars: 6000,
    voice_tool: 'browser_service',
  }
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function openToday(answer: Today) {
  mockApi({ [TODAY]: answer, [OPTIONS]: options() })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), { state: 'off' })
  return renderWithProviders(
    <>
      <TodayPage />
      <Where />
    </>,
    { queryClient, route: '/assistant' },
  )
}

const withPreReads = (change: Partial<Today> = {}): Today =>
  today({
    parts: ['tasks', 'meetings', 'pre_reads', 'calls', 'deals'],
    pre_reads: SENT_TO_ME,
    ...change,
  })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: TEST_NOW })
})

afterEach(() => {
  toast.dismiss()
  showOnScreen(null)
  act(() => {
    closeVoiceBar()
    closeCard()
  })
})

describe.each([
  ['a laptop (1440px)', asLaptop],
  ['a phone (390px)', asPhone],
])('Pre-reads for you, on %s', (_width, size) => {
  beforeEach(() => {
    size()
  })

  it('comes right after the meetings, each row with its time, company, title and sender', async () => {
    openToday(withPreReads())
    const part = within(await screen.findByRole('region', { name: 'Pre-reads for you' }))
    const titles = screen.getAllByRole('heading', { level: 2 }).map((one) => one.textContent)
    expect(titles.indexOf('Pre-reads for you')).toBe(
      titles.indexOf('Your meetings today and tomorrow') + 1,
    )

    const first = part.getByRole('article', { name: 'Tomorrow, 2:00 pm Sample Logistics Pty Ltd' })
    expect(within(first).getByText('Design review')).toBeInTheDocument()
    expect(within(first).getByText('Sent by Sam Sample')).toBeInTheDocument()
    expect(within(first).getByRole('link', { name: /^Open/ })).toHaveAttribute(
      'href',
      `/assistant/meetings/${FORM_TOMORROW}`,
    )

    // Next week's shows its day; with its sender's account gone, no "Sent by" line.
    const later = part.getByRole('article', { name: 'Thu 26 Nov, 9:30 am Vitera Pty Ltd' })
    expect(within(later).getByText('Site walk-through')).toBeInTheDocument()
    expect(within(later).queryByText(/Sent by/)).toBeNull()
  })

  it('names the pre-read on its Open button, for a screen reader', async () => {
    openToday(withPreReads())
    const part = within(await screen.findByRole('region', { name: 'Pre-reads for you' }))
    expect(
      part.getByRole('link', {
        name: 'Open: the pre-read for Sample Logistics Pty Ltd, Tomorrow, 2:00 pm',
      }),
    ).toBeInTheDocument()
  })

  it('says so, in the serif voice, when nobody has sent one', async () => {
    openToday(withPreReads({ pre_reads: [] }))
    const part = within(await screen.findByRole('region', { name: 'Pre-reads for you' }))
    expect(part.getByText('No pre-reads sent to you.')).toHaveClass('font-serif')
  })
})

describe('Pre-reads for you, its place and its keys', () => {
  it('shows only where the server lists it', async () => {
    // Without the Meetings tick, a pre-read can't be opened: the server leaves the part out.
    openToday(today({ parts: ['tasks', 'calls', 'deals'], pre_reads: SENT_TO_ME }))
    await screen.findByRole('region', { name: 'Your HubSpot tasks' })
    expect(screen.queryByRole('region', { name: 'Pre-reads for you' })).toBeNull()
  })

  it('takes J and K with the other rows, and Enter opens the pre-read', async () => {
    const { user } = openToday(withPreReads({ parts: ['pre_reads', 'calls'] }))
    await screen.findByRole('region', { name: 'Pre-reads for you' })
    await user.keyboard('j')
    const first = screen.getByRole('article', {
      name: 'Tomorrow, 2:00 pm Sample Logistics Pty Ltd',
    })
    expect(first).toHaveAttribute('aria-current', 'true')
    expect(first).toHaveFocus()
    await user.keyboard('j')
    expect(
      screen.getByRole('article', { name: 'Thu 26 Nov, 9:30 am Vitera Pty Ltd' }),
    ).toHaveAttribute('aria-current', 'true')
    await user.keyboard('k')
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('where')).toHaveTextContent(`/assistant/meetings/${FORM_TOMORROW}`)
  })
})

describe("the rows' rules", () => {
  it('put the pre-reads after the meetings and before the calls', () => {
    const ids = rowsOf(withPreReads(), { soonOpen: false }).map((row) => row.id)
    const firstPreRead = ids.indexOf(`pre-read:${FORM_TOMORROW}`)
    expect(ids[firstPreRead - 1]).toMatch(/^meeting:/)
    expect(ids[firstPreRead + 1]).toBe(`pre-read:${FORM_LATER}`)
    expect(ids[firstPreRead + 2]).toBe('calls:to_confirm')
  })

  it('count a pre-read as something on the day', () => {
    const empty = today({
      parts: ['pre_reads', 'calls'],
      tasks: [],
      meetings: [],
      calls: { to_confirm: 0, needs_look: 0 },
      deals: [],
    })
    expect(nothingToday({ ...empty, pre_reads: [] })).toBe(true)
    expect(nothingToday({ ...empty, pre_reads: [preRead()] })).toBe(false)
    // A server that doesn't send them yet (the fixture has none): nothing.
    expect('pre_reads' in empty).toBe(false)
    expect(nothingToday(empty)).toBe(true)
  })
})
