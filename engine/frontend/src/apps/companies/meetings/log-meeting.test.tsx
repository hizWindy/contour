/**
 * "Log meeting" on a past meeting (PLAN-V17 T3-11), against Track 2's contract (v17.ts Part 3) and
 * a fake server that answers as Track 2's does: a transcript becomes a call note linked to the
 * meeting (201), the meeting's row then says its notes are logged, and Undo deletes the note. The
 * clock is fixed at 9:00 am on Wednesday 18 Nov 2026, Melbourne time. Made-up names and words only.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/api/query'
import type { CallNoteOptions, CallNoteOut, Meeting, MeetingItem } from '@/api/v17'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import MeetingsPage from './index'
import { forgetTranscripts } from './log-meeting-save'

const API = '/api/v1/companies'
const MEETINGS = `${API}/meetings`
const NOTES = `${API}/call-notes`

/** 9:00 am on Wednesday 18 Nov 2026 in Melbourne (daylight saving, +11:00). */
const NOW = new Date('2026-11-17T22:00:00Z')

type ItemChanges = Partial<Omit<MeetingItem, 'meeting'>> & { meeting?: Partial<Meeting> }

function past(id: string, { meeting: changes, ...rest }: ItemChanges = {}): MeetingItem {
  return {
    meeting: {
      id,
      company_id: '101',
      title: 'Lease review',
      starts_at: '2026-11-12T23:00:00Z',
      ends_at: '2026-11-13T00:00:00Z',
      where: 'online',
      outcome: 'COMPLETED',
      ...changes,
    },
    company_name: 'Sample Logistics Pty Ltd',
    group: null,
    form: null,
    notes_logged: false,
    typed: false,
    owner_name: null,
    ...rest,
  }
}

function pastMeetings(): MeetingItem[] {
  return [
    past('7001'),
    past('7002', {
      meeting: { company_id: '102', title: 'Site tour', starts_at: '2026-11-10T03:00:00Z' },
      company_name: 'Sample Mining Pty Ltd',
      notes_logged: true,
    }),
    past('7003', {
      meeting: { company_id: '103', title: 'First meeting', outcome: 'CANCELED' },
      company_name: 'Sample Retail Pty Ltd',
    }),
    // Typed in for New pre-read: not in HubSpot, so it takes no transcript.
    past('', {
      meeting: { company_id: 'lead:7', title: 'Coffee', starts_at: '2026-11-11T22:00:00Z' },
      company_name: 'Sample Health Pty Ltd',
      typed: true,
      form: { id: 'f-typed', status: 'sent' },
    }),
  ]
}

function note(id: string, text: string): CallNoteOut {
  return {
    id,
    company_key: '101',
    company_name: 'Sample Logistics Pty Ltd',
    person: null,
    text,
    source: 'transcript',
    called_at: '2026-11-12T23:00:00Z',
    status: 'sorting',
    sorted_by: 'person',
    unsure: null,
    call: { summary: '', outcome: null },
    changes: [],
    tasks: [],
    left_out: false,
    steps: [],
    hubspot_url: null,
    made_by: 'Jo Sample',
    created_at: '2026-11-17T22:00:00Z',
    confirmed_at: null,
  }
}

interface Sent {
  method: string
  path: string
  body: unknown
  key: string | null
}

interface Server {
  items: MeetingItem[]
  notesOn: boolean
  /** How the transcript route answers: a note, or one of its refusals. */
  transcript: 'ok' | 'not_past' | 'too_long'
  sent: Sent[]
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status })
}

function problem(status: number, title: string, detail: string, code: string): Response {
  return json({ title, detail, status, code }, status)
}

function options(enabled: boolean): CallNoteOptions {
  return {
    enabled,
    ai_enabled: false,
    sending_ready: false,
    waiting_for: 'Waiting for HubSpot write access.',
    outcomes: ['Connected', 'No answer'],
    fields: [],
    soft_seconds: 180,
    max_chars: 6000,
  }
}

