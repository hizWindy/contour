/**
 * Sending a pre-read (PLAN-V17 T3-11, "The screens" part 6), against Track 2's contract (generated)
 * and a fake server that answers as Track 2's does: the preview lists the Contour people
 * on the meeting, ticked, then the addresses the rep added, each saying whether it may get it; the
 * send refuses an address that isn't Contour's (422 `outside_address`, naming it); and a send on a
 * pre-read already sent and unchanged emails nobody and tries its copy in HubSpot again.
 *
 * Real time, not a fake clock: the status fades with motion (see pre-read.test.tsx). Made-up names
 * and addresses only.
 */
import { screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  FormEmailPreview,
  FormMeeting,
  FormPerson,
  FormSummary,
  HubSpotCopy,
  MeetingFormOut,
  MeetingFormPatch,
} from '@/api/types'
import { renderWithProviders } from '@/test/render'
import { asPhone } from '@/test/screen'
import PreReadPage from './index'

const FORM_ID = '0f3c9a2e-1111-2222-3333-444444444444'
const FORM = `/api/v1/companies/meetings/forms/${FORM_ID}`
const PREVIEW = `${FORM}/preview`
const SEND = `${FORM}/send`

const JO = 'jo.sample@contour.example'
const AL = 'al.sample@contour.example'
const OUTSIDE = 'mia@elsewhere.example'

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

/** A draft ready to send: both blanks filled. A typed meeting, so no HubSpot link is asked for. */
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

