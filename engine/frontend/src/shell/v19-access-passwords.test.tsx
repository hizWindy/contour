import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Person, PersonCreated } from '@/api/hooks/review'
import type {
  CallNoteOut,
  CompanyDetail,
  CompanyRow,
  LeadRow,
  MeetingFormOut,
  MeetingItem,
  Run,
} from '@/api/types'
import { PrepSheet } from '@/apps/companies/prep-sheet'
import AdminPeopleTab from '@/apps/lead-finder/admin/people'
import { makeLead, LEAD_ID } from '@/apps/lead-finder/lead/test-lead'
import { ALL_FEATURES, DEFAULT_FEATURES_BY_ROLE, type Feature, type Role } from '@/auth/can'
import { Segmented } from '@/components/motion'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { routes } from '@/router'
import { ROLE_NAMES } from '@/shell/roles'
import { mockApi, type Call } from '@/test/mock-api'
import { renderWithProviders } from '@/test/render'

const LAZY = 5000

afterEach(() => {
  toast.dismiss()
})

function makePerson(changes: Partial<Person> & { role?: Role; features?: Feature[] } = {}): Person {
  const role: Role = changes.role ?? 'staff'
  const features: Feature[] = changes.features ?? [...DEFAULT_FEATURES_BY_ROLE[role]]
  const apps = [...new Set(features.map((f) => f.split('.')[0] ?? ''))].filter(Boolean)
  return {
    id: 'u-1',
    email: 'sam.staff@example.test',
    username: null,
    name: 'Sam Sample',
    position: 'Account Executive',
    role,
    apps,
    features,
    hubspot_owner: null,
    active: true,
    last_signed_in_at: null,
    created_at: '2026-11-17T00:00:00Z',
    ...changes,
  }
}

function makeSignedInUser(
  role: Role,
  features: Feature[],
  extra: { id?: string; name?: string; email?: string; position?: string | null } = {},
) {
  const apps = [...new Set(features.map((f) => f.split('.')[0] ?? ''))].filter(Boolean)
  return {
    id: extra.id ?? `u-${role}`,
    email: extra.email ?? `${role}@example.test`,
    username: null,
    name: extra.name ?? 'Test Person',
    position: extra.position ?? 'Sales Manager',
    role,
    apps,
    features,
    hubspot_owner: null,
    active: true,
    last_signed_in_at: '2026-11-17T01:00:00Z',
    created_at: '2026-11-01T00:00:00Z',
  }
}

function meResponse(
  user: ReturnType<typeof makeSignedInUser>,
  options: { platformAdminName?: string | null; firstSignIn?: boolean } = {},
): Response {
  return Response.json({
    auth_required: true,
    user,
    session: { id: 'sess-1', current: true },
    platform_admin_name: options.platformAdminName ?? 'Al-khair',
    first_sign_in: options.firstSignIn ?? false,
  })
}

function renderAppAt(path: string, answers: Record<string, unknown>) {
  const calls = mockApi(answers)
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const rendered = renderWithProviders(<RouterProvider router={router} />, { withRouter: false })
  return { ...rendered, router, calls }
}

const LEAD_ROW: LeadRow = {
  id: LEAD_ID,
  company: 'Acme Software',
  result: 'pass',
  stage: 'Active prospect',
  score: 82,
  score_checked: 82,
  band: 'investigate',
  city: 'Melbourne',
  suburb: 'Richmond',
  contact_role: 'Head of Property',
  cost_usd: '0.400000',
  created_at: '2026-10-26T04:00:00Z',
  form_failed: false,
  updated_at: '2026-10-26T04:00:00Z',
  hubspot_status: 'new',
  industry: 'Software',
  industry_group: 'Technology',
  is_test: false,
  note: null,
  office_m2: 2500,
  office_m2_estimated: false,
  origin: 'web',
  reason: 'City: Melbourne. Size: about 2,500 m².',
  run_id: null,
  staff_in_city: 250,
  status: 'new',
  trigger_date: '2028-03-01',
  trigger_id: 'lease_ending',
  trigger_ids: ['lease_ending'],
  trigger_label: 'Lease ending in 1 to 3 years',
  useful: null,
  web_searches: 6,
  tier: 'A',
  confidence: 'high',
  excluded: null,
  has_property: false,
}

const COMPANY_ROW: CompanyRow = {
  key: '101',
  name: 'Sample Logistics Pty Ltd',
  domain: 'samplelogistics.com.au',
  city: 'Perth',
  industry: 'Logistics',
  staff: 300,
  owner: 'Jo Sample',
  last_talk: '2026-10-01',
  next_lease_end: '2027-06-30',
  deal: 'open',
  source: 'hubspot',
  lead_result: null,
  lead_score: null,
}

