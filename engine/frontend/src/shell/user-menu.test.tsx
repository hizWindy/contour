import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SAMPLE_USER, signedIn, stubAuthBackend } from '@/test/fake-auth'
import { renderWithProviders } from '@/test/render'
import { UserMenu } from './user-menu'

describe('the account menu in the top bar', () => {
  it('shows the initials and name, and opens to the email, the role and Sign out', async () => {
    stubAuthBackend({
      me: signedIn({ ...SAMPLE_USER, name: 'Al-khair Pama', email: 'al@example.test' }),
    })
    const { user } = renderWithProviders(<UserMenu />)

    const account = await screen.findByRole('button', { name: 'Account menu, Al-khair Pama' })
    expect(account).toHaveTextContent('AP')
    expect(account).toHaveTextContent('Al-khair Pama')
    expect(account).toHaveAttribute('aria-haspopup', 'menu')
    expect(account).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).toBeNull()

    await user.click(account)

    const menu = await screen.findByRole('menu')
    expect(account).toHaveAttribute('aria-expanded', 'true')
    expect(within(menu).getByText('Al-khair Pama')).toBeInTheDocument()
    expect(within(menu).getByText('al@example.test')).toBeInTheDocument()
    expect(within(menu).getByText('Admin')).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('works from the keyboard: Enter opens it, Escape shuts it and gives the focus back', async () => {
    stubAuthBackend({ me: signedIn() })
    const { user } = renderWithProviders(<UserMenu />)
    const account = await screen.findByRole('button', { name: /^Account menu/ })

    account.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull()
    })
    expect(account).toHaveFocus()
  })

  it.each([
    ['Al-khair', 'A'],
    ['Al-khair Pama', 'AP'],
    ['mary jane watson', 'MJ'],
    ['', '?'],
  ])('shows the initials of "%s" as "%s"', async (name, initials) => {
    stubAuthBackend({ me: signedIn({ ...SAMPLE_USER, name }) })
    renderWithProviders(<UserMenu />)

    await screen.findByRole('button', { name: /^Account menu/ })
    // The tile is for the eye only (the name is beside it), so a screen reader skips it.
    expect(screen.getByText(initials)).toHaveAttribute('aria-hidden', 'true')
  })
})
