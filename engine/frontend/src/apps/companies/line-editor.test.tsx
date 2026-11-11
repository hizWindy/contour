import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PrepScript, ScriptStyleOut } from '@/api/types'
import { mockApi, type Call } from '@/test/mock-api'
import { renderWithProviders } from '@/test/render'
import { detail, JASON, TODAY } from './guide-fixtures'
import { guideText } from './playbook'
import { SalesScript } from './sales-script'
import { useGuide } from './use-guide'

const EDITS = '/api/v1/companies/script-edits'
const STYLE = '/api/v1/companies/script-style'
const LABELS: ReadonlyMap<string, string> = new Map([['F7', 'HubSpot: Perth office']])
const COMPANY = detail()

interface Edit {
  slot: string
  text: string
  updated_at: string
}

/** A backend that keeps one person's line edits and their style. */
function backend(start: Edit[] = []) {
  const state = {
    edits: start,
    style: {
      mine: '',
      mine_updated_at: null,
      team: [],
      suggestions: [],
      can_decide: false,
      mine_max_chars: 600,
      team_max_chars: 200,
      team_max_notes: 8,
    } as ScriptStyleOut,
  }
  const calls = mockApi({
    [EDITS]: (call: Call) => {
      if (call.method === 'GET') return Response.json(state.edits)
      if (call.method === 'PUT') {
        const body = call.body as { slot: string; text: string }
        if (body.text.includes('@')) {
          return Response.json(
            {
              title: 'An email address or a phone number',
              detail: 'Take it out, then save again.',
              status: 422,
              code: 'contact_details',
            },
            { status: 422 },
          )
        }
        const saved = { slot: body.slot, text: body.text, updated_at: `${TODAY}T01:00:00Z` }
        state.edits = [...state.edits.filter((edit) => edit.slot !== body.slot), saved]
        return Response.json(saved)
      }
      const slot = new URLSearchParams(call.search).get('slot')
      state.edits = state.edits.filter((edit) => edit.slot !== slot)
      return new Response(null, { status: 204 })
    },
    [STYLE]: () => Response.json(state.style),
    [`${STYLE}/mine`]: (call: Call) => {
      state.style = {
        ...state.style,
        mine: (call.body as { text: string }).text,
        mine_updated_at: `${TODAY}T02:00:00Z`,
      }
      return Response.json(state.style)
    },
  })
  return { state, calls }
}

function claudeScript(opener: string[]): PrepScript {
  return {
    still_there: 'yes',
    still_there_note: null,
    news: [],
    opener: opener.map((text) => ({ text, sources: ['F7'] })),
    why_now: [{ text: 'The Perth lease ends in Jun 2027.', sources: ['F7'] }],
    questions: [{ text: 'Renew or move?', sources: ['F7'], follow_ups: [] }],
    if_they_say: [
      { they_say: "We're not ready yet.", answer: { text: 'Fair. When?', sources: ['F7'] } },
    ],
    goal: { text: 'Book a site visit.', sources: ['F7'] },
    dropped: 0,
  } as unknown as PrepScript
}

/** The card's script column as the modal draws it, and what "Copy script" would copy. */
function Card({ script = null }: { script?: PrepScript | null }) {
  const guide = useGuide({
    script,
    labels: LABELS,
    company: COMPANY,
    picking: false,
    person: JASON,
    caller: 'Mia',
    today: TODAY,
    companyKey: '101',
    contactId: '201',
  })
  if (!guide) return null
  return (
    <>
      <SalesScript guide={guide} />
      <pre data-testid="copied">{guideText(guide, 'Jason Reeds')}</pre>
    </>
  )
}

const copied = (): string => screen.getByTestId('copied').textContent

