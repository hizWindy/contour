import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { HubSpotWrite } from '@/api/types'
import { renderWithProviders } from '@/test/render'
import { InHubSpotBadge } from './in-hubspot-badge'
import { SendToHubSpotDialog } from './send-to-hubspot-dialog'
import { makeWrite } from './test-write'

function renderDialog(write: HubSpotWrite | undefined, onConfirm = vi.fn()) {
  const view = renderWithProviders(
    <SendToHubSpotDialog
      open
      onOpenChange={() => undefined}
      company="Acme Logistics"
      write={write}
      loading={false}
      error={null}
      sending={false}
      onConfirm={onConfirm}
    />,
  )
  return { ...view, onConfirm }
}

describe('InHubSpotBadge', () => {
  it('shows the label with its icon, the owner and a safe link to the record', () => {
    renderWithProviders(
      <InHubSpotBadge
        status="in_hubspot"
        name="Acme"
        owner="Pat Lee"
        href="https://app.hubspot.com/contacts/1/record/0-2/7"
      />,
    )
    expect(screen.getByText('In HubSpot')).toBeInTheDocument()
    expect(screen.getByText('Owner: Pat Lee')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Open in HubSpot/ })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('never makes a link of an address that is not a web address', () => {
    renderWithProviders(<InHubSpotBadge status="new" href="javascript:alert(1)" />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('SendToHubSpotDialog', () => {
  it('shows the preview and waits for write access with Send off', () => {
    renderDialog(makeWrite())
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('This makes a new company in HubSpot.')
    expect(dialog).toHaveTextContent('This company has an open deal in HubSpot.')
    const rows = within(dialog).getAllByRole('row')
    expect(rows).toHaveLength(4) // the header and three fields
    expect(within(rows[1]).getByText('Written')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Kept: HubSpot has Law Practice')).toBeInTheDocument()
    expect(within(rows[3]).getByText('Goes in the note')).toBeInTheDocument()
    expect(within(rows[3]).getByText('<b>Lease expiry</b>')).toBeInTheDocument() // text, not markup
    expect(dialog).toHaveTextContent('It is added to the list "AI suggested".')
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for write access.')
    expect(screen.getByRole('button', { name: 'Send to HubSpot' })).toBeDisabled()
  })

  it('sends after a click when writing is on', async () => {
    const { user, onConfirm } = renderDialog(makeWrite({ can_write: true, waiting_for: null }))
    const send = screen.getByRole('button', { name: 'Send to HubSpot' })
    expect(send).toBeEnabled()
    await user.click(send)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('shows each step of a finished send and offers no second send', () => {
    renderDialog(
      makeWrite({
        status: 'done',
        can_write: true,
        waiting_for: null,
        hubspot_url: 'https://app.hubspot.com/contacts/1/record/0-2/7',
        steps: [
          { step: 'company', status: 'done', detail: 'Made a new company.', hubspot_id: '7' },
          { step: 'note', status: 'done', detail: 'Added the note.', hubspot_id: '8' },
          { step: 'list', status: 'done', detail: 'Added to the list.', hubspot_id: '9' },
        ],
      }),
    )
    expect(
      screen.getByRole('heading', { name: 'Acme Logistics is in HubSpot' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'What happened' })).toHaveTextContent(
      'The company: Done.',
    )
    expect(screen.queryByRole('button', { name: 'Send to HubSpot' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('offers to finish a part sent write', () => {
    renderDialog(
      makeWrite({
        status: 'partial',
        can_write: true,
        waiting_for: null,
        steps: [
          { step: 'company', status: 'done', detail: null, hubspot_id: '7' },
          { step: 'list', status: 'failed', detail: 'Missing crm.lists.write.', hubspot_id: null },
        ],
      }),
    )
    expect(screen.getByRole('button', { name: 'Try the rest again' })).toBeEnabled()
    expect(screen.getByText(/Missing crm.lists.write/)).toBeInTheDocument()
  })
})
