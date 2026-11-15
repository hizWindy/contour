/**
 * Admin, People: each person's HubSpot owner (PLAN-V17 T3-7, the contract part 4), against the
 * hand-typed contract in v17.ts and a fake server. Made-up names only. The project ticks and the
 * roles are tried in plan-v9.test.tsx and roles.test.tsx.
 */
import { screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HubSpotOwnerLink } from '@/api/v17'
import { renderWithProviders } from '@/test/render'
import AdminPeopleTab from './people'

interface Row {
  id: string
  name: string
  email: string
  username: string | null
  role: string
  apps: string[]
  active: boolean
  created_at: string
  last_signed_in_at: string | null
  hubspot_owner?: HubSpotOwnerLink | null
}

const MIA: Row = {
  id: 'aaaaaaaa-2222-3333-4444-555555555555',
  name: 'Mia Sample',
  email: 'mia@example.test',
  username: 'mia',
  role: 'admin',
  apps: [],
  active: true,
  created_at: '2026-11-05T00:00:00Z',
  last_signed_in_at: '2026-11-14T00:00:00Z',
  hubspot_owner: { id: '301', name: 'Mia Sample', matched_by: 'email' },
}
const JO: Row = {
  ...MIA,
  id: 'bbbbbbbb-2222-3333-4444-555555555555',
  name: 'Jo Sample',
  email: 'jo@example.test',
  username: null,
  role: 'staff',
  apps: ['companies'],
  hubspot_owner: { id: '302', name: 'Sam Sample', matched_by: 'person' },
}
const ALEX: Row = {
  ...JO,
  id: 'cccccccc-2222-3333-4444-555555555555',
  name: 'Alex Sample',
  email: 'alex@example.test',
  hubspot_owner: null,
}

/*
  HubSpot's owners, as GET /hubspot/owners gives them: ids and names. One carries an email it
  shouldn't, to prove the page never shows one.
*/
const OWNERS = [
  { id: '301', name: 'Mia Sample' },
  { id: '302', name: 'Sam Sample' },
  { id: '303', name: 'Levi Example', email: 'levi@owners.example' },
]

interface Server {
  people: Row[]
  owners: 'fail' | typeof OWNERS
  puts: Array<{ id: string; body: unknown }>
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status })
}

function stubServer(changes: Partial<Omit<Server, 'puts'>> = {}): Server {
  const server: Server = { people: [MIA, JO, ALEX], owners: OWNERS, puts: [], ...changes }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname
      if (path === '/api/v1/auth/me') {
        return json({ auth_required: false, user: null, session: null })
      }
      if (path === '/api/v1/people' && request.method === 'GET') return json(server.people)
      if (path === '/api/v1/hubspot/owners') {
        return server.owners === 'fail'
          ? json({ title: 'Something went wrong', status: 500, detail: 'Try again.' }, 500)
          : json({ owners: server.owners })
      }
      const put = /^\/api\/v1\/people\/([^/]+)\/hubspot-owner$/.exec(path)
      if (put && request.method === 'PUT') {
        const id = put[1] ?? ''
        const body = (await request.json()) as { owner_id: string | null }
        server.puts.push({ id, body })
        const owner = OWNERS.find((item) => item.id === body.owner_id)
        server.people = server.people.map((person) =>
          person.id === id
            ? {
                ...person,
                hubspot_owner: owner
                  ? { id: owner.id, name: owner.name, matched_by: 'person' }
                  : null,
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

afterEach(() => {
  toast.dismiss()
})

describe("each person's HubSpot owner (PLAN-V17 T3-7)", () => {
  it('shows in the table, with how it was found, or that there is none', async () => {
    stubServer()
    renderWithProviders(<AdminPeopleTab />)
    const table = await screen.findByRole('table', { name: 'People' })
    expect(within(table).getByRole('columnheader', { name: 'HubSpot owner' })).toBeInTheDocument()
    const [mia, jo, alex] = within(table).getAllByRole('row').slice(1)
    expect(mia).toHaveTextContent('Mia SampleMatched by email')
    expect(jo).toHaveTextContent('Sam SampleSet by hand')
    expect(alex).toHaveTextContent('No HubSpot owner')
  })

  it('is picked from a list that filters as you type, and saves at once', async () => {
    const server = stubServer()
    const { user, sheet } = await openEdit('Jo Sample')
    const owner = sheet.getByRole('combobox', { name: 'HubSpot owner' })
    expect(owner).toHaveTextContent('Sam Sample')
    expect(owner).toHaveAccessibleDescription(
      'Set by hand. The calls they send to HubSpot go in under this owner.',
    )

    await user.click(owner)
    const find = await screen.findByRole('combobox', { name: 'Find a HubSpot owner' })
    expect(await screen.findByRole('option', { name: 'Levi Example' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'None' })).toBeInTheDocument()
    await user.type(find, 'levi')
    expect(screen.queryByRole('option', { name: 'Sam Sample' })).toBeNull()
    await user.click(screen.getByRole('option', { name: 'Levi Example' }))

    await waitFor(() => {
      expect(server.puts).toEqual([{ id: JO.id, body: { owner_id: '303' } }])
    })
    expect(
      await screen.findByText("Jo Sample's HubSpot owner is Levi Example now."),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(sheet.getByRole('combobox', { name: 'HubSpot owner' })).toHaveTextContent(
        'Levi Example',
      )
    })
    // Owners come with names only: an email that slipped in never shows.
    expect(screen.queryByText(/owners\.example/)).toBeNull()
  })

  it('"None" clears it', async () => {
    const server = stubServer()
    const { user, sheet } = await openEdit('Jo Sample')
    await user.click(sheet.getByRole('combobox', { name: 'HubSpot owner' }))
    await user.click(await screen.findByRole('option', { name: 'None' }))
    await waitFor(() => {
      expect(server.puts).toEqual([{ id: JO.id, body: { owner_id: null } }])
    })
    expect(await screen.findByText('Jo Sample has no HubSpot owner now.')).toBeInTheDocument()
    await waitFor(() => {
      expect(sheet.getByRole('combobox', { name: 'HubSpot owner' })).toHaveTextContent(
        'No HubSpot owner',
      )
    })
  })

  it('a list that fails says so, offers Try again, and the rest of the sheet still works', async () => {
    const server = stubServer({ owners: 'fail' })
    const { user, sheet } = await openEdit('Jo Sample')
    await user.click(sheet.getByRole('combobox', { name: 'HubSpot owner' }))
    expect(await screen.findByText("The HubSpot owners couldn't be loaded.")).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'None' })).toBeInTheDocument()

    server.owners = OWNERS
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('option', { name: 'Levi Example' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    // The role and the project ticks never waited for the owners.
    expect(sheet.getByRole('combobox', { name: 'Role' })).toBeEnabled()
    expect(sheet.getByRole('checkbox', { name: /Companies/ })).toBeEnabled()
  })

  it('an empty list says so, and None still clears', async () => {
    stubServer({ owners: [] })
    const { user, sheet } = await openEdit('Alex Sample')
    const owner = sheet.getByRole('combobox', { name: 'HubSpot owner' })
    expect(owner).toHaveTextContent('No HubSpot owner')
    expect(owner).toHaveAccessibleDescription(
      'The calls they send to HubSpot go in under this owner.',
    )
    await user.click(owner)
    expect(await screen.findByText('No HubSpot owners to pick from yet.')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'None' })).toBeInTheDocument()
  })
})
