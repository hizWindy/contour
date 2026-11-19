/**
 * Sending a pre-read, the team list, HubSpot tasks, "Also email them", failed task retry, and
 * "Send to more people" (PLAN-V17 T3-11; PLAN-V19 T2-3 to T2-5), against the generated contract
 * and a fake server that answers as `meeting_send.py` does. Made-up names and addresses only.
 */
import { screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SignIn } from '@/api/hooks/auth'
import { queryKeys } from '@/api/query'
import type {
  FormEmailPreview,
  FormMeeting,
  FormPerson,
  FormRecipient,
  FormSummary,
  HubSpotCopy,
  MeetingFormOut,
  MeetingFormPatch,
  TeamMember,
} from '@/api/types'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { asPhone } from '@/test/screen'
import { SAMPLE_USER } from '@/test/fake-auth'
import PreReadPage from './index'

const FORM_ID = '0f3c9a2e-1111-2222-3333-444444444444'
const TEAM_URL = '/api/v1/companies/team'
const FORM = `/api/v1/companies/meetings/forms/${FORM_ID}`
const PREVIEW = `${FORM}/preview`
const SEND = `${FORM}/send`
const RETRY_TASKS = `${FORM}/tasks/retry`

const AL_ADDR = 'al.sample@contour.example'
const JO_ADDR = 'jo.sample@contour.example'
const MIA_ADDR = 'mia.sample@contour.example'
const OUTSIDE = 'outside@elsewhere.example'

const TEAM: TeamMember[] = [
  { owner_id: 'o-1', name: 'Al-khair Sample', has_account: true, is_me: true },
  { owner_id: 'o-2', name: 'Jo Sample', has_account: true, is_me: false },
  { owner_id: 'o-3', name: 'Kai Sample', has_account: false, is_me: false },
]

const OWNER_ADDRESSES: Record<string, string | null> = {
  'o-1': AL_ADDR,
  'o-2': JO_ADDR,
  'o-3': null,
}

const SUMMARY: FormSummary = {
  text: 'A freight company with about 300 staff.',
  by: 'ai',
  sources: [],
}

const MEETING: FormMeeting = {
  meeting_id: null,
  company_key: '101',
  company_name: 'Sample Logistics Pty Ltd',
  title: 'Office walk-through',
  starts_at: '2026-11-26T23:00:00Z',
  ends_at: '2026-11-27T00:00:00Z',
  where: 'online',
}

function recipient(changes: Partial<FormRecipient> = {}): FormRecipient {
  return {
    owner_id: null,
    name: null,
    address: null,
    at: '2026-11-17T03:00:00Z',
    task: 'none',
    email: false,
    ...changes,
  }
}

/** A draft ready to send: both blanks filled. */
function form(changes: Partial<MeetingFormOut> = {}): MeetingFormOut {
  return {
    id: FORM_ID,
    meeting: MEETING,
    status: 'draft',
    facts: [{ label: 'Staff', value: 'About 300', source: 'HubSpot company' }],
    summaries: { what_they_do: SUMMARY, what_we_know: SUMMARY, talks_so_far: SUMMARY },
    next_step: 'Book a site visit.',
    going: 'Jo Sample',
    sent_to: [],
    sent_at: null,
    sent_by: null,
    hubspot_copy: null,
    cost_usd: '0.031200',
    error: null,
    ...changes,
  }
}

const EMAIL_TEXT = [
  'Pre-read for the meeting with Sample Logistics Pty Ltd',
  'Office walk-through',
  '',
  'Staff: About 300',
].join('\n')

/** A pre-read already sent to Jo Sample (`o-2`). */
function sent(copy: HubSpotCopy, changes: Partial<MeetingFormOut> = {}): MeetingFormOut {
  return form({
    status: 'sent',
    sent_to: [
      recipient({
        owner_id: 'o-2',
        name: 'Jo Sample',
        address: JO_ADDR,
        at: '2026-11-25T22:12:00Z',
        task: 'sent',
        email: true,
      }),
    ],
    sent_at: '2026-11-25T22:12:00Z',
    sent_by: 'Al Sample',
    hubspot_copy: copy,
    ...changes,
  })
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status })
}

function problem(status: number, title: string, detail: string, code: string): Response {
  return json({ title, detail, status, code }, status)
}

interface Call {
  method: string
  path: string
  body: unknown
}

interface Server {
  team: TeamMember[]
  /** When true, GET /companies/team answers 503 team_unavailable until cleared. */
  teamFails: boolean
  /** HubSpot owner ids automatically ticked on first preview (`owner_ids: null`). */
  meetingOwners: string[]
  form: MeetingFormOut
  meetingNote?: string | null
  domain: string
  send: 'ok' | 'not_set_up' | 'email_failed' | 'outside_once' | 'writes_off'
  /** Owner ids whose HubSpot tasks fail on send (`task: 'failed'`). */
  failedTaskOwners: string[]
  /** When set, POST .../tasks/retry fails once or permanently. */
  retryTaskFails: boolean
  copyAfterRetry: HubSpotCopy
  patchWaits: boolean
  sendWaits: boolean
  previewFails: number | null
  release: () => void
  calls: Call[]
}

