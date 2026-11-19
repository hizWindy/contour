/**
 * Admin, People: each person's HubSpot user (PLAN-V17 T3-7, PLAN-V23 T3-4), against the generated
 * contract and a fake server. The table says it, an older account shows "Not set", the change
 * takes "No HubSpot user" too, and Add person needs one choice, with the closest name suggested.
 * At a laptop's width (1440px) and a phone's (390px). Made-up names only. The project ticks and
 * the roles are tried in plan-v9.test.tsx and roles.test.tsx.
 */
import { screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HubSpotOwnerLink } from '@/api/types'
import { renderWithProviders } from '@/test/render'
import { asLaptop, asPhone } from '@/test/screen'
import { closestOwner, nameLikeness } from './hubspot-choice'
import AdminPeopleTab from './people'

interface Row {
  id: string
  name: string
  email: string
  username: string | null
  position: string | null
  role: string
  apps: string[]
  features: string[]
  active: boolean
  created_at: string
  last_signed_in_at: string | null
  hubspot_owner?: HubSpotOwnerLink | null
  hubspot?: 'linked' | 'none' | 'not_set'
}

const MIA: Row = {
  id: 'aaaaaaaa-2222-3333-4444-555555555555',
  name: 'Mia Sample',
  email: 'mia@example.test',
  username: 'mia',
  position: null,
  role: 'admin',
  apps: [],
  features: [],
  active: true,
  created_at: '2026-11-05T00:00:00Z',
  last_signed_in_at: '2026-11-14T00:00:00Z',
  hubspot_owner: { id: '301', name: 'Mia Sample', matched_by: 'email' },
  hubspot: 'linked',
}
const JO: Row = {
  ...MIA,
  id: 'bbbbbbbb-2222-3333-4444-555555555555',
  name: 'Jo Sample',
  email: 'jo@example.test',
  username: null,
  role: 'staff',
  apps: ['companies'],
  features: ['companies.call_logs'],
  hubspot_owner: { id: '302', name: 'Sam Sample', matched_by: 'person' },
}
/** An account from before PLAN-V23: nobody has picked. */
const ALEX: Row = {
  ...JO,
  id: 'cccccccc-2222-3333-4444-555555555555',
  name: 'Alex Sample',
  email: 'alex@example.test',
  hubspot_owner: null,
  hubspot: 'not_set',
}
/** A designer with no HubSpot login. */
const KIM: Row = {
  ...JO,
  id: 'dddddddd-2222-3333-4444-555555555555',
  name: 'Kim Sample',
  email: 'kim@example.test',
  position: 'Designer',
  hubspot_owner: null,
  hubspot: 'none',
}

/*
  HubSpot's users, as GET /hubspot/owners gives them: ids and names. One carries an email it
  shouldn't, to prove the page never shows one.
*/
const OWNERS = [
  { id: '301', name: 'Mia Sample' },
  { id: '302', name: 'Sam Sample' },
  { id: '303', name: 'Levi Example', email: 'levi@owners.example' },
  { id: '304', name: 'Alexandra Sample' },
  { id: '305', name: 'Joanne Example' },
]

interface Server {
  people: Row[]
  owners: 'fail' | typeof OWNERS
  puts: Array<{ id: string; body: unknown }>
  posts: unknown[]
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status })
}

