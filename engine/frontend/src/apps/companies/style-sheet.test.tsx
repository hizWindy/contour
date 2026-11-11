import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PrepScript, ScriptStyleOut } from '@/api/types'
import { mockApi, type Call } from '@/test/mock-api'
import { renderWithProviders } from '@/test/render'
import { detail, JASON, TODAY } from './guide-fixtures'
import { buildGuide, guideFromPrep, type CallGuide } from './playbook'
import { SalesScript } from './sales-script'
import { styleRowWords, styleSummary, toneHint, withNote } from './style-words'
import { useGuide } from './use-guide'

const STYLE = '/api/v1/companies/script-style'
type Note = ScriptStyleOut['team'][number]

function note(id: string, text: string, changes: Partial<Note> = {}): Note {
  return {
    id,
    text,
    status: 'active',
    suggested_by: 'Tom Hale',
    decided_by: 'Levi',
    decided_at: '2026-11-03T01:00:00Z',
    created_at: '2026-11-02T01:00:00Z',
    ...changes,
  }
}

function style(changes: Partial<ScriptStyleOut> = {}): ScriptStyleOut {
  return {
    mine: '',
    mine_updated_at: null,
    team: [note('n1', 'Short openers. Ask for two minutes first.'), note('n2', 'Use first names.')],
    suggestions: [],
    can_decide: false,
    mine_max_chars: 600,
    team_max_chars: 200,
    team_max_notes: 8,
    tone: { mine: null, team: 'friendly', choices: TONE_CHOICES },
    ...changes,
  }
}

const TONE_CHOICES = [
  { key: 'friendly', label: 'Friendly', line: 'Warm, a short greeting, plain words.' },
  { key: 'direct', label: 'Direct', line: 'Short sentences, the reason first, no small talk.' },
  {
    key: 'consultative',
    label: 'Consultative',
    line: 'Questions first, curious about their workplace.',
  },
  { key: 'formal', label: 'Formal', line: 'Full names and titles, no slang.' },
] as const satisfies NonNullable<ScriptStyleOut['tone']>['choices']

/** A backend that keeps the style, and answers every change with the whole style. */
function styleApi(start: ScriptStyleOut): Call[] {
  let current = start
  const answer = (next: ScriptStyleOut): Response => {
    current = next
    return Response.json(current)
  }
  const text = (call: Call): string => (call.body as { text: string }).text
  return mockApi({
    [STYLE]: () => Response.json(current),
    [`${STYLE}/mine`]: (call: Call) =>
      text(call).includes('@')
        ? Response.json(
            {
              title: 'An email address or a phone number',
              detail: 'Take it out, then save again.',
              status: 422,
              code: 'contact_details',
            },
            { status: 422 },
          )
        : answer({ ...current, mine: text(call), mine_updated_at: '2026-11-11T01:00:00Z' }),
    [`${STYLE}/team`]: (call: Call) =>
      answer({
        ...current,
        suggestions: [
          note('n9', text(call), { status: 'suggested', decided_by: null }),
          ...current.suggestions,
        ],
      }),
    [`${STYLE}/team/n5/approve`]: () =>
      answer({
        ...current,
        team: [...current.team, note('n5', 'Mention their last project.')],
        suggestions: current.suggestions.filter((item) => item.id !== 'n5'),
      }),
    [`${STYLE}/team/n5/reject`]: () =>
      answer({ ...current, suggestions: current.suggestions.filter((item) => item.id !== 'n5') }),
    [`${STYLE}/team/n1`]: () =>
      answer({ ...current, team: current.team.filter((item) => item.id !== 'n1') }),
    [`${STYLE}/tone`]: (call: Call) => {
      const tone = current.tone
      if (!tone) return undefined
      return answer({ ...current, tone: { ...tone, mine: (call.body as { tone: never }).tone } })
    },
    [`${STYLE}/team-tone`]: (call: Call) => {
      const tone = current.tone
      if (!tone) return undefined
      return answer({ ...current, tone: { ...tone, team: (call.body as { tone: never }).tone } })
    },
    [EDITS]: [],
  })
}

const EDITS = '/api/v1/companies/script-edits'

const FREE = (): CallGuide =>
  buildGuide({ company: detail(), person: JASON, caller: 'Mia', today: TODAY })