function mockServer(changes: Partial<Omit<Server, 'calls' | 'release'>> = {}): Server {
  const server: Server = {
    team: TEAM,
    teamFails: false,
    meetingOwners: ['o-2'],
    form: form(),
    domain: 'contour.example',
    send: 'ok',
    failedTaskOwners: [],
    retryTaskFails: false,
    copyAfterRetry: { state: 'saved', sentence: null },
    patchWaits: false,
    sendWaits: false,
    previewFails: null,
    release: () => undefined,
    calls: [],
    ...changes,
  }
  let refused = false
  let previews = 0
  const allowed = (address: string): boolean =>
    address.trim().toLowerCase().endsWith(`@${server.domain}`)

  const priorForOwner = (ownerId: string): FormRecipient | undefined =>
    server.form.sent_to.find((r) => r.owner_id === ownerId)
  const priorForAddr = (addr: string): FormRecipient | undefined =>
    server.form.sent_to.find((r) => r.address?.toLowerCase() === addr.toLowerCase())

  const respond = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const { method } = request
    const text = method === 'GET' ? '' : await request.clone().text()
    const body: unknown = text ? JSON.parse(text) : null
    server.calls.push({ method, path: url.pathname, body })

    if (url.pathname === TEAM_URL && method === 'GET') {
      if (server.teamFails) {
        return problem(
          503,
          "The team list didn't load",
          'Add people by email, or try again.',
          'team_unavailable',
        )
      }
      return json(server.team)
    }

    if (url.pathname === FORM && method === 'GET') return json(server.form)

    if (url.pathname === FORM && method === 'PATCH') {
      if (server.patchWaits) {
        await new Promise<void>((resolve) => {
          server.release = resolve
        })
      }
      const patch = body as MeetingFormPatch
      server.form = {
        ...server.form,
        next_step: patch.next_step ?? server.form.next_step,
        going: patch.going ?? server.form.going,
        status: server.form.status === 'sent' ? 'draft' : server.form.status,
      }
      return json(server.form)
    }

    if (url.pathname === PREVIEW && method === 'POST') {
      previews += 1
      if (previews === server.previewFails) {
        return json({ title: 'Something went wrong on our side', status: 500 }, 500)
      }
      const req = body as {
        owner_ids?: string[] | null
        emails?: string[]
        email_them?: boolean
      }
      const ownerIds =
        req.owner_ids === null || req.owner_ids === undefined ? server.meetingOwners : req.owner_ids
      const emailThem = req.email_them ?? false
      const added = req.emails ?? []

      const people: FormPerson[] = []
      const ownerIndexByAddr = new Map<string, number>()

      for (const ownerId of ownerIds) {
        const member = server.team.find((m) => m.owner_id === ownerId)
        if (!member) continue
        const addr = OWNER_ADDRESSES[ownerId] ?? null
        const prior = priorForOwner(ownerId) ?? (addr ? priorForAddr(addr) : undefined)
        const already = prior?.at ?? null
        const taskNeeded = !prior
        const emailNeeded = Boolean(!prior && emailThem && addr)
        const idx = people.length
        people.push({
          owner_id: ownerId,
          name: member.name,
          address: addr && (emailNeeded || prior?.email) ? addr : null,
          task: taskNeeded,
          email: emailNeeded,
          why: server.meetingOwners.includes(ownerId) ? 'on the meeting' : 'picked by you',
          already,
          ticked: already === null,
          allowed: true,
        })
        if (addr) ownerIndexByAddr.set(addr.toLowerCase(), idx)
      }

      for (const rawAddr of added) {
        const key = rawAddr.trim().toLowerCase()
        const isAllowed = allowed(rawAddr)
        if (isAllowed && ownerIndexByAddr.has(key)) {
          const idx = ownerIndexByAddr.get(key) as number
          const existing = people[idx]
          if (existing.already === null) {
            people[idx] = { ...existing, address: key, email: true, ticked: true }
          }
          continue
        }
        const prior = isAllowed ? priorForAddr(key) : undefined
        const already = isAllowed && prior ? (prior.at ?? null) : null
        const willEmail = isAllowed && !prior
        people.push({
          owner_id: null,
          name: key === MIA_ADDR ? 'Mia Sample' : key === AL_ADDR ? 'Al Sample' : null,
          address: isAllowed ? key : rawAddr.trim(),
          task: false,
          email: willEmail,
          why: 'added by you',
          already,
          ticked: willEmail,
          allowed: isAllowed,
        })
      }

      const preview: FormEmailPreview = {
        subject: 'Pre-read: Sample Logistics Pty Ltd, Fri 27 Nov, 10:00 am',
        text: EMAIL_TEXT,
        html: '<h2>Pre-read for the meeting with Sample Logistics Pty Ltd</h2><script>alert(1)</script>',
        task_subject: 'Pre-read: Office walk-through with Sample Logistics Pty Ltd, Fri 27 Nov',
        task_due: '2026-11-26',
        people,
        meeting_note: server.meetingNote ?? null,
      }
      return json(preview)
    }

    if (url.pathname === SEND && method === 'POST') {
      if (server.sendWaits) {
        await new Promise<void>((resolve) => {
          server.release = resolve
        })
      }
      const req = body as {
        owner_ids?: string[]
        emails?: string[]
        email_them?: boolean
      }
      const ownerIds = req.owner_ids ?? []
      const emails = req.emails ?? []
      const emailThem = req.email_them ?? false

      if (server.send === 'outside_once' && !refused) {
        refused = true
        server.domain = 'contourinteriors.example'
      }
      const outside = emails.filter((address) => !allowed(address))
      if (outside.length > 0) {
        return problem(
          422,
          'Only Contour addresses',
          `A pre-read goes to Contour addresses only, so nothing was sent. Take out: ${outside.join(', ')}.`,
          'outside_address',
        )
      }

      const newOwners = ownerIds.filter((id) => !priorForOwner(id))
      const ownerEmailable = newOwners.filter((id) => emailThem && OWNER_ADDRESSES[id])
      const newExtraEmails = emails.filter((addr) => !priorForAddr(addr))

      if (server.form.status === 'sent' && newOwners.length === 0 && newExtraEmails.length === 0) {
        server.form = { ...server.form, hubspot_copy: server.copyAfterRetry }
        return json(server.form)
      }

      if (
        server.send === 'writes_off' &&
        newOwners.length > 0 &&
        ownerEmailable.length === 0 &&
        newExtraEmails.length === 0
      ) {
        return problem(
          409,
          'HubSpot writing is off',
          "HubSpot isn't connected, so no tasks can go. Tick 'Also email them' to send it by email.",
          'hubspot_writes_off',
        )
      }

      if (
        server.send === 'not_set_up' &&
        (ownerEmailable.length > 0 || newExtraEmails.length > 0)
      ) {
        return problem(
          409,
          "Email isn't set up",
          "Email isn't set up yet, so nothing was sent. The pre-read stays here: copy it, or send it once email is set up.",
          'email_not_set_up',
        )
      }

      if (
        server.send === 'email_failed' &&
        (ownerEmailable.length > 0 || newExtraEmails.length > 0)
      ) {
        return problem(
          502,
          "The email didn't go",
          'Nothing was sent. Try again in a minute.',
          'email_failed',
        )
      }

      const merged = [...server.form.sent_to]
      for (const ownerId of newOwners) {
        const member = server.team.find((m) => m.owner_id === ownerId)
        const addr = OWNER_ADDRESSES[ownerId] ?? null
        const emailed = Boolean(emailThem && addr)
        const taskState =
          server.send === 'writes_off'
            ? 'waiting'
            : server.failedTaskOwners.includes(ownerId)
              ? 'failed'
              : 'sent'
        merged.push(
          recipient({
            owner_id: ownerId,
            name: member?.name ?? null,
            address: emailed ? addr : null,
            at: '2026-11-25T22:12:00Z',
            task: taskState,
            email: emailed,
          }),
        )
      }
      for (const addr of newExtraEmails) {
        merged.push(
          recipient({
            owner_id: null,
            name: addr === MIA_ADDR ? 'Mia Sample' : addr === AL_ADDR ? 'Al Sample' : null,
            address: addr.toLowerCase(),
            at: '2026-11-25T22:12:00Z',
            task: 'none',
            email: true,
          }),
        )
      }

      server.form = {
        ...server.form,
        status: 'sent',
        sent_to: merged,
        sent_at: server.form.sent_at ?? '2026-11-25T22:12:00Z',
        sent_by: server.form.sent_by ?? 'Al Sample',
        hubspot_copy:
          server.form.hubspot_copy ??
          (server.send === 'writes_off'
            ? { state: 'waiting', sentence: 'Waiting for HubSpot write access.' }
            : { state: 'saved', sentence: null }),
      }
      return json(server.form)
    }

    if (url.pathname === RETRY_TASKS && method === 'POST') {
      if (server.retryTaskFails) {
        return problem(
          409,
          'HubSpot writing is off',
          "HubSpot isn't connected.",
          'hubspot_writes_off',
        )
      }
      server.form = {
        ...server.form,
        sent_to: server.form.sent_to.map((r) =>
          r.task === 'failed' || r.task === 'waiting' ? { ...r, task: 'sent' } : r,
        ),
        hubspot_copy:
          server.form.hubspot_copy?.state === 'failed'
            ? { state: 'saved', sentence: null }
            : server.form.hubspot_copy,
      }
      return json(server.form)
    }

    return problem(404, 'Not found', 'Not here.', 'not_found')
  }

  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request) => respond(request)),
  )
  return server
}