function stubServer(changes: Partial<Omit<Server, 'puts' | 'posts'>> = {}): Server {
  const server: Server = {
    people: [MIA, JO, ALEX, KIM],
    owners: OWNERS,
    puts: [],
    posts: [],
    ...changes,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname
      if (path === '/api/v1/auth/me') {
        return json({ auth_required: false, user: null, session: null })
      }
      if (path === '/api/v1/people' && request.method === 'GET') return json(server.people)
      if (path === '/api/v1/people' && request.method === 'POST') {
        const body = (await request.json()) as { name: string; email: string }
        server.posts.push(body)
        return json(
          { ...ALEX, id: 'eeeeeeee-2222-3333-4444-555555555555', ...body, starting_password: 'x' },
          201,
        )
      }
      if (path === '/api/v1/hubspot/owners') {
        return server.owners === 'fail'
          ? json({ title: 'Something went wrong', status: 500, detail: 'Try again.' }, 500)
          : json({ owners: server.owners })
      }
      const put = /^\/api\/v1\/people\/([^/]+)\/hubspot-owner$/.exec(path)
      if (put && request.method === 'PUT') {
        const id = put[1] ?? ''
        const body = (await request.json()) as {
          owner_id: string | null
          no_hubspot_user?: boolean
        }
        server.puts.push({ id, body })
        const owner = OWNERS.find((item) => item.id === body.owner_id)
        server.people = server.people.map((person) =>
          person.id === id
            ? {
                ...person,
                hubspot_owner: owner
                  ? { id: owner.id, name: owner.name, matched_by: 'person' }
                  : null,
                hubspot: owner ? 'linked' : body.no_hubspot_user ? 'none' : 'not_set',
              }
            : person,
        )
        return json(server.people.find((person) => person.id === id))
      }
      return json({ title: 'Not found', status: 404 }, 404)
    }),
  )
  return server
}

async function openEdit(name: string) {
  const view = renderWithProviders(<AdminPeopleTab />)
  await screen.findByRole('table', { name: 'People' })
  await view.user.click(screen.getByRole('button', { name: `Edit ${name}` }))
  const sheet = await screen.findByRole('dialog', { name })
  return { ...view, sheet: within(sheet) }
}

async function openAdd() {
  const view = renderWithProviders(<AdminPeopleTab />, { userEventOptions: { delay: null } })
  await screen.findByRole('table', { name: 'People' })
  await view.user.click(screen.getByRole('button', { name: 'Add a person' }))
  const sheet = await screen.findByRole('dialog', { name: 'Add a person' })
  return { ...view, sheet: within(sheet) }
}

/** The "No HubSpot user" row of the open list: its name has its hint too. */
const NO_USER_OPTION = /^No HubSpot user/

afterEach(() => {
  toast.dismiss()
})

describe.each([
  ['a laptop (1440px)', asLaptop],
  ['a phone (390px)', asPhone],
])("each person's HubSpot user (PLAN-V23 T3-4), on %s", (_width, size) => {
  it('shows in the table: the user and how it was found, "No HubSpot user" or "Not set"', async () => {
    size()
    stubServer()
    renderWithProviders(<AdminPeopleTab />)
    const table = await screen.findByRole('table', { name: 'People' })
    expect(within(table).getByRole('columnheader', { name: 'HubSpot user' })).toBeInTheDocument()
    const [mia, jo, alex, kim] = within(table).getAllByRole('row').slice(1)
    expect(mia).toHaveTextContent('Mia SampleMatched by email')
    expect(jo).toHaveTextContent('Sam SampleSet by hand')
    expect(alex).toHaveTextContent('Not set')
    expect(kim).toHaveTextContent('No HubSpot user')
  })

  it('an older account shows "Not set", with the closest name to use in one press', async () => {
    size()
    const server = stubServer()
    const { user, sheet } = await openEdit('Alex Sample')
    const field = sheet.getByRole('combobox', { name: 'HubSpot user' })
    expect(field).toHaveTextContent('Not set')
    expect(field).toHaveAccessibleDescription(
      'Not set yet. Pick their HubSpot user, or No HubSpot user.',
    )
    expect(await sheet.findByText('Closest name in HubSpot: Alexandra Sample.')).toBeInTheDocument()
    await user.click(sheet.getByRole('button', { name: 'Use Alexandra Sample' }))
    await waitFor(() => {
      expect(server.puts).toEqual([{ id: ALEX.id, body: { owner_id: '304' } }])
    })
    expect(
      await screen.findByText("Alex Sample's HubSpot user is Alexandra Sample now."),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(sheet.getByRole('combobox', { name: 'HubSpot user' })).toHaveTextContent(
        'Alexandra Sample',
      )
    })
    expect(sheet.queryByText(/Closest name in HubSpot/)).toBeNull()
  })

  it('takes "No HubSpot user", which says what it means', async () => {
    size()
    const server = stubServer()
    const { user, sheet } = await openEdit('Jo Sample')
    await user.click(sheet.getByRole('combobox', { name: 'HubSpot user' }))
    await user.click(await screen.findByRole('option', { name: NO_USER_OPTION }))
    await waitFor(() => {
      expect(server.puts).toEqual([{ id: JO.id, body: { owner_id: null, no_hubspot_user: true } }])
    })
    expect(await screen.findByText('Jo Sample has no HubSpot user now.')).toBeInTheDocument()
    await waitFor(() => {
      expect(sheet.getByRole('combobox', { name: 'HubSpot user' })).toHaveTextContent(
        'No HubSpot user',
      )
    })
    expect(sheet.getByRole('combobox', { name: 'HubSpot user' })).toHaveAccessibleDescription(
      'Their calls go to HubSpot with no owner, signed with their name. They get no HubSpot tasks.',
    )
  })
})