function mockServer(changes: Partial<Omit<Server, 'sent'>> = {}): Server {
  const server: Server = {
    items: pastMeetings(),
    notesOn: true,
    transcript: 'ok',
    sent: [],
    ...changes,
  }
  const meetingOfNote = new Map<string, string>()
  let made = 0
  const respond = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const path = url.pathname
    const { method } = request
    const text = method === 'GET' ? '' : await request.clone().text()
    const body: unknown = text ? JSON.parse(text) : null
    server.sent.push({ method, path, body, key: request.headers.get('idempotency-key') })
    if (path === '/api/v1/auth/me') {
      return json({ auth_required: false, user: null, session: null })
    }
    if (path === MEETINGS && method === 'GET') {
      return json({
        items: server.items,
        total: server.items.length,
        meetings_state: 'ready',
        sentence: null,
      })
    }
    if (path === `${NOTES}/options`) return json(options(server.notesOn))
    if (path === `${NOTES}/summary`) {
      return json({ to_confirm: 3, needs_look: 0, logged_today: 0 })
    }
    const transcript = /^\/api\/v1\/companies\/meetings\/(\d+)\/transcript$/.exec(path)
    if (transcript && method === 'POST') {
      if (server.transcript === 'not_past') {
        return problem(
          409,
          "This meeting hasn't happened yet",
          'Log the meeting once it has been.',
          'meeting_not_past',
        )
      }
      if (server.transcript === 'too_long') {
        return problem(
          422,
          'This transcript is too long',
          'This transcript is longer than 60,000 characters. Shorten it, or split it into two.',
          'transcript_too_long',
        )
      }
      const meetingId = transcript[1] ?? ''
      made += 1
      const id = `note-${String(made)}`
      meetingOfNote.set(id, meetingId)
      server.items = server.items.map((item) =>
        item.meeting.id === meetingId ? { ...item, notes_logged: true } : item,
      )
      return json(note(id, (body as { text: string }).text), 201)
    }
    const one = /^\/api\/v1\/companies\/call-notes\/([^/]+)$/.exec(path)
    if (one && method === 'DELETE') {
      const meetingId = meetingOfNote.get(one[1] ?? '')
      server.items = server.items.map((item) =>
        item.meeting.id === meetingId ? { ...item, notes_logged: false } : item,
      )
      return new Response(null, { status: 204 })
    }
    return problem(404, 'Not found', 'Not here.', 'not_found')
  }
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request) => respond(request)),
  )
  return server
}

function transcripts(server: Server): Sent[] {
  return server.sent.filter((one) => one.method === 'POST' && one.path.endsWith('/transcript'))
}

function renderPast(queryClient = createTestQueryClient()) {
  const router = createMemoryRouter([{ path: '/companies/meetings', element: <MeetingsPage /> }], {
    initialEntries: ['/companies/meetings?when=past'],
  })
  return renderWithProviders(<RouterProvider router={router} />, {
    withRouter: false,
    queryClient,
  })
}

function row(company: string): HTMLElement {
  const found = screen.getByText(company).closest('li')
  if (!found) throw new Error(`No row for ${company}`)
  return found
}

/** Opens "Log meeting" on Sample Logistics' row, and gives its panel and its box. */
async function openLog(user: ReturnType<typeof renderPast>['user']) {
  const button = await within(await waitFor(() => row('Sample Logistics Pty Ltd'))).findByRole(
    'button',
    { name: 'Log meeting: Sample Logistics Pty Ltd, Fri 13 Nov, 10:00 am' },
  )
  await user.click(button)
  const panel = await screen.findByRole('dialog', { name: 'Log meeting' })
  const box = within(panel).getByRole('textbox', { name: 'Transcript' })
  return { panel, box }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  toast.dismiss()
  // A transcript not saved stays in the page's memory for its meeting: each test starts afresh.
  forgetTranscripts(null)
})

