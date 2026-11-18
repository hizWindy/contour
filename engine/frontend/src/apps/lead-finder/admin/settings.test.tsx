import { screen, waitFor, within } from '@testing-library/react'
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

  it('shows one group at a time, each setting with one line, and says once when changes apply', async () => {
    const model = {
      ...SETTING,
      key: 'claude_model',
      label: 'Main Claude model',
      description: 'Used for every step that has no model of its own. A longer second sentence.',
      type: 'choice',
      choices: ['claude-opus-5-5', 'claude-sonnet-5-5'],
      min: null,
      max: null,
      default: 'claude-opus-5-5',
      value: 'claude-opus-5-5',
    }
    mockApi({
      '/api/v1/settings': { ...settingsOut(), fields: [...settingsOut().fields, model] },
    })
    const { user } = renderWithProviders(<AdminSettingsTab />)
    expect(await screen.findByText(/Applies from the next run\./)).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Money' })).toBeInTheDocument()
    expect(screen.queryByText('Main Claude model')).toBeNull()

    await user.click(screen.getByRole('radio', { name: 'Claude' }))
    expect(screen.getByRole('list', { name: 'Claude' })).toBeInTheDocument()
    expect(
      screen.getByText('Used for every step that has no model of its own.'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show the details' }))
    expect(
      screen.getByText(
        'Used for every step that has no model of its own. A longer second sentence.',
      ),
    ).toBeInTheDocument()
  })

  it('puts the call notes and pre-meeting forms switches in a group of their own, last', async () => {
    const toggle = (key: string, label: string, description: string) => ({
      ...SETTING,
      key,
      label,
      description,
      type: 'bool',
      min: null,
      max: null,
      default: false,
      value: false,
    })
    const runs = {
      ...SETTING,
      key: 'run_max_companies',
      label: 'Companies in one run',
      description: 'The most companies one run researches.',
      type: 'int',
      min: 1,
      max: 50,
      default: 20,
      value: 20,
    }
    const calls = mockApi({
      '/api/v1/settings': (call: Call) =>
        Response.json(
          call.method === 'PATCH'
            ? settingsOut()
            : {
                ...settingsOut(),
                fields: [
                  ...settingsOut().fields,
                  runs,
                  toggle(
                    'call_notes_enabled',
                    'Call notes are on',
                    'Shows Log call in call prep and the Call logs page.',
                  ),
                  toggle(
                    'call_notes_ai_enabled',
                    'Claude sorts call notes',
                    "Sends a rep's note to Claude to sort it.",
                  ),
                  toggle(
                    'meeting_forms_enabled',
                    'Pre-meeting forms are on',
                    'Shows Meetings and the pre-read.',
                  ),
                ],
              },
        ),
    })
    const { user } = renderWithProviders(<AdminSettingsTab />)
    await screen.findByRole('list', { name: 'Money' })
    const groups = within(screen.getByRole('radiogroup', { name: 'Settings group' }))
    expect(groups.getAllByRole('radio').map((radio) => radio.textContent)).toEqual([
      'Money',
      'Runs',
      'Call notes',
    ])

    await user.click(groups.getByRole('radio', { name: 'Runs' }))
    expect(screen.getByRole('list', { name: 'Runs' })).toHaveTextContent('Companies in one run')
    expect(screen.queryByText('Call notes are on')).toBeNull()

    await user.click(groups.getByRole('radio', { name: 'Call notes' }))
    const notes = screen.getByRole('list', { name: 'Call notes' })
    expect(
      within(notes)
        .getAllByRole('switch')
        .map((item) => item.getAttribute('id')),
    ).toEqual([
      'setting-call_notes_enabled',
      'setting-call_notes_ai_enabled',
      'setting-meeting_forms_enabled',
    ])
    // Meetings came in Stage B (T3-9), so its switch shows again, beside the call notes ones.
    for (const label of [
      'Call notes are on',
      'Claude sorts call notes',
      'Pre-meeting forms are on',
    ]) {
      expect(within(notes).getByRole('switch', { name: label })).not.toBeChecked()
    }
    await user.click(within(notes).getByRole('switch', { name: 'Call notes are on' }))
    await user.click(within(notes).getByRole('switch', { name: 'Pre-meeting forms are on' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
        values: { call_notes_enabled: true, meeting_forms_enabled: true },
      })
    })
  })

  /** The voice tool setting, as the server lists it, saved as `value`. */
  function voiceTool(value: string) {
    return {
      ...SETTING,
      key: 'voice_tool',
      label: 'Voice to text',
      description: 'Which voice to text tool the mic uses.',
      type: 'choice',
      choices: ['browser_model', 'browser_service', 'typing'],
      min: null,
      max: null,
      default: 'browser_model',
      value,
      overridden: value !== 'browser_model',
    }
  }

  it('puts the voice tool under Call notes, its choices in plain words (PLAN-V18 T3-5)', async () => {
    // The server leaves out the browser's speech service until `BROWSER_SPEECH_OK` (Levi's OK).
    mockApi({
      '/api/v1/settings': {
        ...settingsOut(),
        fields: [
          ...settingsOut().fields,
          { ...voiceTool('browser_model'), choices: ['browser_model', 'typing'] },
        ],
      },
    })
    const { user } = renderWithProviders(<AdminSettingsTab />)
    await screen.findByRole('list', { name: 'Money' })
    await user.click(screen.getByRole('radio', { name: 'Call notes' }))
    const notes = screen.getByRole('list', { name: 'Call notes' })
    const select = within(notes).getByRole('combobox')
    expect(select).toHaveTextContent('Whisper in the browser: the voice stays on this computer')
    await user.click(select)
    // The browser's speech service sends the voice to Google or Microsoft: not offered.
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Whisper in the browser: the voice stays on this computer',
      'Typing only: no mic button',
    ])
  })

  it("puts Today's quiet days with the call notes settings (PLAN-V22 T2-2)", async () => {
    mockApi({
      '/api/v1/settings': {
        ...settingsOut(),
        fields: [
          ...settingsOut().fields,
          {
            ...SETTING,
            key: 'today_quiet_days',
            label: 'Days before a deal is quiet',
            description:
              'Today lists an open deal whose company nobody has talked to for this long.',
            type: 'int',
            min: 1,
            max: 90,
            default: 14,
            value: 14,
          },
        ],
      },
    })
    const { user } = renderWithProviders(<AdminSettingsTab />)
    await screen.findByRole('list', { name: 'Money' })
    expect(screen.queryByText('Days before a deal is quiet')).toBeNull()
    await user.click(screen.getByRole('radio', { name: 'Call notes' }))
    const notes = screen.getByRole('list', { name: 'Call notes' })
    expect(within(notes).getByText('Days before a deal is quiet')).toBeInTheDocument()
  })

  it("offers the browser's speech service once the server lists it (after Levi's OK)", async () => {
    const calls = mockApi({
      '/api/v1/settings': {
        ...settingsOut(),
        fields: [...settingsOut().fields, voiceTool('browser_service')],
      },
    })
    const { user } = renderWithProviders(<AdminSettingsTab />)
    await screen.findByRole('list', { name: 'Money' })
    await user.click(screen.getByRole('radio', { name: 'Call notes' }))
    const select = within(screen.getByRole('list', { name: 'Call notes' })).getByRole('combobox')
    expect(select).toHaveTextContent(
      "The browser's speech service: the voice goes to Google or Microsoft",
    )
    await user.click(select)
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Whisper in the browser: the voice stays on this computer',
      "The browser's speech service: the voice goes to Google or Microsoft",
      'Typing only: no mic button',
    ])
    // A move away saves as any change does.
    await user.click(screen.getByRole('option', { name: 'Typing only: no mic button' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
        values: { voice_tool: 'typing' },
      })
    })
  })

  it('lists the forms switch under "Set on the server" when the server sets it', async () => {
    mockApi({
      '/api/v1/settings': {
        ...settingsOut(),
        fields: [
          ...settingsOut().fields,
          {
            ...SETTING,
            key: 'meeting_forms_enabled',
            label: 'Pre-meeting forms are on',
            description: 'Shows Meetings and the pre-read.',
            type: 'bool',
            min: null,
            max: null,
            default: false,
            value: false,
            editable: false,
          },
        ],
      },
    })
    renderWithProviders(<AdminSettingsTab />)
    // Levi's approval, and the forms switch.
    expect(await screen.findByText(/Set on the server \(2\)/)).toBeInTheDocument()
    expect(screen.getByText('Pre-meeting forms are on')).toBeInTheDocument()
  })
})

