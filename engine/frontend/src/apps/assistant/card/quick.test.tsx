/**
 * The quick log (PLAN-V25 T3-3, choice 15), with a fake server: "No answer, Jo Sample" with a sure
 * person saves at once and sends after the hold with no card; the toast names the outcome, the
 * person and the company; Undo opens the card with its saved call; a call still sorting is waited
 * for, and one sorting too long stays in Call logs; a save that fails opens the card; and a call
 * the server didn't judge quick opens the card as before. Made-up names only: Sample Logistics Pty
 * Ltd, Jo Sample.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { toast } from 'sonner'
import { queryKeys } from '@/api/query'
import type { AssistantCommand, CallNoteOut } from '@/api/types'
import { FakeMic } from '@/apps/companies/call-notes/mic/fake-mic'
import { mockApi, type Answer } from '@/test/mock-api'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { API, callCommand, note, notePath, notePreview, options } from './fixtures'
import { CardHost } from './host'
import { isQuickLog, startQuickLog } from './quick'
import { closeCard } from './store'

/** "No answer, Jo Sample": only an outcome, with a sure company and person. */
function noAnswer(change: Partial<AssistantCommand> = {}): AssistantCommand {
  return callCommand({
    read_back: 'Log a call with Jo Sample at Sample Logistics Pty Ltd.',
    note_text: 'No answer, Jo Sample.',
    outcome: 'No answer',
    quick: true,
    call_type: 'Prospecting Call',
    follow_up_day: '2099-11-27',
    ...change,
  })
}

const SAVED = note({
  call: { in_hubspot: false, outcome: 'No answer', summary: '' },
  changes: [],
  tasks: [],
  text: 'No answer, Jo Sample.',
})

const TIMES = { hold: 60, sort: 10, sortWait: 200 }
const TITLE = 'Logging No answer with Jo Sample, Sample Logistics Pty Ltd.'

function setUp(answers: Record<string, unknown> = {}, times = TIMES) {
  const mic = new FakeMic()
  const calls = mockApi({
    [API.options]: options(),
    [API.summary]: { to_confirm: 1, needs_look: 0, logged_today: 0 },
    [API.notes]: SAVED,
    [notePath()]: SAVED,
    [API.notePreview]: notePreview(SAVED),
    [API.confirm]: { already_sending: false, sending: 1, notes: [note({ status: 'sending' })] },
    ...answers,
  })
  const client = createTestQueryClient()
  client.setQueryData(queryKeys.auth.me(), { state: 'off' })
  const view = renderWithProviders(
    <CardHost env={mic.env()} makeTool={mic.tool} times={{ guard: 0, preview: 0, sort: 20 }} />,
    { queryClient: client },
  )
  const go: string[] = []
  const start = (made: AssistantCommand = noAnswer()): boolean => {
    let started = false
    act(() => {
      started = startQuickLog(
        { command: made, words: 'no answer, Jo Sample', source: 'mic' },
        { client, go: (to) => go.push(to), times },
      )
    })
    return started
  }
  const of = (path: string, method = 'POST') =>
    calls.filter((call) => call.path === path && call.method === method)
  return { start, of, go, ...view }
}

afterEach(() => {
  act(() => {
    closeCard()
    toast.dismiss()
  })
  window.localStorage.clear()
})

describe('the quick log (T3-3)', () => {
  it('saves at once, says exactly what goes, and sends after the hold with no card', async () => {
    const { start, of } = setUp()
    expect(start()).toBe(true)
    expect(await screen.findByText(TITLE)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => {
      expect(of(API.notes)).toHaveLength(1)
    })
    expect(of(API.notes)[0]?.body).toMatchObject({
      company_key: '201',
      contact_id: 'c-1',
      outcome: 'No answer',
      call_type: 'Prospecting Call',
      source: 'mic',
    })
    expect(of(API.notes)[0]?.headers?.get('idempotency-key')).toBeTruthy()
    await waitFor(() => {
      expect(of(API.confirm)).toHaveLength(1)
    })
    expect(of(API.confirm)[0]?.body).toEqual({ ids: [SAVED.id] })
    expect(await screen.findByText('The call is on its way to HubSpot.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Undo inside the hold sends nothing, and opens the card with its saved call', async () => {
    // A hold long enough for a click.
    const { start, of, user } = setUp({}, { ...TIMES, hold: 1500 })
    start()
    await screen.findByText(TITLE)
    await waitFor(() => {
      expect(of(API.notes)).toHaveLength(1)
    })
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    const found = await screen.findByRole('dialog')
    expect(found).toHaveAccessibleName('Log a call with Jo Sample at Sample Logistics Pty Ltd.')
    await new Promise((done) => setTimeout(done, 1800))
    expect(of(API.confirm)).toHaveLength(0)
    // The card shows the call it saved: it isn't saved again.
    expect(await within(found).findByText('No answer')).toBeInTheDocument()
    expect(of(API.notes)).toHaveLength(1)
  })

  it('waits while the server sorts the call, then sends it', async () => {
    let reads = 0
    const read: Answer = (call) => {
      if (call.method !== 'GET') return undefined
      reads += 1
      return Response.json(reads < 3 ? { ...SAVED, status: 'sorting' } : SAVED)
    }
    const { start, of } = setUp({
      [API.notes]: { ...SAVED, status: 'sorting' } satisfies CallNoteOut,
      [notePath()]: read,
    })
    start()
    await waitFor(() => {
      expect(of(API.confirm)).toHaveLength(1)
    })
    expect(reads).toBeGreaterThanOrEqual(3)
  })

  it('a call still sorting after the wait stays in Call logs, and says so', async () => {
    const sorting = { ...SAVED, status: 'sorting' } satisfies CallNoteOut
    const { start, of, user, go } = setUp({ [API.notes]: sorting, [notePath()]: sorting })
    start()
    expect(
      await screen.findByText('Kept in Call logs, to send with the others.', undefined, {
        timeout: 3000,
      }),
    ).toBeInTheDocument()
    expect(of(API.confirm)).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Open Call logs' }))
    expect(go).toEqual(['/assistant/call-logs'])
  })

  it('a save that fails in the hold opens the card, which says why', async () => {
    const refused: Answer = (call) =>
      call.method === 'POST'
        ? Response.json(
            { title: 'Call notes are off', status: 409, code: 'call_notes_off' },
            { status: 409 },
          )
        : undefined
    const { start, of } = setUp({ [API.notes]: refused })
    start()
    const found = await screen.findByRole('dialog')
    expect(await within(found).findByText(/Call notes are off/)).toBeInTheDocument()
    await new Promise((done) => setTimeout(done, TIMES.hold * 3))
    expect(of(API.confirm)).toHaveLength(0)
  })

  it('a call the server didn’t judge quick, or with words or doubt, isn’t one', () => {
    expect(isQuickLog(noAnswer())).toBe(true)
    expect(isQuickLog(noAnswer({ quick: false }))).toBe(false)
    expect(isQuickLog(noAnswer({ outcome: null }))).toBe(false)
    expect(isQuickLog(noAnswer({ person: { found: null, choices: [], heard: 'Jo' } }))).toBe(false)
    expect(isQuickLog(noAnswer({ action: 'task' }))).toBe(false)
    const { start, of } = setUp()
    expect(start(noAnswer({ quick: false }))).toBe(false)
    expect(of(API.notes)).toHaveLength(0)
  })
})