describe("each person's HubSpot user, the list", () => {
  it('filters as you type, saves at once, and never shows an email', async () => {
    const server = stubServer()
    const { user, sheet } = await openEdit('Jo Sample')
    const field = sheet.getByRole('combobox', { name: 'HubSpot user' })
    expect(field).toHaveTextContent('Sam Sample')
    expect(field).toHaveAccessibleDescription(
      'Set by hand. Their calls and tasks land under this user in HubSpot.',
    )

    await user.click(field)
    const find = await screen.findByRole('combobox', { name: 'Find their HubSpot user' })
    expect(await screen.findByRole('option', { name: 'Levi Example' })).toBeInTheDocument()
    // "No HubSpot user" comes first.
    expect(screen.getAllByRole('option')[0]).toHaveTextContent(
      'No HubSpot userFor someone with no HubSpot login',
    )
    await user.type(find, 'levi')
    expect(screen.queryByRole('option', { name: /Sam Sample/ })).toBeNull()
    await user.click(screen.getByRole('option', { name: 'Levi Example' }))

    await waitFor(() => {
      expect(server.puts).toEqual([{ id: JO.id, body: { owner_id: '303' } }])
    })
    expect(
      await screen.findByText("Jo Sample's HubSpot user is Levi Example now."),
    ).toBeInTheDocument()
    expect(screen.queryByText(/owners\.example/)).toBeNull()
  })

  it('says who a user is linked to already, and puts the closest name first', async () => {
    stubServer()
    const { user, sheet } = await openEdit('Alex Sample')
    await user.click(sheet.getByRole('combobox', { name: 'HubSpot user' }))
    await screen.findByRole('option', { name: /Levi Example/ })
    const names = screen.getAllByRole('option').map((option) => option.textContent)
    expect(names[1]).toBe('Alexandra SampleClosest to the name')
    expect(screen.getByRole('option', { name: /Sam Sample/ })).toHaveTextContent(
      'Sam SampleLinked to Jo Sample',
    )
  })

  it('a list that fails says so, offers Try again, and still offers "No HubSpot user"', async () => {
    const server = stubServer({ owners: 'fail' })
    const { user, sheet } = await openEdit('Jo Sample')
    await user.click(sheet.getByRole('combobox', { name: 'HubSpot user' }))
    expect(await screen.findByText("The HubSpot users couldn't be loaded.")).toBeInTheDocument()
    expect(screen.getByRole('option', { name: NO_USER_OPTION })).toBeInTheDocument()

    server.owners = OWNERS
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('option', { name: 'Levi Example' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    // The role and the feature ticks never waited for the users.
    expect(sheet.getByRole('combobox', { name: 'Role' })).toBeEnabled()
    expect(sheet.getByRole('checkbox', { name: 'Companies' })).toBeEnabled()
  })

  it('an empty list says so, and "No HubSpot user" is still there', async () => {
    stubServer({ owners: [] })
    const { user, sheet } = await openEdit('Alex Sample')
    await user.click(sheet.getByRole('combobox', { name: 'HubSpot user' }))
    expect(await screen.findByText('No HubSpot users to pick from yet.')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: NO_USER_OPTION })).toBeInTheDocument()
  })
})