function claude(opener: string): CallGuide {
  const script = {
    still_there: 'yes',
    still_there_note: null,
    news: [],
    opener: [{ text: opener, sources: ['F7'] }],
    why_now: [],
    questions: [],
    if_they_say: [],
    goal: null,
    dropped: 0,
  } as unknown as PrepScript
  return guideFromPrep(script, new Map([['F7', 'HubSpot: Perth office']]))
}

const row = () => screen.findByRole('button', { name: /^Style: / })
const sheet = () => screen.findByRole('dialog', { name: 'Script style' })

describe('the Style row and the style sheet', () => {
  it('sums up the style, and opens the sheet with the team notes and who approved them', async () => {
    styleApi(style())
    const { user } = renderWithProviders(<SalesScript guide={FREE()} />)

    expect(
      await screen.findByRole('button', { name: 'Style: Team (2 notes), tone Friendly' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Tone: Friendly · Team (2 notes)')).toBeInTheDocument()
    // The free script is written by code, so no style is in it.
    expect(screen.getByText("Used by call prep's scripts.")).toBeInTheDocument()

    await user.click(await row())
    const open = await sheet()
    expect(
      within(open).getByText(
        'Style changes the wording. It never adds facts. Press Research again to use it.',
      ),
    ).toBeInTheDocument()
    const notes = within(open).getByRole('list', { name: 'Team notes' })
    expect(within(notes).getAllByRole('listitem')).toHaveLength(2)
    expect(within(notes).getAllByText('Approved by Levi, 3 Nov 2026')).toHaveLength(2)
    expect(
      within(open).getByText("2 of 8 notes. Everyone's next scripts use them."),
    ).toBeInTheDocument()
    // Not an Admin: nothing to retire, approve or reject.
    expect(within(open).queryByRole('button', { name: /^Retire/ })).not.toBeInTheDocument()
    expect(within(open).queryByRole('button', { name: /^Approve/ })).not.toBeInTheDocument()
    expect(within(open).getByRole('button', { name: 'Suggest to team' })).toBeDisabled()
  })

  it('Your style saves, says "Not used yet" until the next script, and reloads the same', async () => {
    const calls = styleApi(style())
    const { user, rerender } = renderWithProviders(<SalesScript guide={claude('Hi Jason.')} />)
    await user.click(await row())
    const open = await sheet()

    const box = within(open).getByRole('textbox', { name: 'Your style' })
    const save = within(open).getByRole('button', { name: 'Save my style' })
    expect(save).toBeDisabled()
    await user.type(box, 'Warm and short.')
    expect(within(open).getByText('15 of 600 characters')).toBeInTheDocument()
    await user.click(save)

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({ text: 'Warm and short.' })
    })
    expect(await screen.findByText('Your style is saved.')).toBeInTheDocument()
    expect(within(open).getByText('Saved 11 Nov 2026')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Script style' })).not.toBeInTheDocument()
    })
    expect(
      await screen.findByRole('button', { name: 'Style: Team (2 notes) and yours, tone Friendly' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Not used yet. Research again.')).toBeInTheDocument()

    // Opened again, the box holds what was saved.
    await user.click(await row())
    expect(within(await sheet()).getByRole('textbox', { name: 'Your style' })).toHaveValue(
      'Warm and short.',
    )
    await user.keyboard('{Escape}')

    // A new script (Research again) is written with it, so the note goes.
    rerender(<SalesScript guide={claude('Hi Jason, new script.')} />)
    expect(screen.queryByText('Not used yet. Research again.')).not.toBeInTheDocument()
  })

  it('says why a save was refused, under the box', async () => {
    styleApi(style())
    const { user } = renderWithProviders(<SalesScript guide={claude('Hi.')} />)
    await user.click(await row())
    const open = await sheet()
    await user.type(within(open).getByRole('textbox', { name: 'Your style' }), 'Email me at a@b.co')
    await user.click(within(open).getByRole('button', { name: 'Save my style' }))
    expect(await within(open).findByRole('alert')).toHaveTextContent(
      'An email address or a phone number. Take it out, then save again.',
    )
    expect(screen.queryByText('Not used yet. Research again.')).not.toBeInTheDocument()
  })

  it('a suggestion waits for an Admin, and its author sees what became of it', async () => {
    const calls = styleApi(
      style({ suggestions: [note('n4', 'Never say "just".', { status: 'rejected' })] }),
    )
    const { user } = renderWithProviders(<SalesScript guide={claude('Hi.')} />)
    await user.click(await row())
    const open = await sheet()

    const mine = within(open).getByRole('list', { name: 'Your suggestions' })
    expect(within(mine).getByText('Not approved')).toBeInTheDocument()

    await user.type(
      within(open).getByRole('textbox', { name: 'Suggest a team note' }),
      'Mention their last project.',
    )
    await user.click(within(open).getByRole('button', { name: 'Suggest to team' }))
    await waitFor(() => {
      expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
        text: 'Mention their last project.',
      })
    })
    expect(await within(mine).findByText('Waiting')).toBeInTheDocument()
    // A suggestion changes nobody's script yet.
    expect(screen.queryByText('Not used yet. Research again.')).not.toBeInTheDocument()
  })

  it('an Admin approves, rejects and retires', async () => {
    const calls = styleApi(
      style({
        can_decide: true,
        suggestions: [note('n5', 'Mention their last project.', { status: 'suggested' })],
      }),
    )
    const { user } = renderWithProviders(<SalesScript guide={claude('Hi.')} />)
    await user.click(await row())
    const open = await sheet()

    // The sheet takes the focus, not Retire: a stray Enter decides nothing.
    expect(open).toHaveFocus()
    const waiting = within(open).getByRole('list', { name: 'Waiting for a decision' })
    expect(within(waiting).getByText('Suggested by Tom Hale, 2 Nov 2026')).toBeInTheDocument()
    expect(within(waiting).getByRole('button', { name: /^Reject/ })).toBeInTheDocument()
    await user.click(within(waiting).getByRole('button', { name: /^Approve/ }))
    await waitFor(() => {
      expect(within(open).getAllByRole('button', { name: /^Retire/ })).toHaveLength(3)
    })
    expect(
      within(open).queryByRole('list', { name: 'Waiting for a decision' }),
    ).not.toBeInTheDocument()

    await user.click(
      within(open).getByRole('button', {
        name: 'Retire: Short openers. Ask for two minutes first.',
      }),
    )
    await waitFor(() => {
      expect(within(open).getAllByRole('button', { name: /^Retire/ })).toHaveLength(2)
    })
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(
      expect.arrayContaining([`POST ${STYLE}/team/n5/approve`, `DELETE ${STYLE}/team/n1`]),
    )
    // An Admin's own note is active at once, so the box says so.
    expect(within(open).getByRole('button', { name: 'Add to team style' })).toBeInTheDocument()
    expect(screen.getByText('Not used yet. Research again.')).toBeInTheDocument()
  })

  it('shows the error and a retry when the style can not be loaded', async () => {
    mockApi({})
    const { user } = renderWithProviders(<SalesScript guide={claude('Hi.')} />)
    expect(await screen.findByRole('button', { name: 'Style: Not loaded' })).toBeInTheDocument()
    await user.click(await row())
    expect(
      await within(await sheet()).findByText("The style couldn't be loaded."),
    ).toBeInTheDocument()
  })
})

/** The free script as the card makes it: the guide follows the tone in use (PLAN-V15 T3-6). */
function FreeScript() {
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
  })
  return guide ? <SalesScript guide={guide} /> : null
}