describe('the line editor', () => {
  it('a pencil turns a line into a box; Save keeps it for this call, marked Yours', async () => {
    const { calls } = backend()
    const { user } = renderWithProviders(<Card />)

    await user.click(await screen.findByRole('button', { name: 'Edit opener line 2' }))
    const box = screen.getByRole('textbox', { name: 'Opener line 2, your wording' })
    expect(box).toHaveFocus()
    expect(box).toHaveValue('I wanted to follow up on Perth fit-out.')
    expect(screen.getByText('Only for this call, and only you see it.')).toBeInTheDocument()
    await user.clear(box)
    await user.type(box, 'Calling about the Perth move.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
        company_key: '101',
        contact_id: '201',
        slot: 'opener.1',
        text: 'Calling about the Perth move.',
      })
    })
    expect(await screen.findByText('Calling about the Perth move.')).toBeInTheDocument()
    expect(screen.getByText('Yours')).toBeInTheDocument()
    expect(screen.queryByText('I wanted to follow up on Perth fit-out.')).not.toBeInTheDocument()
    // "Copy script" copies the edited line.
    expect(copied()).toContain('- Calling about the Perth move.')
    // Back to the pencil, so the keyboard carries on from the line.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit opener line 2' })).toHaveFocus()
    })
  })

  it('Cancel and Esc close the box and change nothing', async () => {
    const { calls } = backend()
    const { user } = renderWithProviders(<Card />)

    await user.click(await screen.findByRole('button', { name: 'Edit goal of the call' }))
    await user.type(screen.getByRole('textbox', { name: /your wording/ }), ' Today.')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: /your wording/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit question 1' }))
    await user.type(screen.getByRole('textbox', { name: /your wording/ }), ' Now.')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('textbox', { name: /your wording/ })).not.toBeInTheDocument()
    expect(calls.some((call) => call.method === 'PUT')).toBe(false)
  })

  it('Reset brings back the draft', async () => {
    const { calls } = backend([
      { slot: 'goal', text: 'Get a meeting in the diary.', updated_at: TODAY },
    ])
    const { user } = renderWithProviders(<Card />)

    expect(await screen.findByText('Get a meeting in the diary.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reset to the draft: Site visit.' }))
    expect(await screen.findByText('Site visit.')).toBeInTheDocument()
    expect(screen.queryByText('Yours')).not.toBeInTheDocument()
    expect(calls.find((call) => call.method === 'DELETE')?.search).toBe(
      '?company_key=101&contact_id=201&slot=goal',
    )
  })

  it('an edit survives closing the card and Research again', async () => {
    backend()
    const first = renderWithProviders(<Card script={claudeScript(['Hi Jason.', 'About Perth.'])} />)
    await first.user.click(await screen.findByRole('button', { name: 'Edit opener line 1' }))
    const box = screen.getByRole('textbox', { name: /your wording/ })
    await first.user.clear(box)
    await first.user.type(box, 'Hey Jason, Mia here.')
    await first.user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Hey Jason, Mia here.')).toBeInTheDocument()
    first.unmount()

    // The card opens again: the edit comes back from the API.
    renderWithProviders(<Card script={claudeScript(['Hi Jason.', 'About Perth.'])} />)
    expect(await screen.findByText('Hey Jason, Mia here.')).toBeInTheDocument()
    expect(screen.getByText('About Perth.')).toBeInTheDocument()
  })

  it('Research again with a new draft keeps the edited slot and fills the rest', async () => {
    backend([{ slot: 'opener.0', text: 'Hey Jason, Mia here.', updated_at: TODAY }])
    const { rerender } = renderWithProviders(<Card script={claudeScript(['Hi Jason.'])} />)
    expect(await screen.findByText('Hey Jason, Mia here.')).toBeInTheDocument()

    rerender(<Card script={claudeScript(['Hi Jason, new.', 'A new reason.'])} />)
    expect(await screen.findByText('A new reason.')).toBeInTheDocument()
    expect(screen.getByText('Hey Jason, Mia here.')).toBeInTheDocument()
    expect(screen.queryByText('Hi Jason, new.')).not.toBeInTheDocument()
    expect(copied()).toContain('- Hey Jason, Mia here.\n- A new reason.')
  })

  it('says why a save was refused, in the box', async () => {
    backend()
    const { user } = renderWithProviders(<Card />)
    await user.click(await screen.findByRole('button', { name: 'Edit opener line 1' }))
    await user.type(screen.getByRole('textbox', { name: /your wording/ }), ' Call me on a@b.co')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An email address or a phone number. Take it out, then save again.',
    )
    expect(screen.getByRole('textbox', { name: /your wording/ })).toBeInTheDocument()
  })

  it('after the first save, "Make it my style" opens the style sheet with a note from the line', async () => {
    const { calls } = backend()
    const { user } = renderWithProviders(<Card />)

    await user.click(await screen.findByRole('button', { name: 'Edit opener line 1' }))
    const box = screen.getByRole('textbox', { name: /your wording/ })
    await user.clear(box)
    await user.type(box, "Hi Jason, it's Mia. Quick one.")
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Use this wording for all your scripts?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Make it my style' }))
    const sheet = await screen.findByRole('dialog', { name: 'Script style' })
    const mine = within(sheet).getByRole('textbox', { name: 'Your style' })
    expect(mine).toHaveValue('Open like: "Hi Jason, it\'s Mia. Quick one."')
    // The focus is in the box, to check the note before saving it.
    expect(mine).toHaveFocus()
    // Nothing is saved or shared until the person presses Save.
    expect(calls.some((call) => call.path === `${STYLE}/mine`)).toBe(false)
    expect(calls.some((call) => call.path === `${STYLE}/team`)).toBe(false)
    await user.type(mine, ' Keep it short.')
    await user.click(within(sheet).getByRole('button', { name: 'Save my style' }))
    await waitFor(() => {
      expect(calls.find((call) => call.path === `${STYLE}/mine`)?.body).toEqual({
        text: 'Open like: "Hi Jason, it\'s Mia. Quick one." Keep it short.',
      })
    })
    await user.keyboard('{Escape}')

    // Only once a card: the next save offers nothing.
    await user.click(await screen.findByRole('button', { name: 'Edit goal of the call' }))
    await user.type(screen.getByRole('textbox', { name: /your wording/ }), ' Today.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Site visit. Today.')).toBeInTheDocument()
    expect(screen.queryByText('Use this wording for all your scripts?')).not.toBeInTheDocument()
  })

  it('has no pencil while there is no call to save to', async () => {
    mockApi({})
    function NoCall() {
      const guide = useGuide({
        script: null,
        labels: LABELS,
        company: COMPANY,
        picking: false,
        person: JASON,
        caller: 'Mia',
        today: TODAY,
        companyKey: undefined,
        contactId: null,
      })
      return guide ? <SalesScript guide={guide} /> : null
    }
    renderWithProviders(<NoCall />)
    expect(await screen.findByText('I wanted to follow up on Perth fit-out.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument()
  })
})
