/**
 * Admin, People: PLAN-V26 Part 2, against the generated contract and a fake server. Copy sign-in
 * details, the reset's switch, the username and Unlock. Made-up names only.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Person } from '@/api/hooks'
import { renderWithProviders } from '@/test/render'
import { asLaptop, asPhone } from '@/test/screen'
import AdminPeopleTab from './people'

const PASSWORD = 'amber cedar pine 42'
const ID = 'bbbbbbbb-2222-3333-4444-555555555555'

const JO: Person = {
  id: ID,
  name: 'Jo Sample',
  email: 'jo@example.test',
  username: 'jsample',
  position: null,
  role: 'staff',
  apps: ['companies'],
  features: ['companies.call_logs'],
  active: true,
  created_at: '2026-11-05T00:00:00Z',
  last_signed_in_at: null,
  hubspot_owner: null,
  hubspot: 'none',
}

interface Call {
  method: string
  path: string
  body: unknown
}

function serve(person: Person, taken = false): Call[] {
  const calls: Call[] = []
  let now = person
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1', '')
      const sent = request.method === 'GET' ? '' : await request.text()
      const body: unknown = sent === '' ? null : JSON.parse(sent)
      if (request.method !== 'GET') calls.push({ method: request.method, path, body })
      if (path === '/auth/me') {
        return Response.json({ auth_required: false, user: null, session: null })
      }
      if (path === '/hubspot/owners') return Response.json({ owners: [] })
      if (path === '/people') return Response.json([now])
      if (path === `/people/${ID}/password`) return Response.json({ starting_password: PASSWORD })
      if (path === `/people/${ID}/unlock`) {
        now = { ...now, lock: null }
        return Response.json(now)
      }
      if (path === `/people/${ID}` && request.method === 'PATCH') {
        if (taken) {
          return Response.json(
            {
              title: 'That username is taken',
              status: 409,
              detail: 'Someone else has this username. Pick another.',
              code: 'username_taken',
              errors: [
                { field: 'body.username', message: 'This username already has an account.' },
              ],
            },
            { status: 409 },
          )
        }
        now = { ...now, ...(body as Partial<Person>) }
        return Response.json(now)
      }
      return Response.json({ title: 'Not faked', status: 404 }, { status: 404 })
    }),
  )
  return calls
}

async function openJo() {
  const tools = renderWithProviders(<AdminPeopleTab />)
  await tools.user.click(await screen.findByRole('button', { name: 'Edit Jo Sample' }))
  return { ...tools, sheet: await screen.findByRole('dialog') }
}

async function reset(switchOff = false) {
  const opened = await openJo()
  await opened.user.click(within(opened.sheet).getByRole('button', { name: 'Reset password' }))
  const asked = await screen.findByRole('alertdialog')
  if (switchOff) await opened.user.click(within(asked).getByRole('switch'))
  await opened.user.click(within(asked).getByRole('button', { name: 'Reset password' }))
  await screen.findByText(PASSWORD)
  return opened
}

beforeEach(() => {
  asLaptop()
})

afterEach(() => {
  toast.dismiss()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Copy sign-in details', () => {
  it('copies the address, the username and the password, exactly', async () => {
    serve(JO)
    const { user, sheet } = await reset()
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    await user.click(within(sheet).getByRole('button', { name: 'Copy sign-in details' }))
    expect(write).toHaveBeenCalledWith(
      `Contour HQ: ${window.location.origin}\nUsername: jsample\nPassword: ${PASSWORD}`,
    )
  })

  it('copies the email when there is no username', async () => {
    serve({ ...JO, username: null })
    const { user, sheet } = await reset()
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    await user.click(within(sheet).getByRole('button', { name: 'Copy sign-in details' }))
    expect(write).toHaveBeenCalledWith(
      `Contour HQ: ${window.location.origin}\nUsername: jo@example.test\nPassword: ${PASSWORD}`,
    )
  })

  it('says Copied for 2 seconds', async () => {
    serve(JO)
    const { sheet } = await reset()
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    vi.useFakeTimers()
    const button = within(sheet).getByRole('button', { name: 'Copy sign-in details' })
    await act(async () => {
      button.click()
      await Promise.resolve()
    })
    expect(button).toHaveTextContent('Copied')
    act(() => {
      vi.advanceTimersByTime(1990)
    })
    expect(button).toHaveTextContent('Copied')
    act(() => {
      vi.advanceTimersByTime(20)
    })
    expect(button).toHaveTextContent('Copy sign-in details')
  })

  it('says so when copying fails, and never claims Copied', async () => {
    serve(JO)
    const { user, sheet } = await reset()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('blocked'))
    await user.click(within(sheet).getByRole('button', { name: 'Copy sign-in details' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent("Copying didn't work.")
    expect(within(sheet).queryByText('Copied')).not.toBeInTheDocument()
  })
})

describe('Sign them out everywhere', () => {
  it('is on by default', async () => {
    const calls = serve(JO)
    const { user, sheet } = await openJo()
    await user.click(within(sheet).getByRole('button', { name: 'Reset password' }))
    const asked = await screen.findByRole('alertdialog')
    expect(within(asked).getByRole('switch', { name: 'Sign them out everywhere' })).toBeChecked()
    expect(asked).toHaveTextContent('sign them out on every device')
    await user.click(within(asked).getByRole('button', { name: 'Reset password' }))
    await screen.findByText(PASSWORD)
    expect(calls).toContainEqual({
      method: 'POST',
      path: `/people/${ID}/password`,
      body: { sign_out: true },
    })
  })

  it('off sends it off', async () => {
    const calls = serve(JO)
    await reset(true)
    expect(calls).toContainEqual({
      method: 'POST',
      path: `/people/${ID}/password`,
      body: { sign_out: false },
    })
  })
})

describe('the username', () => {
  it('saves a change, and says to tell them', async () => {
    const calls = serve(JO)
    const { user, sheet } = await openJo()
    const field = within(sheet).getByLabelText('Username')
    expect(sheet).toHaveTextContent('Tell them if you change it')
    await user.clear(field)
    await user.type(field, 'jo.sample{Enter}')
    await waitFor(() => {
      expect(calls).toContainEqual({
        method: 'PATCH',
        path: `/people/${ID}`,
        body: { username: 'jo.sample' },
      })
    })
  })

  it('cleared sends none, so they use their email', async () => {
    const calls = serve(JO)
    const { user, sheet } = await openJo()
    await user.clear(within(sheet).getByLabelText('Username'))
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(calls).toContainEqual({
        method: 'PATCH',
        path: `/people/${ID}`,
        body: { username: null },
      })
    })
  })

  it('shows a taken name by the field', async () => {
    serve(JO, true)
    const { user, sheet } = await openJo()
    const field = within(sheet).getByLabelText('Username')
    await user.clear(field)
    await user.type(field, 'mia{Enter}')
    expect(
      await within(sheet).findByText('This username already has an account.'),
    ).toBeInTheDocument()
    expect(field).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('Unlock', () => {
  const locked: Person = {
    ...JO,
    lock: { until: '2026-11-23T04:40:00Z', wrong_tries: 10 }, // 3:40 pm in Melbourne
  }

  it.each([
    ['1440px', asLaptop],
    ['390px', asPhone],
  ])('the row says the lock, and Unlock clears it (%s)', async (_width, setWidth) => {
    setWidth()
    const calls = serve(locked)
    const { user } = renderWithProviders(<AdminPeopleTab />)
    expect(
      await screen.findByText(/^Locked until 3:40\spm after 10 wrong tries\.$/),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Unlock Jo Sample' }))
    await waitFor(() => {
      expect(screen.queryByText(/^Locked until/)).not.toBeInTheDocument()
    })
    expect(calls).toContainEqual({ method: 'POST', path: `/people/${ID}/unlock`, body: null })
  })

  it('shows nothing for someone who is not locked', async () => {
    serve(JO)
    renderWithProviders(<AdminPeopleTab />)
    await screen.findByText('Jo Sample')
    expect(screen.queryByRole('button', { name: /^Unlock/ })).not.toBeInTheDocument()
  })
})
