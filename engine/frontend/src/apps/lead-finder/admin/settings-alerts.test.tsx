/**
 * Admin, Settings: PLAN-V23's two rows (T2-4), with the call notes settings. "Tell the owner about
 * calls on their companies" is the sliding switch (the owner's FYI task, T2-2), and "Names the mic
 * listens for" a number from 5 to 200 (the hint list, T1-1). The labels and descriptions are the
 * server's, as `core/prefs/service.py` sends them. The nudge is a schedule, not a setting (see
 * `schedules.test.tsx`).
 */
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { mockApi } from '@/test/mock-api'
import { renderWithProviders } from '@/test/render'
import { asLaptop, asPhone } from '@/test/screen'
import AdminSettingsTab from './settings'

const MONEY = {
  key: 'run_cap_usd',
  label: 'Cap for one run (US$)',
  description: 'The most one run may cost.',
  type: 'decimal',
  min: '1.00',
  max: '50.00',
  choices: null,
  default: '20.00',
  value: '20.00',
  overridden: false,
  editable: true,
}

const NOTES_ON = {
  ...MONEY,
  key: 'call_notes_enabled',
  label: 'Call notes are on',
  description: 'Shows Log call in call prep and the Call logs page.',
  type: 'bool',
  min: null,
  max: null,
  default: false,
  value: true,
}

const HINTS = {
  ...MONEY,
  key: 'name_hints_max',
  label: 'Names the mic listens for',
  description:
    'The most names the mic is told to listen for when someone presses V, most likely first. A long list can make it hear names nobody said.',
  type: 'int',
  min: 5,
  max: 200,
  default: 50,
  value: 50,
}

const OWNER_FYI = {
  ...MONEY,
  key: 'notify_owner_calls',
  label: 'Tell the owner about calls on their companies',
  description:
    "When someone logs a call with a company they don't own, the company's owner gets an FYI task in HubSpot once the call is there. One per call.",
  type: 'bool',
  min: null,
  max: null,
  default: true,
  value: true,
}

function settingsOut() {
  return { daily_left_usd: '48.50', fields: [MONEY, NOTES_ON, HINTS, OWNER_FYI] }
}

describe.each([
  ['a laptop (1440px)', asLaptop],
  ['a phone (390px)', asPhone],
])("PLAN-V23's settings, on %s", (_width, size) => {
  it('sit with the call notes settings, the owner FYI as a sliding switch', async () => {
    size()
    // The same answer to the read and to the save.
    const calls = mockApi({ '/api/v1/settings': settingsOut() })
    const { user } = renderWithProviders(<AdminSettingsTab />)
    await screen.findByRole('list', { name: 'Money' })
    // Not under Runs, where a setting nobody placed would land.
    const groups = within(screen.getByRole('radiogroup', { name: 'Settings group' }))
    expect(groups.getAllByRole('radio').map((radio) => radio.textContent)).toEqual([
      'Money',
      'Call notes',
    ])
    await user.click(groups.getByRole('radio', { name: 'Call notes' }))
    const notes = within(screen.getByRole('list', { name: 'Call notes' }))

    const fyi = notes.getByRole('switch', { name: 'Tell the owner about calls on their companies' })
    expect(fyi).toBeChecked()
    expect(
      notes.getByText(
        "When someone logs a call with a company they don't own, the company's owner gets an FYI task in HubSpot once the call is there.",
      ),
    ).toBeInTheDocument()

    const hints = notes.getByRole('textbox', { name: 'Names the mic listens for' })
    expect(hints).toHaveValue('50')
    await user.click(screen.getByRole('button', { name: 'Show the details' }))
    expect(hints).toHaveAccessibleDescription(/From 5 to 200\.$/)

    await user.click(fyi)
    await user.clear(hints)
    await user.type(hints, '30')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
        values: { notify_owner_calls: false, name_hints_max: 30 },
      })
    })
  })
})