const COMPANY_DETAIL: CompanyDetail = {
  key: '101',
  source: 'hubspot',
  name: 'Sample Logistics Pty Ltd',
  domain: 'samplelogistics.com.au',
  website: null,
  city: 'Perth',
  state: 'WA',
  industry: 'Logistics',
  staff: 300,
  linkedin_staff: null,
  description: null,
  owner: 'Jo Sample',
  lifecycle_stage: null,
  last_talk: '2026-10-01',
  last_talk_note: null,
  next_lease_end: '2027-06-30',
  deal: 'open',
  hubspot_url: null,
  offices: [],
  deals: [],
  notes: [],
  people: [{ id: '201', name: 'Pat Buyer', title: 'COO', phone: null, last_activity: null }],
  calls: [],
  people_status: 'ready',
  lead: null,
}

function makeCallNote(id: string, status: CallNoteOut['status']): CallNoteOut {
  return {
    id,
    company_key: '101',
    company_name: 'Sample Logistics Pty Ltd',
    person: { id: '201', name: 'Pat Buyer', title: 'COO' },
    text: 'Spoke to Pat about the Perth office.',
    source: 'typed',
    called_at: '2026-11-10T01:00:00Z',
    status,
    sorted_by: 'ai',
    unsure: null,
    call: { summary: 'Connected with Pat.', outcome: 'Connected', in_hubspot: false },
    changes: [
      {
        id: 'c1',
        field: 'lease_end',
        label: 'Lease end',
        office: 'Perth',
        current: '2026-06-30',
        value: '2028-06-30',
        current_changed: false,
        in_hubspot: false,
      },
    ],
    tasks: [],
    left_out: false,
    steps: [],
    hubspot_url: null,
    made_by: 'Mia',
    created_at: '2026-11-10T01:00:00Z',
    confirmed_at: status === 'logged' ? '2026-11-10T01:05:00Z' : null,
  }
}

const MEETING_ITEM: MeetingItem = {
  meeting: {
    id: 'm1',
    company_id: '101',
    contact_ids: [],
    owner_id: 'o-1',
    title: 'Lease renewal walk-through',
    starts_at: '2026-11-18T02:00:00Z',
    ends_at: '2026-11-18T03:00:00Z',
    where: 'online',
    location: null,
    outcome: 'scheduled',
    notes: null,
    hubspot_url: null,
    more_companies: false,
  },
  company_name: 'Sample Logistics Pty Ltd',
  group: 'today',
  form: { id: 'f1', status: 'draft', sent_at: null, sent_count: 0, sent_names: [] },
  notes_logged: false,
  typed: false,
  mine: true,
}

const PRE_READ_FORM: MeetingFormOut = {
  id: 'f1',
  meeting: {
    meeting_id: 'm1',
    company_key: '101',
    company_name: 'Sample Logistics Pty Ltd',
    title: 'Lease renewal walk-through',
    starts_at: '2026-11-18T02:00:00Z',
    ends_at: '2026-11-18T03:00:00Z',
    where: 'online',
  },
  status: 'draft',
  facts: [{ label: 'Staff in Perth', value: '300', source: 'HubSpot' }],
  summaries: {
    what_they_do: { text: 'Freight across WA.', by: 'ai', sources: [] },
    what_we_know: { text: 'Lease up in 2028.', by: 'ai', sources: [] },
    talks_so_far: { text: 'Initial intro call in October.', by: 'ai', sources: [] },
  },
  next_step: null,
  going: null,
  sent_to: [],
  sent_at: null,
  sent_by: null,
  hubspot_copy: null,
  cost_usd: '0',
  error: null,
}

function emptyHomeMocks(
  user: ReturnType<typeof makeSignedInUser>,
  options: { platformAdminName?: string | null; firstSignIn?: boolean } = {},
) {
  return {
    '/api/v1/auth/me': () => meResponse(user, options),
    '/api/v1/runs': { items: [], total: 0 },
    '/api/v1/runs/summary': {
      since: '2026-10-18',
      total_cost_usd: '12.50',
      total_runs: 3,
      days: [],
    },
    '/api/v1/lead-finder/leads/facets': { result: [], trigger: [] },
    '/api/v1/lead-finder/leads': { items: [], total: 0 },
    '/api/v1/companies': { items: [], total: 0, copy_at: null, hubspot_count: 0 },
    '/api/v1/companies/hubspot-sync': { items: [] },
    '/api/v1/companies/call-notes/options': {
      enabled: true,
      ai_enabled: true,
      sending_ready: true,
      waiting_for: null,
      outcomes: ['Connected'],
      fields: [],
      soft_seconds: 180,
      max_chars: 6000,
      voice_tool: 'typing',
    },
    '/api/v1/companies/call-notes/summary': {
      to_confirm: 0,
      needs_look: 0,
      left_out: 0,
      confirmed: 0,
    },
    '/api/v1/companies/call-notes': { items: [], total: 0 },
    '/api/v1/companies/meetings': {
      items: [],
      total: 0,
      meetings_state: 'ready',
      sentence: 'No upcoming meetings.',
      who: 'mine',
      linked: true,
      team_state: 'ready',
      team_names: ['Sales'],
      owners: [],
      checked_at: null,
      syncing: false,
      sync_problem: null,
    },
    '/api/v1/prep/today': [],
  }
}