describe('the Sources settings (PLAN-V16 T3-6)', () => {
  const field = (key: string, label: string, changes: Record<string, unknown> = {}) => ({
    ...SETTING,
    key,
    label,
    description: `${label}.`,
    type: 'int',
    min: 1,
    max: 1000,
    default: 300,
    value: 300,
    ...changes,
  })

  it('puts the property tools in a Sources group, and the round goal under Runs', async () => {
    const fields = [
      ...settingsOut().fields,
      field('property_daily_enabled', 'Property Daily is switched on', {
        type: 'bool',
        min: null,
        max: null,
        default: false,
        value: false,
      }),
      field('source_pages_per_day', 'Most pages a day, for each tool'),
      field('source_pages_per_run', 'Most live lookup pages one run may use', { value: 60 }),
      field('property_lookup_days', 'Days a lookup is reused', { value: 30 }),
      field('lead_finder_goal_good_leads', 'Good leads to aim for every 2 weeks', {
        value: 100,
        max: 1000,
      }),
      field('arealytics_to_claude_ok', 'Arealytics facts may go to Claude', {
        type: 'bool',
        min: null,
        max: null,
        default: false,
        value: false,
        editable: false,
      }),
    ]
    mockApi({ '/api/v1/settings': { ...settingsOut(), fields } })
    const { user } = renderWithProviders(<AdminSettingsTab />)
    await screen.findByText(/Applies from the next run\./)

    await user.click(screen.getByRole('radio', { name: 'Sources' }))
    const sources = screen.getByRole('list', { name: 'Sources' })
    for (const label of [
      'Property Daily is switched on',
      'Most pages a day, for each tool',
      'Most live lookup pages one run may use',
      'Days a lookup is reused',
    ]) {
      expect(sources).toHaveTextContent(label)
    }
    expect(sources).not.toHaveTextContent('Good leads to aim for')

    await user.click(screen.getByRole('radio', { name: 'Runs' }))
    expect(screen.getByRole('list', { name: 'Runs' })).toHaveTextContent(
      'Good leads to aim for every 2 weeks',
    )
    // An approval set on the server is read only, with the others.
    expect(screen.getByText('Arealytics facts may go to Claude')).toBeInTheDocument()
    expect(screen.queryByLabelText('Arealytics facts may go to Claude')).toBeNull()
  })
})
