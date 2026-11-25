/**
 * Settings' live voice line (PLAN-V28 T1-5), against the generated contract and a fake server, at a
 * laptop's width (1440 px) and a phone's (390 px): "Live voice: monthly limit (US$)" in Money, and
 * this month's use right under it: "Live voice this month: 42 minutes, about US$0.51 of US$4.00.",
 * read only where the limit is on the page, said plainly when it can't be read, and holding its
 * place while it loads.
 */
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockApi } from '@/test/mock-api'
import { renderWithProviders } from '@/test/render'
import { asLaptop, asPhone } from '@/test/screen'
import AdminSettingsTab from './settings'

const MONTH = {
  month: '2026-11',
  minutes: 42,
  talks: 9,
  spent_usd: '0.51',
  cap_usd: '4.00',
  line: 'Live voice this month: 42 minutes, about US$0.51 of US$4.00.',
}

const LIMIT = {
  key: 'live_voice_month_cap_usd',
  label: 'Live voice: monthly limit (US$)',
  description: 'The most live voice may cost in a month. Talks stop at it.',
  type: 'decimal',
  min: '0.00',
  max: '5.00',
  choices: null,
  default: '4.00',
  value: '4.00',
  overridden: false,
  editable: true,
}

const RUN_CAP = {
  ...LIMIT,
  key: 'run_cap_usd',
  label: 'Cap for one run (US$)',
  description: 'The most one run may cost.',
  max: '50.00',
  default: '20.00',
  value: '20.00',
}

function settingsOut(fields: unknown[]) {
  return { daily_left_usd: '48.50', fields }
}

describe.each([
  ['1440 px (a laptop)', asLaptop],
  ['390 px (a phone)', asPhone],
])('at %s', (_, width) => {
  describe("Settings: live voice's monthly limit, and this month (T1-1, T1-5)", () => {
    it("puts the limit in Money, with this month's use right under it", async () => {
      width()
      mockApi({
        '/api/v1/settings': settingsOut([RUN_CAP, LIMIT]),
        '/api/v1/companies/assistant/voice/month': MONTH,
      })
      renderWithProviders(<AdminSettingsTab />)
      const limit = await screen.findByLabelText('Live voice: monthly limit (US$)')
      const money = screen.getByRole('list', { name: 'Money' })

      expect(money).toContainElement(limit)
      const row = limit.closest('li') as HTMLElement
      expect(await within(row).findByText(MONTH.line)).toBeInTheDocument()
    })

    it('asks for the month only where the limit is on the page', async () => {
      width()
      const calls = mockApi({
        '/api/v1/settings': settingsOut([RUN_CAP]),
        '/api/v1/companies/assistant/voice/month': MONTH,
      })
      renderWithProviders(<AdminSettingsTab />)
      await screen.findByLabelText('Cap for one run (US$)')

      expect(calls.some((call) => call.path.endsWith('/voice/month'))).toBe(false)
      expect(screen.queryByText(MONTH.line)).toBeNull()
    })

    it("says plainly when this month couldn't be read, and the limit still works", async () => {
      width()
      mockApi({
        '/api/v1/settings': settingsOut([RUN_CAP, LIMIT]),
        '/api/v1/companies/assistant/voice/month': () =>
          Response.json({ title: 'Down', status: 503 }, { status: 503 }),
      })
      renderWithProviders(<AdminSettingsTab />)
      const limit = await screen.findByLabelText('Live voice: monthly limit (US$)')
      const row = limit.closest('li') as HTMLElement

      expect(
        await within(row).findByText(
          "This month's live voice couldn't be read. Try again in a minute.",
        ),
      ).toBeInTheDocument()
      expect(limit).toBeEnabled()
    })
  })
})

describe('the month line keeps its place while it loads', () => {
  it('holds one line, so nothing jumps when it comes', async () => {
    let answer: (value: Response) => void = () => undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const path = new URL(request.url).pathname
        if (path === '/api/v1/settings') return Response.json(settingsOut([LIMIT]))
        if (path !== '/api/v1/companies/assistant/voice/month') {
          return Response.json({ title: 'Not faked', status: 404 }, { status: 404 })
        }
        // The month answers only when the test says.
        return new Promise<Response>((resolve) => {
          answer = resolve
        })
      }),
    )
    renderWithProviders(<AdminSettingsTab />)
    const limit = await screen.findByLabelText('Live voice: monthly limit (US$)')
    const row = limit.closest('li') as HTMLElement
    const line = row.querySelector('[data-slot=live-voice-month]')

    expect(line).not.toBeNull()
    expect(line?.textContent).toBe(' ')
    answer(Response.json(MONTH))
    await waitFor(() => {
      expect(row.querySelector('[data-slot=live-voice-month]')).toHaveTextContent(MONTH.line)
    })
  })
})
