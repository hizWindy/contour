import { screen, within } from '@testing-library/react'
import { vi } from 'vitest'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { ADMIN_TABS } from '@/shell/nav'
import { renderWithProviders } from '@/test/render'
import AdminPage from './index'

function renderAdmin(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/admin" element={<AdminPage />}>
        {ADMIN_TABS.map((tab) => (
          <Route
            key={tab.to}
            path={tab.to.replace('/admin/', '')}
            element={<p>{`Content of ${tab.label}`}</p>}
          />
        ))}
      </Route>
    </Routes>,
    { route },
  )
}

function follows(first: Node, second: Node): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

describe('the Admin tabs on a narrow screen', () => {
  it('stay in one row that scrolls sideways, with the open tab brought into view', async () => {
    const scrolled = vi.fn()
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(scrolled)
    const { user } = renderAdmin('/admin/runs')
    const tabs = screen.getByRole('navigation', { name: 'Admin sections' })
    // One row: it never wraps, and it scrolls when the screen is too narrow for all the tabs.
    expect(tabs).toHaveClass('overflow-x-auto')
    expect(tabs).not.toHaveClass('flex-wrap')

    await user.click(within(tabs).getByRole('link', { name: 'Settings' }))

    const last = scrolled.mock.contexts.at(-1) as HTMLElement
    expect(last).toHaveAttribute('aria-current', 'page')
    expect(last).toHaveTextContent('Settings')
    expect(scrolled).toHaveBeenLastCalledWith({ inline: 'center', block: 'nearest' })
  })
})

describe('the Admin tabs', () => {
  it('say what each tab is for, in a sentence, for every tab', () => {
    for (const tab of ADMIN_TABS) {
      expect(tab.purpose, tab.label).toBeTruthy()
      // One or two short sentences a person outside the team can read at a glance.
      expect(tab.purpose?.length, tab.label).toBeLessThan(160)
      expect(tab.purpose, tab.label).not.toContain('—')
    }
  })

  it('show the purpose of the open tab between the tabs and its content, and change with the tab', async () => {
    const { user } = renderAdmin('/admin/runs')
    const tabs = screen.getByRole('navigation', { name: 'Admin sections' })

    for (const tab of ADMIN_TABS) {
      await user.click(within(tabs).getByRole('link', { name: tab.label }))
      const purpose = await screen.findByText(tab.purpose ?? '')
      const content = screen.getByText(`Content of ${tab.label}`)
      // Order on the page: the tabs, then the purpose, then the content.
      expect(follows(tabs, purpose)).toBe(true)
      expect(follows(purpose, content)).toBe(true)
      // Only the open tab's purpose is shown.
      expect(document.querySelectorAll('[data-slot=admin-purpose]')).toHaveLength(1)
    }
  })
})