describe('PLAN-V19 T3-2: Platform admin vs Admin and plain role names', () => {
  it('uses plain role names in ROLE_NAMES', () => {
    expect(ROLE_NAMES.platform_admin).toBe('Platform admin')
    expect(ROLE_NAMES.admin).toBe('Admin')
    expect(ROLE_NAMES.staff).toBe('Staff')
    expect(ROLE_NAMES.viewer).toBe('Viewer')
  })

  it('hides Admin, Test set and Runs and cost from regular Admin, and blocks /admin and /test-set', async () => {
    const aria = makeSignedInUser('admin', [...ALL_FEATURES], {
      name: 'Aria Sample',
      position: 'Sales Manager',
    })
    const { user } = renderAppAt('/', emptyHomeMocks(aria))

    await screen.findByRole('heading', { level: 1, name: /^Good / }, { timeout: LAZY })

    const sidebar = document.querySelector('[data-sidebar="sidebar"]') as HTMLElement
    expect(within(sidebar).queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument()
    expect(within(sidebar).queryByRole('link', { name: 'Test set' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Runs and cost' })).not.toBeInTheDocument()

    await user.keyboard('{Control>}k{/Control}')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByText('Admin')).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    cleanup()

    renderAppAt('/admin/settings', emptyHomeMocks(aria, { platformAdminName: 'Al-khair' }))
    expect(
      await screen.findByText('Only the Platform admin can open Admin settings.', undefined, {
        timeout: LAZY,
      }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Back to Home' }).length).toBeGreaterThanOrEqual(1)
    cleanup()

    renderAppAt('/test-set', emptyHomeMocks(aria))
    expect(
      await screen.findByText('Only the Platform admin can open Test set.', undefined, {
        timeout: LAZY,
      }),
    ).toBeInTheDocument()
  })

  it('shows Admin, Test set and Runs and cost to Platform admin', async () => {
    const owner = makeSignedInUser('platform_admin', [...ALL_FEATURES], {
      name: 'Al-khair',
      position: null,
    })
    const { user } = renderAppAt('/', emptyHomeMocks(owner))

    await screen.findByRole('heading', { level: 1, name: /^Good / }, { timeout: LAZY })
    expect(screen.getByRole('heading', { name: 'Runs and cost' })).toBeInTheDocument()

    const sidebar = document.querySelector('[data-sidebar="sidebar"]') as HTMLElement
    expect(within(sidebar).getByRole('link', { name: 'Admin' })).toBeInTheDocument()
    expect(within(sidebar).getByRole('link', { name: 'Test set' })).toBeInTheDocument()

    await user.keyboard('{Control>}k{/Control}')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Health')).toBeInTheDocument()
  })
})

describe('PLAN-V19 T3-3: Position, ticks, generated starting/reset passwords & Change password', () => {
  it('shows Position in People table, fills role starting ticks, creates a person without password input, shows starting_password once and wipes on close', async () => {
    const owner = makePerson({
      id: 'u-owner',
      email: 'platform.admin@example.test',
      name: 'Al-khair',
      position: 'Founder',
      role: 'platform_admin',
      features: [...ALL_FEATURES],
    })
    const people: Person[] = [owner]

    const calls = mockApi({
      '/api/v1/auth/me': () =>
        meResponse(
          makeSignedInUser('platform_admin', [...ALL_FEATURES], {
            id: 'u-owner',
            name: 'Al-khair',
            position: 'Founder',
          }),
        ),
      '/api/v1/people': (call: Call) => {
        if (call.method === 'GET') return Response.json(people)
        if (call.method === 'POST') {
          const body = call.body as {
            email: string
            name: string
            position?: string | null
            role: 'admin' | 'staff' | 'viewer'
            features: Feature[]
          }
          const made = makePerson({
            id: 'u-jo',
            email: body.email,
            name: body.name,
            position: body.position ?? null,
            role: body.role,
            features: body.features,
          })
          people.push(made)
          const response: PersonCreated = {
            ...made,
            starting_password: 'amber cedar pine 42',
          }
          return Response.json(response, { status: 201 })
        }
        return undefined
      },
    })

    const { user } = renderWithProviders(<AdminPeopleTab />)
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)

    expect(await screen.findByText('Platform admin')).toBeInTheDocument()
    expect(screen.getByText('Founder')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add a person' }))
    const sheet = await screen.findByRole('dialog', { name: 'Add a person' })
    // Never a password input when adding a person.
    expect(sheet.querySelector('input[type="password"]')).toBeNull()

    await user.type(within(sheet).getByLabelText('Name'), 'Jo Sample')
    await user.type(within(sheet).getByLabelText('Email'), 'jo@example.test')
    await user.type(within(sheet).getByLabelText('Position (optional)'), 'Senior Broker')

    // Staff starts with 7 ticks (Lead Finder Rules off), Viewer drops to 4, Admin disables all 8.
    const rulesBox = within(sheet).getByRole('checkbox', { name: 'Rules' })
    const startRunBox = within(sheet).getByRole('checkbox', { name: 'Start a run' })
    const resultsBox = within(sheet).getByRole('checkbox', { name: 'See results' })
    expect(rulesBox).not.toBeChecked()
    expect(startRunBox).toBeChecked()

    await user.click(within(sheet).getByRole('combobox', { name: 'Role' }))
    await user.click(await screen.findByRole('option', { name: 'Viewer' }))
    expect(startRunBox).not.toBeChecked()
    expect(resultsBox).toBeChecked()

    await user.click(within(sheet).getByRole('combobox', { name: 'Role' }))
    await user.click(await screen.findByRole('option', { name: 'Admin' }))
    for (const box of within(sheet).getAllByRole('checkbox')) {
      expect(box).toBeChecked()
      expect(box).toBeDisabled()
    }
    // Role select never includes Platform admin.
    await user.click(within(sheet).getByRole('combobox', { name: 'Role' }))
    expect(screen.queryByRole('option', { name: 'Platform admin' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('option', { name: 'Staff' }))

    await user.click(within(sheet).getByRole('button', { name: 'Add the person' }))

    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/v1/people')
    expect(post?.body).toMatchObject({
      email: 'jo@example.test',
      name: 'Jo Sample',
      position: 'Senior Broker',
      role: 'staff',
    })
    expect(post?.body).not.toHaveProperty('password')

    expect(
      await within(sheet).findByText("Send this to Jo yourself. It won't show again."),
    ).toBeInTheDocument()
    expect(within(sheet).getByText('amber cedar pine 42')).toBeInTheDocument()

    await user.click(within(sheet).getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('amber cedar pine 42')
    expect(within(sheet).getByRole('button', { name: 'Copied' })).toBeInTheDocument()

    await user.click(within(sheet).getByRole('button', { name: 'Done' }))
    await waitFor(() => {
      expect(screen.queryByText('amber cedar pine 42')).not.toBeInTheDocument()
    })

    // Reopening the add sheet shows a clean empty form and never shows the old password.
    await user.click(screen.getByRole('button', { name: 'Add a person' }))
    const freshSheet = await screen.findByRole('dialog', { name: 'Add a person' })
    expect(within(freshSheet).queryByText('amber cedar pine 42')).not.toBeInTheDocument()
    expect(within(freshSheet).getByLabelText('Name')).toHaveValue('')
  })

  it('asks for confirmation before Reset password, shows once, and wipes on Sheet close', async () => {
    const sam = makePerson({ id: 'u-sam', name: 'Sam Sample', email: 'sam@example.test' })
    const calls = mockApi({
      '/api/v1/auth/me': () =>
        meResponse(makeSignedInUser('platform_admin', [...ALL_FEATURES], { id: 'u-owner' })),
      '/api/v1/people': [sam],
      '/api/v1/people/u-sam/password': (call: Call) => {
        if (call.method === 'POST') {
          return Response.json({ starting_password: 'oak river stone 99' })
        }
        return undefined
      },
    })

    const { user } = renderWithProviders(<AdminPeopleTab />)
    await screen.findByText('Sam Sample')

    await user.click(screen.getByRole('button', { name: 'Edit Sam Sample' }))
    const sheet = await screen.findByRole('dialog', { name: 'Sam Sample' })

    await user.click(within(sheet).getByRole('button', { name: 'Reset password' }))
    const confirm = await screen.findByRole('alertdialog', { name: "Reset Sam Sample's password?" })
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(calls.some((c) => c.path === '/api/v1/people/u-sam/password')).toBe(false)

    await user.click(within(sheet).getByRole('button', { name: 'Reset password' }))
    const confirm2 = await screen.findByRole('alertdialog', {
      name: "Reset Sam Sample's password?",
    })
    await user.click(within(confirm2).getByRole('button', { name: 'Reset password' }))

    expect(await within(sheet).findByText('oak river stone 99')).toBeInTheDocument()
    expect(
      within(sheet).getByText("Send this to Sam yourself. It won't show again."),
    ).toBeInTheDocument()

    await user.click(within(sheet).getByRole('button', { name: 'Close' }))
    await waitFor(() => {
      expect(screen.queryByText('oak river stone 99')).not.toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Edit Sam Sample' }))
    const reopened = await screen.findByRole('dialog', { name: 'Sam Sample' })
    expect(within(reopened).queryByText('oak river stone 99')).not.toBeInTheDocument()
  })

  it('shows Position and quiet starting-password line on first sign-in, validates Change password errors, and clears notice on success', async () => {
    const sam = makeSignedInUser('staff', ['companies.call_logs'], {
      name: 'Sam Sample',
      position: 'Account Executive',
    })
    let firstSignIn = true
    mockApi({
      ...emptyHomeMocks(sam, { firstSignIn: true }),
      '/api/v1/auth/me': () => meResponse(sam, { firstSignIn }),
      '/api/v1/auth/password': (call: Call) => {
        const body = call.body as { current: string; new: string }
        if (body.current === 'wrong') {
          return Response.json(
            {
              title: 'Wrong password',
              status: 422,
              code: 'wrong_password',
              detail: "That isn't your current password.",
            },
            { status: 422 },
          )
        }
        firstSignIn = false
        return new Response(null, { status: 204 })
      },
    })

    const router = createMemoryRouter(routes, { initialEntries: ['/'] })
    const { user } = renderWithProviders(<RouterProvider router={router} />, { withRouter: false })

    expect(
      await screen.findByText(
        'You signed in with a starting password. Change it from your account menu whenever you like.',
        undefined,
        { timeout: LAZY },
      ),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Account menu, Sam Sample' }))
    expect(await screen.findByText('Account Executive')).toBeInTheDocument()
    expect(screen.getByText('You signed in with a starting password.')).toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: 'Change password' }))
    const dlg = await screen.findByRole('dialog', { name: 'Change password' })

    await user.type(within(dlg).getByLabelText('Current password'), 'wrong')
    await user.type(within(dlg).getByLabelText('New password'), 'a brand new secret pass')
    await user.click(within(dlg).getByRole('button', { name: 'Save password' }))

    expect(await within(dlg).findByText("That isn't your current password.")).toBeInTheDocument()

    await user.clear(within(dlg).getByLabelText('Current password'))
    await user.type(within(dlg).getByLabelText('Current password'), 'starting-pass-1')
    await user.click(within(dlg).getByRole('button', { name: 'Save password' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Change password' })).not.toBeInTheDocument()
    })
    expect(
      screen.queryByText(
        'You signed in with a starting password. Change it from your account menu whenever you like.',
      ),
    ).not.toBeInTheDocument()
  })
})

describe('PLAN-V19 T3-4: Route guards, zero 403s on Home, and Viewer read-only', () => {
  it('fires zero Lead Finder or non-Call-logs Companies fetches on Home for Pat and blocks restricted direct routes', async () => {
    const pat = makeSignedInUser('staff', ['companies.call_logs'], {
      name: 'Pat Sample',
      position: 'Inside Sales',
    })
    const answers = {
      ...emptyHomeMocks(pat, { platformAdminName: 'Al-khair' }),
    }
    const { calls, user } = renderAppAt('/', answers)

    await screen.findByRole('heading', { level: 1, name: /^Good / }, { timeout: LAZY })

    // Home never fires forbidden reads for Pat.
    const paths = calls.map((c) => c.path)
    expect(paths.some((p) => p.includes('/runs'))).toBe(false)
    expect(paths.some((p) => p.includes('/lead-finder'))).toBe(false)
    expect(paths.some((p) => p === '/api/v1/companies')).toBe(false)
    expect(paths.some((p) => p.includes('/companies/meetings'))).toBe(false)
    expect(paths.some((p) => p.includes('/prep/today'))).toBe(false)

    // Sidebar shows Call logs only (not Companies, Meetings, or Lead Finder).
    const sidebar = document.querySelector('[data-sidebar="sidebar"]') as HTMLElement
    expect(within(sidebar).getByRole('link', { name: 'Call logs' })).toBeInTheDocument()
    expect(within(sidebar).queryByRole('link', { name: 'Companies' })).not.toBeInTheDocument()
    expect(within(sidebar).queryByRole('link', { name: 'Meetings' })).not.toBeInTheDocument()
    expect(within(sidebar).queryByRole('link', { name: 'Results' })).not.toBeInTheDocument()

    // Ctrl+K omits Pre-read for a meeting and Companies/Lead Finder navigation.
    await user.keyboard('{Control>}k{/Control}')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Log a call')).toBeInTheDocument()
    expect(within(dialog).queryByText('Pre-read for a meeting')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Start a run')).not.toBeInTheDocument()

    // Direct navigation to restricted pages shows NoAccessState with Platform admin's name.
    for (const [url, page] of [
      ['/start', 'Start a run'],
      ['/runs', 'Runs'],
      ['/results', 'Results'],
      ['/rules', 'Rules'],
      ['/companies', 'Companies'],
      ['/companies/meetings', 'Meetings'],
    ] as const) {
      const blockedCalls: string[] = []
      mockApi({
        ...emptyHomeMocks(pat, { platformAdminName: 'Al-khair' }),
        '/api/v1/lead-finder/run-options': () => {
          blockedCalls.push('run-options')
          return Response.json({}, { status: 403 })
        },
        '/api/v1/companies/meetings': () => {
          blockedCalls.push('meetings')
          return Response.json({}, { status: 403 })
        },
      })
      cleanup()
      const r = createMemoryRouter(routes, { initialEntries: [url] })
      renderWithProviders(<RouterProvider router={r} />, { withRouter: false })
      expect(
        await screen.findByText(
          `You don't have access to ${page}. Ask Al-khair to turn it on.`,
          undefined,
          { timeout: LAZY },
        ),
      ).toBeInTheDocument()
      expect(blockedCalls).toEqual([])
    }
  })

  it('hides Send to HubSpot when Staff lacks lead_finder.send_to_hubspot and hides Prep when Staff lacks companies.call_prep', async () => {
    const noHubSpotLeadUser = makeSignedInUser('staff', ['lead_finder.results'], {
      name: 'Sam Sample',
    })
    renderAppAt(`/leads/${LEAD_ID}`, {
      ...emptyHomeMocks(noHubSpotLeadUser),
      [`/api/v1/lead-finder/leads/${LEAD_ID}`]: makeLead({ result: 'pass' }),
      [`/api/v1/lead-finder/leads/${LEAD_ID}/similar`]: {
        basis: 'none',
        note: 'None yet.',
        deals: [],
        leads: [],
      },
      '/api/v1/lead-finder/rules': {
        version: 'r1',
        criteria: { triggers: { consultant_window_months: 18 } },
        watchlist: { tbc: [] },
      },
    })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Acme Software' }, { timeout: LAZY }),
    ).toBeInTheDocument()
    // Wait a microtask to ensure HubSpot status hook never renders Send to HubSpot.
    expect(screen.queryByRole('button', { name: 'Send to HubSpot' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
    cleanup()

    const noPrepUser = makeSignedInUser('staff', ['companies.companies'], { name: 'Sam Sample' })
    renderAppAt('/companies/101', {
      ...emptyHomeMocks(noPrepUser),
      '/api/v1/companies/101': COMPANY_DETAIL,
    })
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Sample Logistics Pty Ltd' },
        { timeout: LAZY },
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Prep a call' })).not.toBeInTheDocument()
  })

  it('keeps Val (Viewer with 4 ticks) read-only across Results, Lead, Companies, Call logs, Meetings and Pre-read', async () => {
    const val = makeSignedInUser(
      'viewer',
      ['lead_finder.results', 'companies.companies', 'companies.call_logs', 'companies.meetings'],
      { name: 'Val Sample', position: 'Operations' },
    )

    // Results & Lead: no ticks, no ReviewBar write buttons, no Lead write actions.
    renderAppAt('/results', {
      ...emptyHomeMocks(val),
      '/api/v1/lead-finder/leads': { items: [LEAD_ROW], total: 1 },
      '/api/v1/lead-finder/leads/facets': {
        result: [{ value: 'pass', count: 1 }],
        trigger: [],
      },
    })
    expect(
      await screen.findByText('Acme Software', undefined, { timeout: LAZY }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Pick Acme Software' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send to HubSpot' })).not.toBeInTheDocument()
    cleanup()

    renderAppAt(`/leads/${LEAD_ID}`, {
      ...emptyHomeMocks(val),
      [`/api/v1/lead-finder/leads/${LEAD_ID}`]: makeLead({ result: 'pass', status: 'new' }),
      [`/api/v1/lead-finder/leads/${LEAD_ID}/similar`]: {
        basis: 'none',
        note: 'None yet.',
        deals: [],
        leads: [],
      },
      '/api/v1/lead-finder/rules': {
        version: 'r1',
        criteria: { triggers: { consultant_window_months: 18 } },
        watchlist: { tbc: [] },
      },
    })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Acme Software' }, { timeout: LAZY }),
    ).toBeInTheDocument()
    for (const label of ['Send to HubSpot', 'Watch', 'Reject', 'Re-check', 'Override']) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
    }
    cleanup()

    // Companies: no Sync with HubSpot, no Log call, no Prep.
    renderAppAt('/companies', {
      ...emptyHomeMocks(val),
      '/api/v1/companies': {
        items: [COMPANY_ROW],
        total: 1,
        copy_at: '2026-11-17T00:00:00Z',
        hubspot_count: 1,
      },
      '/api/v1/companies/facets': { cities: [{ value: 'Perth', count: 1 }] },
    })
    expect(
      await screen.findByText('Sample Logistics Pty Ltd', undefined, { timeout: LAZY }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sync with HubSpot' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Log call' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Prep' })).not.toBeInTheDocument()
    cleanup()

    // Call logs (To confirm): no Log call, Send to HubSpot, Edit, Leave out, or preview POST.
    const callLogView = renderAppAt('/companies/call-logs', {
      ...emptyHomeMocks(val),
      '/api/v1/companies/call-notes/summary': {
        to_confirm: 1,
        needs_look: 0,
        left_out: 0,
        confirmed: 0,
      },
      '/api/v1/companies/call-notes': { items: [makeCallNote('n1', 'to_confirm')], total: 1 },
    })
    expect(
      await screen.findByText('Connected with Pat.', undefined, { timeout: LAZY }),
    ).toBeInTheDocument()
    for (const label of ['Log call', 'Send to HubSpot', 'Edit', 'Leave out']) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
    }
    expect(
      callLogView.calls.filter((call) => call.method === 'POST' && call.path.includes('/preview')),
    ).toHaveLength(0)
    cleanup()

    // Meetings & Pre-read: no New pre-read, Sync, Draft it, Log meeting, Redraft, Check and send.
    renderAppAt('/companies/meetings', {
      ...emptyHomeMocks(val),
      '/api/v1/companies/meetings': {
        items: [MEETING_ITEM],
        total: 1,
        meetings_state: 'ready',
        sentence: 'One meeting today.',
        who: 'mine',
        linked: true,
        team_state: 'ready',
        team_names: ['Sales'],
        owners: [{ id: 'o-1', name: 'Jo Sample' }],
        checked_at: '2026-11-17T00:00:00Z',
        syncing: false,
        sync_problem: null,
      },
    })
    expect(
      await screen.findByText('Lease renewal walk-through', undefined, { timeout: LAZY }),
    ).toBeInTheDocument()
    for (const label of ['New pre-read', 'Sync', 'Draft it', 'Log meeting']) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
    }
    cleanup()

    const preReadView = renderAppAt('/companies/meetings/f1', {
      ...emptyHomeMocks(val),
      '/api/v1/companies/meetings/forms/f1': {
        ...PRE_READ_FORM,
        next_step: 'Send lease pack',
        going: 'Jo Sample',
      },
    })
    expect(
      await screen.findByText('Freight across WA.', undefined, { timeout: LAZY }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Redraft' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check and send' })).not.toBeInTheDocument()
    const formArticle = document.querySelector('[data-slot="pre-read-form"]') as HTMLElement
    await preReadView.user.click(formArticle)
    await preReadView.user.keyboard('{Control>}{Enter}{/Control}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      preReadView.calls.filter((call) => call.method === 'POST' && call.path.includes('/send')),
    ).toHaveLength(0)
  })

  it('points to the Platform admin in plain words when Home has zero ticks', async () => {
    const noTicks = makeSignedInUser('staff', [], { name: 'New Hire' })
    renderAppAt('/', emptyHomeMocks(noTicks, { platformAdminName: 'Al-khair' }))
    expect(
      await screen.findByText('No projects are open to you yet.', undefined, { timeout: LAZY }),
    ).toBeInTheDocument()
    expect(screen.getByText('Ask Al-khair to turn one on for you.')).toBeInTheDocument()
    expect(screen.queryByText(/People tab/i)).not.toBeInTheDocument()
  })

  it('renders Prepped today chips without /companies links when Companies tick is missing', async () => {
    const prepWithoutCompanies = makeSignedInUser(
      'staff',
      ['companies.call_prep', 'companies.call_logs'],
      { name: 'Prep Rep' },
    )
    const prepHome = renderAppAt('/', {
      ...emptyHomeMocks(prepWithoutCompanies),
      '/api/v1/companies/preps/today': [
        {
          id: 'p1',
          company_key: '101',
          company_name: 'Sample Logistics Pty Ltd',
          person_name: 'Pat Buyer',
          kind: 'person',
          status: 'ready',
          created_at: new Date().toISOString(),
        },
      ],
    })
    expect(
      await screen.findByText('Pat Buyer, Sample Logistics Pty Ltd', undefined, { timeout: LAZY }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Pat Buyer, Sample Logistics Pty Ltd' }),
    ).not.toBeInTheDocument()
    expect(prepHome.calls.filter((call) => call.path === '/api/v1/companies')).toHaveLength(0)
  })

  it('keeps PrepSheet Log call free of company/prep/style 403s for Call-logs-only staff', async () => {
    const pat = makeSignedInUser('staff', ['companies.call_logs'], { name: 'Pat Sample' })
    const sheetCalls = mockApi({ ...emptyHomeMocks(pat) })
    renderWithProviders(
      <PrepSheet
        target={{
          companyKey: '101',
          companyName: 'Sample Logistics Pty Ltd',
          person: null,
          note: true,
        }}
        onClose={() => {}}
        onChangeTarget={() => {}}
      />,
    )
    expect(await screen.findByRole('dialog', undefined, { timeout: LAZY })).toBeInTheDocument()
    expect(
      sheetCalls.filter(
        (call) =>
          call.path === '/api/v1/companies/101' ||
          call.path.includes('/facts') ||
          call.path.includes('/script-style') ||
          call.path.includes('/preps'),
      ),
    ).toHaveLength(0)
  })

  it('skips leads and searches fetches on /runs/{id} when staff lacks lead_finder.results', async () => {
    const starter = makeSignedInUser('staff', ['lead_finder.start_run'], { name: 'Start Rep' })
    const runFixture: Run = {
      id: '0f3c9a2e-1111-2222-3333-444444444444',
      app: 'lead_finder',
      mode: 'discovery',
      status: 'done',
      params: {},
      caps: {
        run_cap_usd: '20.00',
        max_companies: 20,
        company_cap_usd: '2.50',
        discovery_cap_usd: '8.00',
      },
      rules_version: 'r1',
      prompt_versions: 'p1',
      cost_usd: '1.50',
      web_searches: 4,
      claude_requests: 2,
      counts: {
        slices: 0,
        slices_done: 0,
        slices_failed: 0,
        candidates: 0,
        unique: 0,
        chosen: 0,
        researched: 3,
        skipped: 0,
        failed: 0,
        by_result: {},
        resumes: 0,
        goal: null,
        good: 0,
        by_source: {},
      },
      stop_reason: null,
      error: null,
      error_id: null,
      schedule_id: null,
      cancel_requested_at: null,
      created_at: '2026-11-17T00:00:00Z',
      started_at: '2026-11-17T00:00:01Z',
      finished_at: '2026-11-17T00:05:00Z',
      goal_leads: null,
      good_leads: 0,
      leads_by_source: { web: 0, property_daily: 0, arealytics: 0 },
    }
    const runView = renderAppAt('/runs/0f3c9a2e-1111-2222-3333-444444444444', {
      ...emptyHomeMocks(starter),
      '/api/v1/runs/0f3c9a2e-1111-2222-3333-444444444444': runFixture,
      '/api/v1/runs/0f3c9a2e-1111-2222-3333-444444444444/log': { items: [], last_seq: 0 },
    })
    expect(await screen.findByText('3', undefined, { timeout: LAZY })).toBeInTheDocument()
    expect(
      runView.calls.filter(
        (call) =>
          call.path.startsWith('/api/v1/lead-finder/leads') ||
          call.path.startsWith('/api/v1/searches'),
      ),
    ).toHaveLength(0)
  })
})

describe('PLAN-V19 T3-5: Segmented keyboard navigation and 44px touch height', () => {
  it('supports keyboard arrows from an initially empty value and keeps 44px touch target height', async () => {
    const picked: string[] = []
    const user = userEvent.setup()
    renderWithProviders(
      <Segmented
        aria-label="Reason"
        value=""
        options={[
          { value: 'too_small', label: 'Too small' },
          { value: 'wrong_fit', label: 'Wrong fit' },
          { value: 'other', label: 'Other' },
        ]}
        onChange={(next) => {
          picked.push(next)
        }}
      />,
    )
    const radios = screen.getAllByRole('radio')
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1])
    expect(radios[0]?.className).toContain('touch:min-h-11')

    act(() => {
      radios[0]?.focus()
    })
    await user.keyboard('{ArrowRight}')
    expect(picked).toEqual(['wrong_fit'])
    await user.keyboard('{End}')
    expect(picked).toEqual(['wrong_fit', 'other'])
  })
})

describe('PLAN-V19 T3-6: subtle glass on floating layers only', () => {
  it('defines reduced-transparency fallbacks cleanly in index.css', () => {
    const css = readFileSync(join(import.meta.dirname, '..', 'styles', 'index.css'), 'utf8')
    expect(css).toContain('@media (prefers-reduced-transparency: reduce)')
    expect(css).toContain('backdrop-filter: none;')
    expect(css).toContain('background-color: var(--popover);')
    expect(css).toContain('background-color: var(--background);')
  })

  it('switches TopBar onto glass only while the window is scrolled', async () => {
    const owner = makeSignedInUser('platform_admin', [...ALL_FEATURES], { name: 'Al-khair' })
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0, writable: true })
    renderAppAt('/', emptyHomeMocks(owner))

    await screen.findByRole('button', { name: 'Show or hide the menu' }, { timeout: LAZY })
    const banner = document.querySelector('header')
    expect(banner).not.toBeNull()
    expect(banner?.getAttribute('data-scrolled')).toBeNull()
    expect(banner?.className).toContain('bg-background')
    expect(banner?.className).not.toContain(['glass', 'bar'].join('-'))

    act(() => {
      Object.defineProperty(window, 'scrollY', { configurable: true, value: 80, writable: true })
      window.dispatchEvent(new Event('scroll'))
    })
    expect(banner?.getAttribute('data-scrolled')).toBe('true')
    expect(banner?.className).toContain(['glass', 'bar'].join('-'))

    act(() => {
      Object.defineProperty(window, 'scrollY', { configurable: true, value: 0, writable: true })
      window.dispatchEvent(new Event('scroll'))
    })
    expect(banner?.getAttribute('data-scrolled')).toBeNull()
    expect(banner?.className).toContain('bg-background')
  })

  it('applies floating glass classes to Popover, Dialog overlay and Sheet header', async () => {
    const { user } = renderWithProviders(
      <Popover>
        <PopoverTrigger>Open menu</PopoverTrigger>
        <PopoverContent>Menu body</PopoverContent>
      </Popover>,
    )

    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    const popover = document.querySelector('[data-slot="popover-content"]')
    expect(popover?.className).toContain(['glass', 'surface'].join('-'))
    cleanup()

    renderWithProviders(
      <>
        <Dialog open>
          <DialogContent>
            <DialogTitle>Dialog title</DialogTitle>
            <DialogDescription>Dialog body</DialogDescription>
          </DialogContent>
        </Dialog>
        <Sheet open>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Sheet title</SheetTitle>
              <SheetDescription>Sheet details</SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
      </>,
    )

    const dialogOverlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(dialogOverlay?.className).toContain(['glass', 'overlay'].join('-'))

    const sheetHeader = document.querySelector('[data-slot="sheet-header"]')
    expect(sheetHeader?.className).toContain(['glass', 'surface'].join('-'))
  })
})
