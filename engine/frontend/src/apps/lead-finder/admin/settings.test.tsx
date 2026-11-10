import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { mockApi, type Call } from '@/test/mock-api'
import { renderWithProviders } from '@/test/render'
import AdminSettingsTab from './settings'

const SETTING = {
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

function settingsOut(changes: Record<string, unknown> = {}) {
  return {
    daily_left_usd: '48.50',
    fields: [
      { ...SETTING, ...changes },
      {
        key: 'hubspot_names_to_claude_ok',
        label: 'HubSpot names may go to Claude',
        description: 'The data approval from Levi.',
        type: 'bool',
        min: null,
        max: null,
        choices: null,
        default: false,
        value: false,
        overridden: false,
        editable: false,
      },
    ],
  }
}

describe('Admin, Settings', () => {
  it('saves only what changed, and shows the server refusing a value beside its field', async () => {
    const calls = mockApi({
      '/api/v1/settings': (call: Call) =>
        call.method === 'PATCH'
          ? Response.json(
              {
                title: "The settings aren't valid",
                status: 422,
                errors: [{ field: 'body.values.run_cap_usd', message: 'Must be at most 50.00.' }],
              },
              { status: 422 },
            )
          : Response.json(settingsOut()),
    })
    const { user } = renderWithProviders(<AdminSettingsTab />)
    const input = await screen.findByLabelText('Cap for one run (US$)')
    expect(screen.getByText('US$48.50')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()

    await user.clear(input)
    await user.type(input, '75')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Must be at most 50.00.')).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      values: { run_cap_usd: '75' },
    })
    // The approval from Levi is read only.
    expect(screen.getByText('HubSpot names may go to Claude')).toBeInTheDocument()
    expect(screen.queryByLabelText('HubSpot names may go to Claude')).not.toBeInTheDocument()
  })

  it('puts a changed setting back to its default', async () => {
    const calls = mockApi({
      '/api/v1/settings': settingsOut({ value: '15.00', overridden: true }),
      '/api/v1/settings/run_cap_usd': settingsOut(),
    })
    const { user } = renderWithProviders(<AdminSettingsTab />)
    await user.click(await screen.findByRole('button', { name: 'Use the default' }))
    await waitFor(() => {
      expect(calls.some((call) => call.method === 'DELETE')).toBe(true)
    })
  })
})