/** A pre-read sent by Al Sample, to Jo, with its copy in HubSpot where `copy` says. */
function sent(copy: HubSpotCopy, changes: Partial<MeetingFormOut> = {}): MeetingFormOut {
  return form({
    status: 'sent',
    sent_to: [{ name: 'Jo Sample', email: JO }],
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
  form: MeetingFormOut
  /** What the preview's `meeting_note` says, or nothing when Send won't touch the meeting. */
  meetingNote?: string | null
  /** The domain the server takes as Contour's. */
  domain: string
  /** How the send answers: as the server does, or one of its refusals. */
  send: 'ok' | 'not_set_up' | 'email_failed' | 'outside_once'
  /** The copy in HubSpot after a send of an unchanged, sent pre-read. */
  copyAfterRetry: HubSpotCopy
  /** PATCH waits for `release()`. */
  patchWaits: boolean
  /** The send waits for `release()`. */
  sendWaits: boolean
  /** The preview that answers 500, by its count (1 is the first), or none. */
  previewFails: number | null
  release: () => void
  calls: Call[]
}

function mockServer(changes: Partial<Omit<Server, 'calls' | 'release'>> = {}): Server {
  const server: Server = {
    form: form(),
    domain: 'contour.example',
    send: 'ok',
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
  const respond = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const { method } = request
    const text = method === 'GET' ? '' : await request.clone().text()
    const body: unknown = text ? JSON.parse(text) : null
    server.calls.push({ method, path: url.pathname, body })
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
      const added = (body as { to?: string[] }).to ?? []
      const people: FormPerson[] = [
        { name: 'Jo Sample', email: JO, why: 'on the meeting', ticked: true, allowed: allowed(JO) },
        ...added.map((address) => ({
          name: address === AL ? 'Al Sample' : null,
          email: address,
          why: 'added by you',
          ticked: true,
          allowed: allowed(address),
        })),
      ]
      const preview: FormEmailPreview = {
        subject: 'Pre-read: Sample Logistics Pty Ltd, Fri 27 Nov, 10:00 am',
        text: EMAIL_TEXT,
        html: '<h2>Pre-read for the meeting with Sample Logistics Pty Ltd</h2><script>alert(1)</script>',
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
      const to = (body as { to: string[] }).to
      if (server.form.status === 'sent') {
        server.form = { ...server.form, hubspot_copy: server.copyAfterRetry }
        return json(server.form)
      }
      if (server.send === 'not_set_up') {
        // Track 1's words (`meeting_send.py`), word for word.
        return problem(
          409,
          "Email isn't set up",
          "Email isn't set up yet, so nothing was sent. The pre-read stays here: copy it, or send it once email is set up.",
          'email_not_set_up',
        )
      }
      if (server.send === 'email_failed') {
        return problem(
          502,
          "The email didn't go",
          'Nothing was sent. Try again in a minute.',
          'email_failed',
        )
      }
      if (server.send === 'outside_once' && !refused) {
        // Contour's list changed between the preview and the send: Jo's address is refused now.
        refused = true
        server.domain = 'contourinteriors.example'
      }
      const outside = to.filter((address) => !allowed(address))
      if (outside.length > 0) {
        return problem(
          422,
          'Only Contour addresses',
          `A pre-read goes to Contour addresses only, so nothing was sent. Take out: ${outside.join(', ')}.`,
          'outside_address',
        )
      }
      server.form = {
        ...server.form,
        status: 'sent',
        sent_to: to.map((email) => ({ email, name: email === JO ? 'Jo Sample' : null })),
        sent_at: '2026-11-25T22:12:00Z',
        sent_by: 'Al Sample',
        hubspot_copy: { state: 'waiting', sentence: 'Waiting for HubSpot write access.' },
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

function renderPreRead() {
  const router = createMemoryRouter(
    [
      { path: '/companies/meetings', element: <h1>Client meetings</h1> },
      { path: '/companies/meetings/:formId', element: <PreReadPage /> },
      { path: '/companies/:key', element: <h1>Company</h1> },
    ],
    { initialEntries: [`/companies/meetings/${FORM_ID}`] },
  )
  return renderWithProviders(<RouterProvider router={router} />, { withRouter: false })
}

function status(): HTMLElement {
  const found = document.querySelector('[data-slot=pre-read-status]')
  if (!(found instanceof HTMLElement)) throw new Error('No status')
  return found
}

/** One person's row in the dialog, found by its name or address. */
function person(dialog: HTMLElement, name: string): HTMLElement {
  const row = within(dialog).getByText(name).closest('[data-slot=send-person]')
  if (!(row instanceof HTMLElement)) throw new Error(`No row for ${name}`)
  return row
}

async function openDialog(user: ReturnType<typeof renderPreRead>['user']): Promise<HTMLElement> {
  await screen.findByRole('heading', { level: 1, name: 'Office walk-through' })
  await user.click(screen.getByRole('button', { name: 'Check and send' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Send the pre-read?' })
  // The email comes with the preview.
  await within(dialog).findByRole('region', { name: 'The email as it will arrive' })
  return dialog
}

afterEach(() => {
  toast.dismiss()
})

describe('Check and send', () => {
  it('shows the email as it will arrive and who gets it, then sends to the ticked people', async () => {
    const server = mockServer()
    const { user } = renderPreRead()
    const dialog = await openDialog(user)

    // The preview was asked for once, with no address added.
    expect(posts(server, PREVIEW)).toEqual([{ to: [] }])
    // The subject and the plain text, in a box that scrolls and takes the keyboard's focus.
    const email = within(dialog).getByRole('region', { name: 'The email as it will arrive' })
    expect(email).toHaveAttribute('tabindex', '0')
    expect(
      within(email).getByText('Pre-read: Sample Logistics Pty Ltd, Fri 27 Nov, 10:00 am'),
    ).toBeInTheDocument()
    expect(email).toHaveTextContent('Staff: About 300')
    // Never the server's HTML.
    expect(email.innerHTML).not.toContain('<h2>')
    expect(document.querySelector('script')).toBeNull()
    // Only the middle scrolls: the title and the buttons stay in view. The email box hands the
    // wheel on at its end, so it never traps the scroll.
    const middle = dialog.querySelector('[data-slot=send-dialog-body]')
    expect(middle).toHaveClass('overflow-y-auto', 'min-h-0')
    expect(middle).toContainElement(email)
    expect(middle).not.toContainElement(within(dialog).getByRole('heading', { level: 2 }))
    expect(middle).not.toContainElement(
      within(dialog).getByRole('button', { name: 'Send to 1 person' }),
    )
    expect(middle).not.toContainElement(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(email).not.toHaveClass('overscroll-contain')

    // Jo is on the meeting, ticked, with why.
    const jo = within(person(dialog, 'Jo Sample'))
    expect(jo.getByRole('checkbox', { name: 'Jo Sample' })).toBeChecked()
    expect(jo.getByText(`${JO} · on the meeting`)).toBeInTheDocument()
    // No line about the meeting's notes in HubSpot until the server sends one.
    expect(within(dialog).queryByText(/internal notes/)).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: 'Send to 1 person' }))
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })
    expect(posts(server, SEND)).toEqual([{ to: [JO] }])

    // Sent: the status turns to Sent with its tick drawn, and the page says who got it and when.
    await waitFor(() => {
      expect(within(status()).getByText('Sent')).toBeInTheDocument()
    })
    expect(status().querySelector('[data-slot=tick-in]')).not.toBeNull()
    const note = screen.getByText('Sent to Jo Sample on 26 Nov 2026 at 9:12 am, by Al Sample.')
    // The button that opened the dialog has gone, so the focus goes to who got it.
    await waitFor(() => {
      expect(note.closest('[data-slot=sent-note]')).toHaveFocus()
    })
    // Sent and unchanged: nothing to send, so no Check and send.
    expect(screen.queryByRole('button', { name: 'Check and send' })).toBeNull()
  })

  it('adds an address, and says before sending that one which is not Contour cannot get it', async () => {
    const server = mockServer()
    const { user } = renderPreRead()
    const dialog = await openDialog(user)
    const box = within(dialog).getByRole('textbox', { name: 'Add someone' })

    // Outlook's way of writing it is read too.
    await user.type(box, `Mia <${OUTSIDE}>; Al Sample <${AL.toUpperCase()}>`)
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => {
      expect(posts(server, PREVIEW).at(-1)).toEqual({ to: [OUTSIDE, AL] })
    })
    expect(box).toHaveValue('')

    // The address that isn't Contour's can't be ticked, and says why beside it.
    const mia = within(await waitFor(() => person(dialog, OUTSIDE)))
    expect(mia.getByRole('checkbox', { name: OUTSIDE })).not.toBeChecked()
    expect(mia.getByRole('checkbox', { name: OUTSIDE })).toBeDisabled()
    expect(
      mia.getByText("Not a Contour address, so it can't get the pre-read."),
    ).toBeInTheDocument()
    expect(mia.getByRole('checkbox', { name: OUTSIDE })).toHaveAccessibleDescription(
      "Added by you Not a Contour address, so it can't get the pre-read.",
    )
    // Al is Contour's, and ticked.
    expect(within(person(dialog, 'Al Sample')).getByRole('checkbox')).toBeChecked()

    // The same address again is already there; something that isn't one says so.
    await user.type(box, AL)
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Already on the list.')
    await user.clear(box)
    await user.type(box, 'jo at contour')
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      "That doesn't look like an email address.",
    )

    // Take Jo off: only Al gets it. The refused address never goes.
    await user.click(within(person(dialog, 'Jo Sample')).getByRole('checkbox'))
    await user.click(within(dialog).getByRole('button', { name: 'Send to 1 person' }))
    await waitFor(() => {
      expect(posts(server, SEND)).toEqual([{ to: [AL] }])
    })
  })

  it('an address the rep added can be taken out again', async () => {
    const server = mockServer()
    const { user } = renderPreRead()
    const dialog = await openDialog(user)
    await user.type(within(dialog).getByRole('textbox', { name: 'Add someone' }), AL)
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))
    expect(
      await within(dialog).findByRole('button', { name: 'Send to 2 people' }),
    ).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: `Remove ${AL}` }))
    // Gone at once, before the server answers.
    expect(within(dialog).queryByText('Al Sample')).toBeNull()
    await waitFor(() => {
      expect(posts(server, PREVIEW).at(-1)).toEqual({ to: [] })
    })
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Send to 1 person' })).toBeEnabled()
    })
  })

  it('an added address whose check failed stays, says so, and is checked again with Try again', async () => {
    const server = mockServer({ previewFails: 2 })
    const { user } = renderPreRead()
    const dialog = await openDialog(user)
    await user.type(within(dialog).getByRole('textbox', { name: 'Add someone' }), AL)
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))

    expect(
      await within(dialog).findByText('Not checked yet. It gets nothing until it is.'),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Something went wrong on our side.')
    // It isn't counted until the server has said it is Contour's.
    expect(within(dialog).getByRole('button', { name: 'Send to 1 person' })).toBeEnabled()

    await user.click(within(dialog).getByRole('button', { name: 'Try again' }))
    expect(
      await within(dialog).findByRole('button', { name: 'Send to 2 people' }),
    ).toBeInTheDocument()
    expect(posts(server, PREVIEW)).toEqual([{ to: [] }, { to: [AL] }, { to: [AL] }])
    expect(within(dialog).queryByRole('alert')).toBeNull()
  })

  it('an address refused when it is sent: plain words beside the people, naming it, and nothing sent', async () => {
    const server = mockServer({ send: 'outside_once' })
    const { user } = renderPreRead()
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Send to 1 person' }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent(
      `Only Contour addresses. A pre-read goes to Contour addresses only, so nothing was sent. Take out: ${JO}.`,
    )
    // The preview is asked for again, and Jo's row now says so too; the dialog stays open.
    await waitFor(() => {
      expect(posts(server, PREVIEW)).toHaveLength(2)
    })
    expect(
      await within(person(dialog, 'Jo Sample')).findByText(
        "Not a Contour address, so it can't get the pre-read.",
      ),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Send' })).toHaveAccessibleDescription(
      'Tick someone to send it to, or add a Contour address.',
    )
    // Nothing went: the pre-read is still a draft.
    expect(within(status()).getByText('Draft ready')).toBeInTheDocument()
    expect(screen.queryByText(/^Sent to/)).toBeNull()
  })

  it('with no email set up: says nothing was sent, the pre-read stays here, and Copy copies it', async () => {
    mockServer({ send: 'not_set_up' })
    const { user } = renderPreRead()
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Send to 1 person' }))
    // The server's words alone: they start with the title and end with what still works, so
    // nothing is said twice.
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      "Email isn't set up yet, so nothing was sent. The pre-read stays here: copy it, or send it once email is set up.",
    )
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(within(status()).getByText('Draft ready')).toBeInTheDocument()
    // PLAN-V18 T2-7: the email as it would have gone, to paste into the rep's own.
    await user.click(within(dialog).getByRole('button', { name: 'Copy the pre-read' }))
    expect(
      await within(dialog).findByText('Copied. Paste it into an email to the team.'),
    ).toBeInTheDocument()
    const copied = await navigator.clipboard.readText()
    expect(copied.startsWith('Pre-read:')).toBe(true)
  })

  it('can not be stopped or changed while it sends: Cancel, Esc, the ticks and Add wait', async () => {
    const server = mockServer({ sendWaits: true })
    const { user } = renderPreRead()
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Send to 1 person' }))
    await waitFor(() => {
      expect(posts(server, SEND)).toHaveLength(1)
    })

    // On its way: nothing stops it, and who gets it can't change.
    expect(within(dialog).getByRole('button', { name: 'Sending.' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(within(person(dialog, 'Jo Sample')).getByRole('checkbox')).toBeDisabled()
    expect(within(dialog).getByRole('textbox', { name: 'Add someone' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Add' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog', { name: 'Send the pre-read?' })).toBeInTheDocument()

    // The server answers: it went, and only then the dialog closes.
    server.release()
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })
    expect(
      await screen.findByText('Sent to Jo Sample on 26 Nov 2026 at 9:12 am, by Al Sample.'),
    ).toBeInTheDocument()
    expect(posts(server, SEND)).toEqual([{ to: [JO] }])
  })

  it('an email that did not go says so in plain words, and Send can be pressed again', async () => {
    const server = mockServer({ send: 'email_failed' })
    const { user } = renderPreRead()
    const dialog = await openDialog(user)
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView')
    await user.click(within(dialog).getByRole('button', { name: 'Send to 1 person' }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent("The email didn't go. Nothing was sent. Try again in a minute.")
    // Under the people, which may be scrolled away from Send: it is brought into view.
    await waitFor(() => {
      expect(scrolled.mock.contexts.some((one) => (one as Element).contains(alert))).toBe(true)
    })
    await user.click(within(dialog).getByRole('button', { name: 'Send to 1 person' }))
    await waitFor(() => {
      expect(posts(server, SEND)).toHaveLength(2)
    })
  })

  it("says when Send also adds the pre-read to the meeting's notes in HubSpot, in one line", async () => {
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

  it('says nothing about the meeting when the server says Send will not touch it', async () => {
    mockServer({ meetingNote: null })
    const { user } = renderPreRead()
    const dialog = await openDialog(user)
    expect(within(dialog).queryByText(/internal notes/)).toBeNull()
  })

  it('waits for a blank the rep has just left to be saved, so the email holds it', async () => {
    const server = mockServer({ form: form({ going: null }), patchWaits: true })
    const { user } = renderPreRead()
    await screen.findByRole('heading', { level: 1, name: 'Office walk-through' })
    await user.type(screen.getByRole('textbox', { name: 'Who is going' }), 'Jo Sample')
    // Straight from the blank to the button: the blank's save is still on its way.
    await user.click(screen.getByRole('button', { name: 'Check and send' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Send the pre-read?' })
    expect(within(dialog).getByText('Saving your part first.')).toBeInTheDocument()
    await waitFor(() => {
      expect(server.calls.some((call) => call.method === 'PATCH')).toBe(true)
    })
    expect(posts(server, PREVIEW)).toEqual([])

    server.release()
    await within(dialog).findByRole('region', { name: 'The email as it will arrive' })
    expect(posts(server, PREVIEW)).toEqual([{ to: [] }])
    // The save went before the preview was asked for.
    const order = server.calls.map((call) => `${call.method} ${call.path}`)
    expect(order.indexOf(`PATCH ${FORM}`)).toBeLessThan(order.indexOf(`POST ${PREVIEW}`))
  })
})

describe('on a phone', () => {
  it('keeps what the keyboard lands on above Check and send, and no room once it is sent', async () => {
    asPhone()
    mockServer()
    const { user } = renderPreRead()
    const button = await screen.findByRole('button', { name: 'Check and send' })
    expect(button.closest('[data-slot=send-bar]')).toHaveClass('fixed', 'bottom-0')
    // WCAG 2.4.11: the page's scroller keeps room for the bar.
    expect(document.documentElement.style.scrollPaddingBottom).toBe('7rem')

    await user.click(button)
    const dialog = await screen.findByRole('alertdialog', { name: 'Send the pre-read?' })
    await within(dialog).findByRole('region', { name: 'The email as it will arrive' })
    await user.click(within(dialog).getByRole('button', { name: 'Send to 1 person' }))
    await screen.findByText('Sent to Jo Sample on 26 Nov 2026 at 9:12 am, by Al Sample.')
    // Sent and unchanged: no bar, so no room for one.
    expect(screen.queryByRole('button', { name: 'Check and send' })).toBeNull()
    expect(document.documentElement.style.scrollPaddingBottom).toBe('')
  })
})

describe('sent', () => {
  it.each<[HubSpotCopy, string, boolean]>([
    [
      { state: 'saved', sentence: null },
      'A copy is saved in HubSpot, as a note on the company.',
      false,
    ],
    // Waiting for write access, trying again can't work: the line says so, with no button.
    [
      { state: 'waiting', sentence: null },
      'The copy waits for HubSpot write access. The email still went.',
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
  ])('says where the copy in HubSpot stands: %o', async (copy, words, again) => {
    mockServer({ form: sent(copy) })
    renderPreRead()
    const line = await screen.findByText(words)
    expect(line.closest('[data-slot=hubspot-copy]')?.querySelector('svg')).not.toBeNull()
    // A pre-read that was sent before the page opened: the still icon, no tick drawn.
    expect(status().querySelector('[data-slot=tick-in]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Check and send' })).toBeNull()
    if (again) {
      expect(screen.getByRole('button', { name: 'Try the HubSpot copy again' })).toBeEnabled()
    } else {
      expect(screen.queryByRole('button', { name: 'Try the HubSpot copy again' })).toBeNull()
    }
  })

  it('tries a copy that failed again, to the same people, and says nobody is emailed again', async () => {
    const server = mockServer({
      form: sent({
        state: 'failed',
        sentence: "HubSpot didn't save the copy. The email won't go twice.",
      }),
    })
    const { user } = renderPreRead()
    const again = await screen.findByRole('button', { name: 'Try the HubSpot copy again' })
    expect(again).toHaveAccessibleDescription('Nobody is emailed again.')
    await user.click(again)
    expect(
      await screen.findByText('A copy is saved in HubSpot, as a note on the company.'),
    ).toBeInTheDocument()
    expect(posts(server, SEND)).toEqual([{ to: [JO] }])
    expect(screen.queryByRole('button', { name: 'Try the HubSpot copy again' })).toBeNull()
    // Still the same send: who got it and when are as before.
    expect(
      screen.getByText('Sent to Jo Sample on 26 Nov 2026 at 9:12 am, by Al Sample.'),
    ).toBeInTheDocument()
  })

  it('a draft again keeps who got it last, but not the copy line or its Try again', async () => {
    // Changed after it went: the server keeps the last send's copy, which failed.
    mockServer({
      form: sent(
        { state: 'failed', sentence: "HubSpot didn't save the copy. The email won't go twice." },
        { status: 'draft' },
      ),
    })
    renderPreRead()
    expect(
      await screen.findByText('Last sent to Jo Sample on 26 Nov 2026 at 9:12 am, by Al Sample.'),
    ).toBeInTheDocument()
    expect(document.querySelector('[data-slot=hubspot-copy]')).toBeNull()
    expect(screen.queryByText(/HubSpot didn't save the copy/)).toBeNull()
    // On a draft, Send emails the new words: a retry that emails nobody isn't offered.
    expect(screen.queryByRole('button', { name: 'Try the HubSpot copy again' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Check and send' })).toBeEnabled()
  })

  it('after an edit it is a draft again, and Check and send comes back', async () => {
    mockServer({ form: sent({ state: 'saved', sentence: null }) })
    const { user } = renderPreRead()
    await screen.findByText(/^Sent to Jo Sample/)
    expect(screen.queryByRole('button', { name: 'Check and send' })).toBeNull()
    await user.type(screen.getByRole('textbox', { name: 'Ideal next step' }), ' Bring the plans.')
    await user.tab()
    expect(await screen.findByRole('button', { name: 'Check and send' })).toBeEnabled()
    expect(screen.getByText(/^Last sent to Jo Sample/)).toBeInTheDocument()
  })
})