function posts(server: Server, path: string): unknown[] {
  return server.calls
    .filter((call) => call.method === 'POST' && call.path === path)
    .map((call) => call.body)
}

function renderPreRead(signIn: SignIn = { state: 'off' }) {
  const router = createMemoryRouter(
    [
      { path: '/assistant/meetings', element: <h1>Client meetings</h1> },
      { path: '/assistant/meetings/:formId', element: <PreReadPage /> },
      { path: '/companies/:key', element: <h1>Company</h1> },
    ],
    { initialEntries: [`/assistant/meetings/${FORM_ID}`] },
  )
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), signIn)
  return renderWithProviders(<RouterProvider router={router} />, {
    withRouter: false,
    queryClient,
    // No wait between typed keys: the long addresses made a test run past 5 seconds under load.
    userEventOptions: { delay: null },
  })
}

function status(): HTMLElement {
  const found = document.querySelector('[data-slot=pre-read-status]')
  if (!(found instanceof HTMLElement)) throw new Error('No status')
  return found
}

function person(dialog: HTMLElement, name: string): HTMLElement {
  const row = within(dialog).getByText(name).closest('[data-slot=send-person]')
  if (!(row instanceof HTMLElement)) throw new Error(`No row for ${name}`)
  return row
}

async function openDialog(
  user: ReturnType<typeof renderPreRead>['user'],
  buttonName: string | RegExp = 'Check and send',
): Promise<HTMLElement> {
  await screen.findByRole('heading', { level: 1, name: 'Office walk-through' })
  await user.click(screen.getByRole('button', { name: buttonName }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Send the pre-read?' })
  await within(dialog).findByRole('region', { name: 'The email as it will arrive' })
  return dialog
}

afterEach(() => {
  toast.dismiss()
})

describe('Check and send (V19 T2-3 to T2-5)', () => {
  it('shows the HubSpot task preview, email preview, team list with You, and defaults to HubSpot task only', async () => {
    const server = mockServer()
    const { user } = renderPreRead()
    const dialog = await openDialog(user)

    expect(posts(server, PREVIEW)).toEqual([{ owner_ids: null, emails: [], email_them: false }])

    // HubSpot task subject and due day are shown.
    const taskBox = dialog.querySelector('[data-slot=task-box]')
    expect(taskBox).toHaveTextContent(
      'Pre-read: Office walk-through with Sample Logistics Pty Ltd, Fri 27 Nov',
    )
    expect(taskBox).toHaveTextContent('26 Nov 2026')

    // Email box scrolls by keyboard and never renders raw HTML.
    const email = within(dialog).getByRole('region', { name: 'The email as it will arrive' })
    expect(email).toHaveAttribute('tabindex', '0')
    expect(
      within(email).getByText('Pre-read: Sample Logistics Pty Ltd, Fri 27 Nov, 10:00 am'),
    ).toBeInTheDocument()
    expect(email).toHaveTextContent('Staff: About 300')
    expect(email.innerHTML).not.toContain('<h2>')
    expect(document.querySelector('script')).toBeNull()

    // Middle scrolls while header and footer buttons stay out.
    const middle = dialog.querySelector('[data-slot=send-dialog-body]')
    expect(middle).toHaveClass('overflow-y-auto', 'min-h-0')
    expect(middle).toContainElement(email)
    expect(middle).not.toContainElement(within(dialog).getByRole('heading', { level: 2 }))
    expect(middle).not.toContainElement(
      within(dialog).getByRole('button', { name: 'Send to 1 person' }),
    )
    expect(middle).not.toContainElement(within(dialog).getByRole('button', { name: 'Cancel' }))

    // Team list shows Al-khair with "You", Jo ticked ("HubSpot task · On the meeting"),
    // and Kai with "No Contour account · HubSpot task only".
    expect(within(person(dialog, 'Al-khair Sample')).getByText('You')).toBeInTheDocument()
    expect(within(person(dialog, 'Al-khair Sample')).getByRole('checkbox')).not.toBeChecked()

    const jo = within(person(dialog, 'Jo Sample'))
    expect(jo.getByRole('checkbox', { name: 'Jo Sample' })).toBeChecked()
    expect(jo.getByText('HubSpot task · On the meeting')).toBeInTheDocument()

    expect(
      within(person(dialog, 'Kai Sample')).getByText('No Contour account · HubSpot task only'),
    ).toBeInTheDocument()

    // "Also email them" starts unchecked.
    expect(within(dialog).getByRole('checkbox', { name: 'Also email them' })).not.toBeChecked()

    await user.click(within(dialog).getByRole('button', { name: 'Send to 1 person' }))
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })
    expect(posts(server, SEND)).toEqual([{ owner_ids: ['o-2'], emails: [], email_them: false }])

    await waitFor(() => {
      expect(within(status()).getByText('Sent')).toBeInTheDocument()
    })
    expect(status().querySelector('[data-slot=tick-in]')).not.toBeNull()
    const note = screen.getByText('Sent to Jo Sample on 26 Nov 2026 at 9:12 am, by Al Sample.')
    await waitFor(() => {
      expect(note.closest('[data-slot=sent-note]')).toHaveFocus()
    })
    expect(screen.queryByRole('button', { name: 'Check and send' })).toBeNull()
  })

  it('covers every choice 11 recipient case: Also email them, no Contour account, and added email', async () => {
    const server = mockServer()
    const { user } = renderPreRead()
    const dialog = await openDialog(user)

    // Pick Kai (no Contour account) and add Mia by email, while Also email them is still OFF.
    await user.click(within(person(dialog, 'Kai Sample')).getByRole('checkbox'))
    const box = within(dialog).getByRole('textbox', { name: 'Add someone' })
    await user.type(box, MIA_ADDR)
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Send to 3 people' })).toBeEnabled()
    })
    // Jo & Kai get HubSpot task only; Mia gets Email even though Also email them is OFF.
    expect(
      within(person(dialog, 'Jo Sample')).getByText('HubSpot task · On the meeting'),
    ).toBeInTheDocument()
    expect(
      within(person(dialog, 'Kai Sample')).getByText('HubSpot task · Picked by you'),
    ).toBeInTheDocument()
    expect(
      within(person(dialog, 'Mia Sample')).getByText(`Email · ${MIA_ADDR} · Added by you`),
    ).toBeInTheDocument()

    // Now tick "Also email them": Jo gets HubSpot task + Email, Kai STILL gets HubSpot task only.
    await user.click(within(dialog).getByRole('checkbox', { name: 'Also email them' }))
    await waitFor(() => {
      expect(
        within(person(dialog, 'Jo Sample')).getByText(
          `HubSpot task · Email · ${JO_ADDR} · On the meeting`,
        ),
      ).toBeInTheDocument()
    })
    expect(
      within(person(dialog, 'Kai Sample')).getByText(
        'HubSpot task · Picked by you · No Contour account · HubSpot task only',
      ),
    ).toBeInTheDocument()
    expect(
      within(person(dialog, 'Mia Sample')).getByText(`Email · ${MIA_ADDR} · Added by you`),
    ).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Send to 3 people' }))
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })
    expect(posts(server, SEND)).toEqual([
      { owner_ids: ['o-2', 'o-3'], emails: [MIA_ADDR], email_them: true },
    ])
  })

  it('adds and removes addresses, and rejects non-Contour addresses before sending', async () => {
    const server = mockServer()
    const { user } = renderPreRead()
    const dialog = await openDialog(user)
    const box = within(dialog).getByRole('textbox', { name: 'Add someone' })

    await user.type(box, `Outside <${OUTSIDE}>; Al <${AL_ADDR.toUpperCase()}>`)
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => {
      expect(posts(server, PREVIEW).at(-1)).toEqual({
        owner_ids: ['o-2'],
        emails: [OUTSIDE, AL_ADDR],
        email_them: false,
      })
    })
    expect(box).toHaveValue('')

    const outside = within(await waitFor(() => person(dialog, OUTSIDE)))
    expect(outside.getByRole('checkbox', { name: OUTSIDE })).toBeDisabled()
    expect(
      outside.getByText("Not a Contour address, so it can't get the pre-read."),
    ).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: `Remove ${OUTSIDE}` }))
    await waitFor(() => {
      expect(within(dialog).queryByText(OUTSIDE)).toBeNull()
    })

    // Duplicate and unreadable email validation.
    await user.type(box, AL_ADDR)
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Already on the list.')
    await user.clear(box)
    await user.type(box, 'not-an-email')
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      "That doesn't look like an email address.",
    )
  })

  it('says when the team list failed to load (V19 T2-5), still lets email addresses be added, and Try again loads it', async () => {
    const server = mockServer({ teamFails: true })
    const { user } = renderPreRead()
    const dialog = await openDialog(user)

    expect(
      await within(dialog).findByText(
        "The team list didn't load. Add people by email, or try again.",
      ),
    ).toBeInTheDocument()
    await user.type(within(dialog).getByRole('textbox', { name: 'Add someone' }), MIA_ADDR)
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))
    expect(
      await within(dialog).findByRole('button', { name: 'Send to 2 people' }),
    ).toBeInTheDocument()

    server.teamFails = false
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }))
    expect(await within(dialog).findByText('Al-khair Sample')).toBeInTheDocument()
    expect(
      within(dialog).queryByText("The team list didn't load. Add people by email, or try again."),
    ).toBeNull()
  })

  it('tells the rep to tick Also email them when HubSpot is not connected (V19 T2-5)', async () => {
    const server = mockServer({ send: 'writes_off' })
    const { user } = renderPreRead()
    const dialog = await openDialog(user)

    await user.click(within(dialog).getByRole('button', { name: 'Send to 1 person' }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent(
      "HubSpot isn't connected, so no tasks can go. Tick 'Also email them' to send it by email.",
    )
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('checkbox', { name: 'Also email them' }))
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Send to 1 person' })).toBeEnabled()
    })
    await user.click(within(dialog).getByRole('button', { name: 'Send to 1 person' }))
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })
    expect(posts(server, SEND).at(-1)).toEqual({
      owner_ids: ['o-2'],
      emails: [],
      email_them: true,
    })
  })

  it('keeps an added address whose check failed and retries with Try again', async () => {
    const server = mockServer({ previewFails: 2 })
    const { user } = renderPreRead()
    const dialog = await openDialog(user)
    await user.type(within(dialog).getByRole('textbox', { name: 'Add someone' }), MIA_ADDR)
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))

    expect(
      await within(dialog).findByText('Not checked yet. It gets nothing until it is.'),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }))
    expect(
      await within(dialog).findByRole('button', { name: 'Send to 2 people' }),
    ).toBeInTheDocument()
    expect(posts(server, PREVIEW)).toHaveLength(3)
  })

  it('handles outside_address on send and re-checks the list', async () => {
    const server = mockServer({ send: 'outside_once' })
    const { user } = renderPreRead()
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('textbox', { name: 'Add someone' }))
    await user.type(within(dialog).getByRole('textbox', { name: 'Add someone' }), MIA_ADDR)
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Send to 2 people' })).toBeEnabled()
    })

    // Uncheck Jo so only Mia (who fails after domain switches to contourinteriors.example) goes.
    await user.click(within(person(dialog, 'Jo Sample')).getByRole('checkbox'))
    await user.click(within(dialog).getByRole('button', { name: 'Send to 1 person' }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent(`Take out: ${MIA_ADDR}.`)
    await waitFor(() => {
      expect(
        within(person(dialog, 'Mia Sample')).getByText(/Not a Contour address/),
      ).toBeInTheDocument()
    })
    expect(posts(server, PREVIEW)).toHaveLength(4)
  })

  it('offers Copy the pre-read when email is not set up (409 email_not_set_up)', async () => {
    mockServer({ send: 'not_set_up' })
    const { user } = renderPreRead()
    const dialog = await openDialog(user)

    await user.click(within(dialog).getByRole('checkbox', { name: 'Also email them' }))
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Send to 1 person' })).toBeEnabled()
    })
    await user.click(within(dialog).getByRole('button', { name: 'Send to 1 person' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      "Email isn't set up yet, so nothing was sent. The pre-read stays here: copy it, or send it once email is set up.",
    )
    await user.click(within(dialog).getByRole('button', { name: 'Copy the pre-read' }))
    expect(
      await within(dialog).findByText('Copied. Paste it into an email to the team.'),
    ).toBeInTheDocument()
    const copied = await navigator.clipboard.readText()
    expect(copied.startsWith('Pre-read:')).toBe(true)
  })

  it('cannot be stopped or changed while it sends', async () => {
    const server = mockServer({ sendWaits: true })
    const { user } = renderPreRead()
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Send to 1 person' }))
    await waitFor(() => {
      expect(posts(server, SEND)).toHaveLength(1)
    })

    expect(within(dialog).getByRole('button', { name: 'Sending.' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(within(person(dialog, 'Jo Sample')).getByRole('checkbox')).toBeDisabled()
    expect(within(dialog).getByRole('textbox', { name: 'Add someone' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog', { name: 'Send the pre-read?' })).toBeInTheDocument()

    server.release()
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })
    expect(
      await screen.findByText('Sent to Jo Sample on 26 Nov 2026 at 9:12 am, by Al Sample.'),
    ).toBeInTheDocument()
  })

  it('says when email failed and brings the error into view', async () => {
    const server = mockServer({ send: 'email_failed' })
    const { user } = renderPreRead()
    const dialog = await openDialog(user)
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView')
    await user.click(within(dialog).getByRole('checkbox', { name: 'Also email them' }))
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Send to 1 person' })).toBeEnabled()
    })
    await user.click(within(dialog).getByRole('button', { name: 'Send to 1 person' }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent("The email didn't go. Nothing was sent. Try again in a minute.")
    await waitFor(() => {
      expect(scrolled.mock.contexts.some((one) => (one as Element).contains(alert))).toBe(true)
    })
    await user.click(within(dialog).getByRole('button', { name: 'Send to 1 person' }))
    await waitFor(() => {
      expect(posts(server, SEND)).toHaveLength(2)
    })
  })

  it("shows the meeting note line when the server says Send also updates the meeting's notes", async () => {
    mockServer({
      meetingNote: "Send also adds this pre-read to the meeting's internal notes in HubSpot.",
    })
    const { user } = renderPreRead()
    const dialog = await openDialog(user)
    expect(
      within(dialog).getByText(
        "Send also adds this pre-read to the meeting's internal notes in HubSpot.",
      ),
    ).toBeInTheDocument()
  })

  it('waits for a blank the rep just left to finish saving before requesting preview', async () => {
    const server = mockServer({ form: form({ going: null }), patchWaits: true })
    const { user } = renderPreRead()
    await screen.findByRole('heading', { level: 1, name: 'Office walk-through' })
    await user.type(screen.getByRole('textbox', { name: 'Who is going' }), 'Jo Sample')
    await user.click(screen.getByRole('button', { name: 'Check and send' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Send the pre-read?' })
    expect(within(dialog).getByText('Saving your part first.')).toBeInTheDocument()
    await waitFor(() => {
      expect(server.calls.some((call) => call.method === 'PATCH')).toBe(true)
    })
    expect(posts(server, PREVIEW)).toEqual([])

    server.release()
    await within(dialog).findByRole('region', { name: 'The email as it will arrive' })
    const order = server.calls.map((call) => `${call.method} ${call.path}`)
    expect(order.indexOf(`PATCH ${FORM}`)).toBeLessThan(order.indexOf(`POST ${PREVIEW}`))
  })
})

describe('Enter on the page (PLAN-V22 T3-4, choice 24)', () => {
  it('does Check and send, Send takes the focus once it can send, and Enter again sends', async () => {
    const server = mockServer()
    const { user } = renderPreRead()
    await screen.findByRole('heading', { level: 1, name: 'Office walk-through' })
    // On the page, not in a box and not on a button.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('alertdialog', { name: 'Send the pre-read?' })
    const send = await within(dialog).findByRole('button', { name: 'Send to 1 person' })
    await waitFor(() => {
      expect(send).toHaveFocus()
    })
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(posts(server, SEND)).toHaveLength(1)
    })
  })

  it('in a box Enter adds a line, and on a button it presses that button: no dialog', async () => {
    mockServer()
    const { user } = renderPreRead()
    const box = await screen.findByRole('textbox', { name: /Ideal next step/ })
    await user.click(box)
    await user.keyboard('{End}{Enter}')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    screen.getByRole('button', { name: 'Check and send' }).focus()
    // The button's own press: the dialog opens as it always did, with Cancel first.
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('alertdialog', { name: 'Send the pre-read?' })
    await within(dialog).findByRole('region', { name: 'The email as it will arrive' })
    expect(within(dialog).getByRole('button', { name: /^Send/ })).not.toHaveFocus()
  })
})

describe('on a phone', () => {
  it('keeps scroll padding above Check and send, and clears it once sent', async () => {
    asPhone()
    mockServer()
    const { user } = renderPreRead()
    const button = await screen.findByRole('button', { name: 'Check and send' })
    expect(button.closest('[data-slot=send-bar]')).toHaveClass('fixed', 'bottom-0')
    expect(document.documentElement.style.scrollPaddingBottom).toBe('7rem')

    await user.click(button)
    const dialog = await screen.findByRole('alertdialog', { name: 'Send the pre-read?' })
    await within(dialog).findByRole('region', { name: 'The email as it will arrive' })
    await user.click(within(dialog).getByRole('button', { name: 'Send to 1 person' }))
    await screen.findByText('Sent to Jo Sample on 26 Nov 2026 at 9:12 am, by Al Sample.')
    expect(screen.queryByRole('button', { name: 'Check and send' })).toBeNull()
    expect(document.documentElement.style.scrollPaddingBottom).toBe('')
  })
})

describe('sent, task retry, and send to more (V19 T2-4 & T2-5)', () => {
  it.each<[HubSpotCopy, string, boolean]>([
    [
      { state: 'saved', sentence: null },
      'A copy is saved in HubSpot, as a note on the company.',
      false,
    ],
    [
      { state: 'waiting', sentence: 'Waiting for HubSpot write access.' },
      'Waiting for HubSpot write access.',
      false,
    ],
    [
      { state: 'off', sentence: "This company isn't in HubSpot yet, so no copy was saved there." },
      "This company isn't in HubSpot yet, so no copy was saved there.",
      false,
    ],
    [
      { state: 'failed', sentence: null },
      "The copy in HubSpot didn't save. The email still went.",
      true,
    ],
  ])('says where the company copy in HubSpot stands: %o', async (copy, words, again) => {
    mockServer({ form: sent(copy) })
    renderPreRead()
    const line = await screen.findByText(words)
    expect(line.closest('[data-slot=hubspot-copy]')?.querySelector('svg')).not.toBeNull()
    if (again) {
      expect(screen.getByRole('button', { name: 'Try the HubSpot copy again' })).toBeEnabled()
    } else {
      expect(screen.queryByRole('button', { name: 'Try the HubSpot copy again' })).toBeNull()
    }
  })

  it('tries a failed company copy again without emailing anyone twice', async () => {
    const server = mockServer({
      form: sent({
        state: 'failed',
        sentence: "HubSpot didn't save the copy. The email won't go twice.",
      }),
    })
    const { user } = renderPreRead()
    const again = await screen.findByRole('button', { name: 'Try the HubSpot copy again' })
    await user.click(again)
    expect(
      await screen.findByText('A copy is saved in HubSpot, as a note on the company.'),
    ).toBeInTheDocument()
    expect(posts(server, SEND)).toEqual([{ owner_ids: ['o-2'], emails: [], email_them: false }])
  })

  it('shows per-person outcomes, retries a failed HubSpot task without emailing, and handles retry errors', async () => {
    const server = mockServer({
      retryTaskFails: true,
      form: form({
        status: 'sent',
        sent_at: '2026-11-17T03:00:00Z',
        sent_by: 'Al Sample',
        sent_to: [
          recipient({
            owner_id: 'o-2',
            name: 'Jo Sample',
            address: JO_ADDR,
            at: '2026-11-17T03:00:00Z',
            task: 'failed',
            email: true,
          }),
        ],
        hubspot_copy: { state: 'saved', sentence: null },
      }),
    })
    const { user } = renderPreRead()

    expect(
      await screen.findByText("Jo Sample's HubSpot task didn't go. The email still went."),
    ).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: 'Try again' })
    expect(retry).toHaveAccessibleDescription('Tries the task only. Nobody is emailed.')

    // First retry fails -> shows plain-English problem without clearing failure.
    await user.click(retry)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "The HubSpot task wasn't tried again. HubSpot isn't connected.",
    )

    // Retry succeeds -> updates recipient status to sent and removes failure banner.
    server.retryTaskFails = false
    await user.click(retry)
    await waitFor(() => {
      expect(
        screen.queryByText("Jo Sample's HubSpot task didn't go. The email still went."),
      ).toBeNull()
    })
    expect(posts(server, RETRY_TASKS)).toHaveLength(2)
    expect(posts(server, SEND)).toEqual([])
    expect(screen.getByText(/HubSpot task · Email · Got it 17 Nov/)).toBeInTheDocument()
  })

  it('Send to more people greys out people who already got it and sends only to new people', async () => {
    const server = mockServer({
      form: form({
        status: 'sent',
        sent_at: '2026-11-17T03:00:00Z',
        sent_by: 'Al Sample',
        sent_to: [
          recipient({
            owner_id: 'o-2',
            name: 'Jo Sample',
            at: '2026-11-17T03:00:00Z',
            task: 'sent',
            email: false,
          }),
        ],
        hubspot_copy: { state: 'saved', sentence: null },
      }),
    })
    const { user } = renderPreRead()

    const dialog = await openDialog(user, 'Send to more people')
    const joRow = person(dialog, 'Jo Sample')
    expect(joRow).toHaveAttribute('data-already', 'true')
    expect(within(joRow).getByRole('checkbox')).toBeDisabled()
    expect(within(joRow).getByRole('checkbox')).not.toBeChecked()
    expect(within(joRow).getByText(/Got it 17 Nov/)).toBeInTheDocument()

    // Nobody new ticked yet -> Send disabled.
    expect(within(dialog).getByRole('button', { name: 'Send' })).toBeDisabled()

    // Pick Al-khair ("You"): count says Send to 1 person, and sends only o-1.
    await user.click(within(person(dialog, 'Al-khair Sample')).getByRole('checkbox'))
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Send to 1 person' })).toBeEnabled()
    })
    await user.click(within(dialog).getByRole('button', { name: 'Send to 1 person' }))
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })
    expect(posts(server, SEND)).toEqual([{ owner_ids: ['o-1'], emails: [], email_them: false }])
    // SentNote now lists both recipients.
    expect(await screen.findByText(/Sent to Jo Sample and Al-khair Sample/)).toBeInTheDocument()
  })

  it('a draft again keeps who got it last, without Send to more people or task retry', async () => {
    mockServer({
      form: sent(
        { state: 'failed', sentence: "HubSpot didn't save the copy." },
        { status: 'draft' },
      ),
    })
    renderPreRead()
    expect(
      await screen.findByText('Last sent to Jo Sample on 26 Nov 2026 at 9:12 am, by Al Sample.'),
    ).toBeInTheDocument()
    expect(document.querySelector('[data-slot=hubspot-copy]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send to more people' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Check and send' })).toBeEnabled()
  })

  it('hides Check and send, Send to more people, and retry buttons for a Viewer', async () => {
    const viewerSignIn: SignIn = {
      state: 'signed_in',
      user: {
        ...SAMPLE_USER,
        role: 'viewer',
        position: null,
        apps: ['companies'],
        features: ['companies.meetings'],
      },
    }
    mockServer({
      form: form({
        status: 'sent',
        sent_at: '2026-11-17T03:00:00Z',
        sent_by: 'Al Sample',
        sent_to: [
          recipient({
            owner_id: 'o-2',
            name: 'Jo Sample',
            task: 'failed',
            email: true,
          }),
        ],
        hubspot_copy: { state: 'failed', sentence: null },
      }),
    })
    renderPreRead(viewerSignIn)
    await screen.findByText(/Jo Sample's HubSpot task didn't go/)
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try the HubSpot copy again' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send to more people' })).toBeNull()
  })
})