describe('Log meeting on a past meeting', () => {
  it('is on each past meeting from HubSpot, not on a cancelled or a typed one', async () => {
    mockServer()
    renderPast()
    await screen.findByRole('list', { name: 'Past meetings' })
    expect(
      await within(row('Sample Logistics Pty Ltd')).findByRole('button', { name: /^Log meeting/ }),
    ).toBeInTheDocument()
    // Notes logged already: another part can still be logged.
    expect(
      within(row('Sample Mining Pty Ltd')).getByRole('button', { name: /^Log meeting/ }),
    ).toBeInTheDocument()
    expect(within(row('Sample Retail Pty Ltd')).queryByRole('button')).toBeNull()
    expect(within(row('Sample Health Pty Ltd')).queryByRole('button')).toBeNull()
  })

  it('is not there while call notes are off', async () => {
    mockServer({ notesOn: false })
    // The switches are known from the start, as the menu has usually asked for them by then.
    const client = createTestQueryClient()
    client.setQueryData(queryKeys.companies.callNoteOptions(), options(false))
    renderPast(client)
    const list = await screen.findByRole('list', { name: 'Past meetings' })
    expect(within(list).getAllByText('No notes yet')).not.toEqual([])
    expect(within(list).queryAllByRole('button')).toEqual([])
  })
})

