/**
 * "Open in HubSpot" is hidden everywhere for someone with no HubSpot user (PLAN-V23 T3-4): they
 * have no HubSpot login, so a link to a HubSpot record would only open HubSpot's sign-in. Each
 * place a link to HubSpot is drawn is tried as a linked account (it shows) and as a "No HubSpot
 * user" one (it doesn't), at a laptop's width (1440px) and a phone's (390px). An account not set
 * yet, or sign-in off, keeps the links. Made-up names only.
 */
import { screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import type { SignIn } from '@/api/hooks/auth'
import { queryKeys } from '@/api/query'
import type { CompanyRow } from '@/api/types'
import { HubSpotLink } from '@/apps/assistant/today/rows-view'
import { OpenInHubSpot } from '@/apps/companies/call-logs/open-in-hubspot'
import { CompanyActions } from '@/apps/companies/company-dialog'
import { RowActions } from '@/apps/companies/row-actions'
import { InHubSpotBadge, SendToHubSpotDialog } from '@/components/hubspot'
import { makeWrite } from '@/components/hubspot/test-write'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { asLaptop, asPhone } from '@/test/screen'
import { hubSpotUserOf } from './hubspot-user'

const RECORD = 'https://app.hubspot.com/contacts/1/company/201'

function as(hubspot: 'linked' | 'none' | 'not_set'): SignIn {
  return {
    state: 'signed_in',
    user: {
      id: '22222222-3333-4444-5555-666666666666',
      email: 'jo@example.test',
      username: 'jo',
      name: 'Jo Sample',
      position: 'Designer',
      role: 'staff',
      apps: ['companies'],
      features: ['companies.companies', 'companies.call_logs'],
      hubspot,
    },
  }
}

function renderAs(signIn: SignIn, ui: ReactElement) {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), signIn)
  // Companies' row action reads the company from the cache only.
  queryClient.setQueryData(queryKeys.companies.detail('201'), {
    key: '201',
    name: 'Sample Logistics Pty Ltd',
    hubspot_url: RECORD,
  })
  return renderWithProviders(ui, { queryClient })
}

/** Each place a link to a HubSpot record is drawn. */
const PLACES: [string, ReactElement][] = [
  ["Today's rows", <HubSpotLink key="today" href={RECORD} context=": Call Jo Sample" />],
  [
    "Call logs' calls",
    <OpenInHubSpot key="calls" href={RECORD} company="Sample Logistics Pty Ltd" />,
  ],
  [
    "the company's actions",
    <CompanyActions
      key="company"
      company={{ key: '201', name: 'Sample Logistics Pty Ltd', hubspot_url: RECORD }}
    />,
  ],
  [
    "Companies' row action",
    <RowActions
      key="row"
      row={{ key: '201', source: 'hubspot' } as CompanyRow}
      handlers={{ onOpen: () => undefined }}
    />,
  ],
  [
    'the "in HubSpot" badge',
    <InHubSpotBadge key="badge" status="in_hubspot" name="Sample Logistics" href={RECORD} />,
  ],
  [
    'Send to HubSpot, once sent',
    <SendToHubSpotDialog
      key="send"
      open
      onOpenChange={() => undefined}
      company="Sample Logistics Pty Ltd"
      write={makeWrite({ status: 'done', hubspot_url: RECORD })}
      loading={false}
      error={null}
      sending={false}
      onConfirm={() => undefined}
    />,
  ],
  [
    "Send to HubSpot's preview",
    <SendToHubSpotDialog
      key="preview"
      open
      onOpenChange={() => undefined}
      company="Sample Logistics Pty Ltd"
      write={makeWrite({ plan: { ...makeWrite().plan, company_url: RECORD } })}
      loading={false}
      error={null}
      sending={false}
      onConfirm={() => undefined}
    />,
  ],
]

function hubSpotLinks(): HTMLElement[] {
  return screen
    .queryAllByRole('link')
    .filter((link) => link.getAttribute('href')?.startsWith('https://app.hubspot.com/'))
}

describe.each([
  ['a laptop (1440px)', asLaptop],
  ['a phone (390px)', asPhone],
])('"Open in HubSpot" (PLAN-V23 T3-4), on %s', (_width, size) => {
  it.each(PLACES)('shows on %s for a linked account', (_place, ui) => {
    size()
    renderAs(as('linked'), ui)
    expect(hubSpotLinks()).toHaveLength(1)
  })

  it.each(PLACES)('is hidden on %s for no HubSpot user', (_place, ui) => {
    size()
    renderAs(as('none'), ui)
    expect(hubSpotLinks()).toEqual([])
    expect(screen.queryByText(/Open (the company )?in HubSpot/)).toBeNull()
  })
})

describe('whose links stay', () => {
  it('an account not set yet, and sign-in off, keep them', () => {
    renderAs(as('not_set'), <HubSpotLink href={RECORD} context=": Call Jo Sample" />)
    expect(hubSpotLinks()).toHaveLength(1)
    expect(hubSpotUserOf({ state: 'off' })).toBeNull()
  })
})
