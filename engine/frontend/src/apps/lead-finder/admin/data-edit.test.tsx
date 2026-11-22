/** The Data tab's edit screens (PLAN-V26 T4-3), against the contract and a fake server. */
import { screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { asLaptop, asPhone } from '@/test/screen'
import AdminDataTab from './data'

const TABLE = {
  table: 'lead_finder.leads',
  label: 'Leads',
  group: 'Lead Finder',
  newest: 'created_at',
  note: null,
  screen: null,
  screen_label: null,
  editable: true,
  columns: [{ key: 'company', label: 'Company', sortable: true }],
}
const field = (key: string, label: string, value: string | null, more: object = {}) => ({
  key,
  label,
  kind: 'text',
  value,
  hidden: false,
  required: false,
  max_chars: 300,
  choices: [],
  ...more,
})
const FORM = {
  blocked: null,
  deletable: false,
  fields: [
    field('company', 'Company', 'Northwind', { required: true }),
    field('note', 'Note', 'Ring ••• 678', { kind: 'long', hidden: true }),
  ],
}
const EDIT = {
  id: 'e1',
  at: '2026-11-23T04:40:00Z',
  admin_name: 'Sam Sample',
  row_id: 'r1',
  action: 'change',
  changes: [{ label: 'City', before: 'Perth', after: 'Adelaide' }],
  can_undo: true,
}

interface Sent {
  method: string
  path: string
  body: unknown
}

function serve({ form = FORM, refused = false }: { form?: object; refused?: boolean } = {}) {
  const sent: Sent[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1', '')
      if (request.method !== 'GET') {
        const text = await request.text()
        sent.push({ method: request.method, path, body: text ? JSON.parse(text) : null })
        if (refused) {
          return Response.json(
            {
              title: 'Some fields need a fix',
              status: 422,
              errors: [{ field: 'body.values.company', message: "Company can't be empty." }],
            },
            { status: 422 },
          )
        }
        return Response.json({ edit_id: 'e2' })
      }
      if (path === '/data/tables') return Response.json([TABLE])
      if (path.endsWith('/rows/r1')) return Response.json(form)
      if (path === '/data/edits') return Response.json({ total: 1, items: [EDIT] })
      return Response.json({ total: 1, items: [{ id: 'r1', values: { company: 'Northwind' } }] })
    }),
  )
  return sent
}

async function openRow() {
  const tools = renderWithProviders(<AdminDataTab />, { route: '/admin/data' })
  await tools.user.click(await screen.findByRole('button', { name: 'Edit' }))
  return { ...tools, sheet: await screen.findByRole('dialog') }
}

afterEach(() => {
  toast.dismiss()
  vi.unstubAllGlobals()
})

describe.each([
  ['1440px', asLaptop],
  ['390px', asPhone],
])('an edit screen at %s', (_width, setWidth) => {
  it('sends only the field that changed', async () => {
    setWidth()
    const sent = serve()
    const { user, sheet } = await openRow()
    const company = await within(sheet).findByLabelText('Company')
    await user.clear(company)
    await user.type(company, 'Northwind Group')
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(sent).toEqual([
        {
          method: 'PATCH',
          path: '/data/tables/lead_finder.leads/rows/r1',
          body: { values: { company: 'Northwind Group' } },
        },
      ])
    })
  })

  it('keeps a hidden detail hidden, and says to type the whole value', async () => {
    setWidth()
    serve()
    const { sheet } = await openRow()
    expect(await within(sheet).findByLabelText('Note')).toHaveValue('Ring ••• 678')
    expect(sheet).toHaveTextContent('Part of it is hidden. To change it, type the whole value.')
  })

  it('asks before a delete', async () => {
    setWidth()
    const sent = serve({ form: { ...FORM, fields: [], deletable: true } })
    const { user, sheet } = await openRow()
    await user.click(await within(sheet).findByRole('button', { name: 'Delete' }))
    const asked = await screen.findByRole('alertdialog')
    expect(sent).toEqual([])
    await user.click(within(asked).getByRole('button', { name: 'Delete' }))
    await waitFor(() => {
      expect(sent.map((item) => item.method)).toEqual(['DELETE'])
    })
  })
})

describe('an edit screen', () => {
  it('shows a refusal by its field', async () => {
    asLaptop()
    serve({ refused: true })
    const { user, sheet } = await openRow()
    await user.clear(await within(sheet).findByLabelText('Company'))
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))
    expect(await within(sheet).findByText("Company can't be empty.")).toBeInTheDocument()
  })

  it('says why a row cannot change, with no form', async () => {
    asLaptop()
    serve({ form: { ...FORM, blocked: 'It is in HubSpot. Change it there.' } })
    const { sheet } = await openRow()
    expect(await within(sheet).findByText('It is in HubSpot. Change it there.')).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('lists the edits, each with its Undo', async () => {
    asLaptop()
    const sent = serve()
    const { user } = renderWithProviders(<AdminDataTab />, { route: '/admin/data' })
    expect(await screen.findByText('City: Perth to Adelaide')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => {
      expect(sent).toEqual([{ method: 'POST', path: '/data/edits/e1/undo', body: null }])
    })
  })
})