describe('the transcript box', () => {
  it('takes pasted words, saves them once with a key, and joins the batch with Undo', async () => {
    const server = mockServer()
    const { user } = renderPast()
    const { panel, box } = await openLog(user)
    expect(
      within(panel).getByText('Sample Logistics Pty Ltd · Lease review · Fri 13 Nov, 10:00 am'),
    ).toBeInTheDocument()
    // The box takes the focus, so Ctrl+V pastes at once.
    await waitFor(() => {
      expect(box).toHaveFocus()
    })
    await user.paste('Jo Sample: Thanks for coming in.\nSam Sample: Our Perth lease ends in June.')
    await user.click(within(panel).getByRole('button', { name: 'Save notes' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Log meeting' })).toBeNull()
    })
    const [saved] = transcripts(server)
    expect(saved?.path).toBe(`${MEETINGS}/7001/transcript`)
    expect(saved?.body).toEqual({
      text: 'Jo Sample: Thanks for coming in.\nSam Sample: Our Perth lease ends in June.',
      file_name: null,
    })
    expect(saved?.key).toMatch(/^[\w-]{8,}$/)
    // The same toast as Log call, and the row says so at once.
    expect(await screen.findByText('Saved. 4 to confirm.')).toBeInTheDocument()
    expect(within(row('Sample Logistics Pty Ltd')).getByText('Notes logged')).toBeInTheDocument()
    expect(transcripts(server)).toHaveLength(1)
  })

  it('Ctrl+Enter saves, and Undo deletes the note and keeps the words for this meeting', async () => {
    const server = mockServer()
    const { user } = renderPast()
    const { box } = await openLog(user)
    await waitFor(() => {
      expect(box).toHaveFocus()
    })
    await user.paste('Jo Sample: We will send the floor plan.')
    await user.keyboard('{Control>}{Enter}{/Control}')
    await screen.findByText('Saved. 4 to confirm.')

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(
      await screen.findByText('Undone. The transcript is back as a draft.'),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(server.sent.some((one) => one.method === 'DELETE')).toBe(true)
    })
    expect(server.sent.find((one) => one.method === 'DELETE')?.path).toBe(`${NOTES}/note-1`)
    // The server says the meeting has no notes again.
    expect(
      await within(row('Sample Logistics Pty Ltd')).findByText('No notes yet'),
    ).toBeInTheDocument()

    // Opened again, the box holds the words.
    const again = await openLog(user)
    expect(again.box).toHaveValue('Jo Sample: We will send the floor plan.')
  })

  it('reads a .vtt file in the browser, as text, and sends its name so the server takes its times out', async () => {
    const server = mockServer()
    const { user } = renderPast()
    const { panel, box } = await openLog(user)
    const vtt = [
      'WEBVTT',
      '',
      '1',
      '00:00:01.000 --> 00:00:04.000',
      '<v Jo Sample>Thanks for coming in.</v>',
    ].join('\n')
    const input = panel.querySelector<HTMLInputElement>('[data-slot=transcript-file]')
    if (!input) throw new Error('No file input')
    await user.upload(input, new File([vtt], 'Sample meeting.vtt', { type: 'text/vtt' }))

    await waitFor(() => {
      expect(box).toHaveValue(vtt)
    })
    expect(within(panel).getByText('From Sample meeting.vtt')).toBeInTheDocument()
    expect(
      within(panel).getByText('The times and cue numbers are taken out when it is saved.'),
    ).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Save notes' }))
    await waitFor(() => {
      expect(transcripts(server)).toHaveLength(1)
    })
    expect(transcripts(server)[0]?.body).toEqual({ text: vtt, file_name: 'Sample meeting.vtt' })
  })

  it('says which files it reads, and the file can be taken out again', async () => {
    mockServer()
    const { user } = renderPast()
    const { panel, box } = await openLog(user)
    const input = panel.querySelector<HTMLInputElement>('[data-slot=transcript-file]')
    if (!input) throw new Error('No file input')
    await user.upload(input, new File(['Jo: Hi.'], 'notes.txt', { type: 'text/plain' }))
    await waitFor(() => {
      expect(box).toHaveValue('Jo: Hi.')
    })
    await user.click(within(panel).getByRole('button', { name: 'Remove notes.txt' }))
    expect(box).toHaveValue('')
    expect(within(panel).queryByText('From notes.txt')).toBeNull()

    // Past the picker's own filter, as another browser could let it through.
    fireEvent.change(input, { target: { files: [new File(['x'], 'Minutes.docx')] } })
    expect(
      await within(panel).findByText(
        'Only a .txt or .vtt file can be read here. Paste the words instead.',
      ),
    ).toBeInTheDocument()
    expect(box).toHaveValue('')
  })

  it('shows the count near the limit, and says so over it without sending', async () => {
    const server = mockServer()
    const { user } = renderPast()
    const { panel, box } = await openLog(user)
    await waitFor(() => {
      expect(box).toHaveFocus()
    })
    await user.paste('a'.repeat(54_000))
    expect(within(panel).getByText('54,000 of 60,000 characters')).toBeInTheDocument()
    await user.paste('a'.repeat(6_001))
    expect(
      within(panel).getByText(
        'Too long: 60,001 of 60,000 characters. Shorten it, or split it into two.',
      ),
    ).toBeInTheDocument()
    expect(box).toHaveAttribute('aria-invalid', 'true')
    await user.click(within(panel).getByRole('button', { name: 'Save notes' }))
    expect(transcripts(server)).toEqual([])
    expect(screen.getByRole('dialog', { name: 'Log meeting' })).toBeInTheDocument()
  })

  it('says to paste something first, and sends nothing', async () => {
    const server = mockServer()
    const { user } = renderPast()
    const { panel } = await openLog(user)
    await user.click(within(panel).getByRole('button', { name: 'Save notes' }))
    expect(within(panel).getByRole('alert')).toHaveTextContent(
      'Paste the transcript or read a file first.',
    )
    expect(transcripts(server)).toEqual([])
  })

  it.each([
    [
      'not_past',
      "Not saved yet. This meeting hasn't happened yet. Log the meeting once it has been.",
    ],
    [
      'too_long',
      'Not saved yet. This transcript is too long. This transcript is longer than 60,000 characters. Shorten it, or split it into two.',
    ],
  ] as const)('a refusal (%s) keeps the words in the box and says why', async (refusal, words) => {
    mockServer({ transcript: refusal })
    const { user } = renderPast()
    const { panel, box } = await openLog(user)
    await waitFor(() => {
      expect(box).toHaveFocus()
    })
    await user.paste('Jo Sample: Thanks for coming in.')
    await user.click(within(panel).getByRole('button', { name: 'Save notes' }))
    expect(await within(panel).findByRole('alert')).toHaveTextContent(words)
    expect(box).toHaveValue('Jo Sample: Thanks for coming in.')
    expect(within(panel).getByRole('button', { name: 'Save notes' })).toBeEnabled()
    expect(screen.queryByText(/^Saved\./)).toBeNull()
  })
})