describe('the tone picker (PLAN-V15)', () => {
  it('saves my tone, changes the free script at once, and goes back to the team default', async () => {
    const calls = styleApi(style())
    const { user } = renderWithProviders(<FreeScript />)
    expect(
      await screen.findByText("Hi Jason, it's Mia from Contour. We spoke on 1 Oct."),
    ).toBeInTheDocument()

    await user.click(await row())
    const open = await sheet()
    const tones = within(open).getByRole('radiogroup', { name: 'Tone' })
    expect(within(tones).getByRole('radio', { name: 'Friendly' })).toBeChecked()
    expect(within(open).getByText('Warm, a short greeting, plain words.')).toBeInTheDocument()
    expect(within(open).getByText('Team default: Friendly. You follow it.')).toBeInTheDocument()
    // Not an Admin: no team default to set.
    expect(
      within(open).queryByRole('button', { name: 'Set as team default' }),
    ).not.toBeInTheDocument()

    await user.click(within(tones).getByRole('radio', { name: 'Direct' }))
    await waitFor(() => {
      expect(calls.find((call) => call.path === `${STYLE}/tone`)?.body).toEqual({ tone: 'direct' })
    })
    expect(await screen.findByText('Your tone is Direct.')).toBeInTheDocument()
    expect(within(tones).getByRole('radio', { name: 'Direct' })).toBeChecked()
    expect(within(open).getByText('Team default: Friendly')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    // The free script follows at once: no prep, no request but the save.
    expect(
      await screen.findByText("Jason, it's Mia from Contour. We spoke on 1 Oct."),
    ).toBeInTheDocument()
    expect(screen.getByText('Have you got two minutes?')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Style: Team (2 notes), tone Direct' }),
    ).toBeInTheDocument()
    expect(calls.some((call) => call.path.includes('/preps'))).toBe(false)

    await user.click(await row())
    await user.click(within(await sheet()).getByRole('button', { name: 'Use the team default' }))
    await waitFor(() => {
      expect(calls.filter((call) => call.path === `${STYLE}/tone`).at(-1)?.body).toEqual({
        tone: null,
      })
    })
    expect(await screen.findByText("You follow the team's tone: Friendly.")).toBeInTheDocument()
  })

  it('moves the tone with the arrow keys', async () => {
    const calls = styleApi(style())
    const { user } = renderWithProviders(<SalesScript guide={FREE()} />)
    await user.click(await row())
    const tones = within(await sheet()).getByRole('radiogroup', { name: 'Tone' })
    within(tones).getByRole('radio', { name: 'Friendly' }).focus()
    await user.keyboard('{ArrowRight}')
    await waitFor(() => {
      expect(calls.find((call) => call.path === `${STYLE}/tone`)?.body).toEqual({ tone: 'direct' })
    })
  })

  it('lets an Admin set the team default', async () => {
    const calls = styleApi(style({ can_decide: true }))
    const { user } = renderWithProviders(<SalesScript guide={FREE()} />)
    await user.click(await row())
    const open = await sheet()
    const set = within(open).getByRole('button', { name: 'Set as team default' })
    expect(set).toBeDisabled() // Friendly is already the team's
    await user.click(within(open).getByRole('radio', { name: 'Formal' }))
    await waitFor(() => {
      expect(set).toBeEnabled()
    })
    await user.click(set)
    await waitFor(() => {
      expect(calls.find((call) => call.path === `${STYLE}/team-tone`)?.body).toEqual({
        tone: 'formal',
      })
    })
    expect(await screen.findByText("The team's tone is Formal.")).toBeInTheDocument()
    expect(within(open).getByText('Team default: Formal')).toBeInTheDocument()
  })
})

describe('style words', () => {
  it('says when a script was written in another tone', () => {
    expect(toneHint('friendly', 'direct')).toBe(
      'Written in a Friendly tone. Research again to use Direct.',
    )
    expect(toneHint('direct', 'direct')).toBeNull()
    expect(toneHint(null, 'direct')).toBeNull()
    expect(toneHint('direct', null)).toBeNull()
  })

  it('puts the tone first on the Style row', () => {
    const one = [note('n1', 'One.')]
    expect(styleRowWords(style({ team: one }))).toBe('Tone: Friendly · Team (1 note)')
    expect(
      styleRowWords(
        style({ team: [], tone: { mine: 'formal', team: 'direct', choices: TONE_CHOICES } }),
      ),
    ).toBe('Tone: Formal')
  })

  it('sums up the style', () => {
    const one = [note('n1', 'One.')]
    expect(styleSummary({ mine: 'Mine.', team: one })).toBe('Team (1 note) and yours')
    expect(styleSummary({ mine: '  ', team: [...one, ...one, ...one] })).toBe('Team (3 notes)')
    expect(styleSummary({ mine: 'Mine.', team: [] })).toBe('Yours')
    expect(styleSummary({ mine: '', team: [] })).toBe('None yet')
  })

  it('adds a note on its own line, once', () => {
    expect(withNote('', 'Open like: "Hi Jason"')).toBe('Open like: "Hi Jason"')
    expect(withNote('Warm.', 'Short.')).toBe('Warm.\nShort.')
    expect(withNote('Warm.\nShort.', 'Short.')).toBe('Warm.\nShort.')
    expect(withNote('Warm.', null)).toBe('Warm.')
  })
})