describe.each([
  ['a laptop (1440px)', asLaptop],
  ['a phone (390px)', asPhone],
])('Add person needs a HubSpot user (PLAN-V23 choice 12), on %s', (_width, size) => {
  it('asks for one, suggests the closest name, and sends it', async () => {
    size()
    const server = stubServer()
    const { user, sheet } = await openAdd()
    await user.type(sheet.getByLabelText('Name'), 'Jo Example')
    await user.type(sheet.getByLabelText('Email'), 'jo.example@example.test')
    const field = sheet.getByRole('combobox', { name: 'HubSpot user' })
    expect(field).toHaveTextContent('Pick their HubSpot user')

    await user.click(sheet.getByRole('button', { name: 'Add the person' }))
    expect(await sheet.findByText('Pick their HubSpot user, or No HubSpot user.')).toBeVisible()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(server.posts).toEqual([])

    // "Jo" starts "Joanne": the closest name, offered and not picked.
    expect(sheet.getByText('Closest name in HubSpot: Joanne Example.')).toBeInTheDocument()
    await user.click(sheet.getByRole('button', { name: 'Use Joanne Example' }))
    expect(field).toHaveTextContent('Joanne Example')
    expect(sheet.queryByText('Pick their HubSpot user, or No HubSpot user.')).toBeNull()

    await user.click(sheet.getByRole('button', { name: 'Add the person' }))
    await waitFor(() => {
      expect(server.posts).toHaveLength(1)
    })
    expect(server.posts[0]).toMatchObject({
      name: 'Jo Example',
      hubspot_owner_id: '305',
      no_hubspot_user: false,
    })
  })

  it('"No HubSpot user" starts on the Call logs tick only (choice 13)', async () => {
    size()
    const server = stubServer()
    const { user, sheet } = await openAdd()
    await user.type(sheet.getByLabelText('Name'), 'Kai Example')
    await user.type(sheet.getByLabelText('Email'), 'kai@example.test')
    expect(sheet.getByRole('checkbox', { name: 'Start a run' })).toBeChecked()

    await user.click(sheet.getByRole('combobox', { name: 'HubSpot user' }))
    await user.click(await screen.findByRole('option', { name: NO_USER_OPTION }))
    expect(sheet.getByRole('combobox', { name: 'HubSpot user' })).toHaveAccessibleDescription(
      'Their calls go to HubSpot with no owner, signed with their name. They get no HubSpot tasks. They start with the Call logs tick. Tick Meetings if they write pre-reads.',
    )
    const ticked = sheet
      .getAllByRole('checkbox')
      .filter((box) => box.getAttribute('data-state') === 'checked')
      .map((box) => box.closest('label')?.textContent)
    expect(ticked).toEqual(['Call logs'])
    await user.click(sheet.getByRole('checkbox', { name: 'Meetings' }))

    await user.click(sheet.getByRole('button', { name: 'Add the person' }))
    await waitFor(() => {
      expect(server.posts).toHaveLength(1)
    })
    expect(server.posts[0]).toMatchObject({
      no_hubspot_user: true,
      features: ['companies.call_logs', 'companies.meetings'],
    })
    expect(server.posts[0]).not.toHaveProperty('hubspot_owner_id')
  })
})

describe('the closest name', () => {
  const owners = OWNERS.map(({ id, name }) => ({ id, name }))

  it('wants the first names to agree, then the most letter pairs in common', () => {
    expect(closestOwner('Mia Sample', owners)?.id).toBe('301')
    expect(closestOwner('Jo Example', owners)?.id).toBe('305')
    expect(closestOwner('alexandra  sample', owners)?.id).toBe('304')
    // The same surname, another first name: not suggested.
    expect(closestOwner('Ben Sample', owners)).toBeNull()
    expect(closestOwner('', owners)).toBeNull()
  })

  it('skips a user linked to someone else already', () => {
    expect(closestOwner('Mia Sample', owners, new Set(['301']))).toBeNull()
  })

  it('reads accents, hyphens and capitals as the same name', () => {
    expect(closestOwner('ana-lee sample', [{ id: '9', name: 'Ana-Lee M. Sample' }])?.id).toBe('9')
    expect(nameLikeness('zoe', 'zoe')).toBe(1)
    expect(closestOwner('Zoë Sample', [{ id: '7', name: 'Zoe Sample' }])?.id).toBe('7')
  })
})
