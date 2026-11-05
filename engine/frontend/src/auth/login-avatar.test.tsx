import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { avatarMood, type LoginNotice, type LoginStatus } from './login-form'
import { LoginView } from './login-view'

const avatar = () => document.querySelector('[data-slot=login-avatar]') as HTMLElement

function renderLogin(status: LoginStatus = { kind: 'ready' }, notice: LoginNotice | null = null) {
  return renderWithProviders(
    <LoginView status={status} notice={notice} rememberedIdentifier="" onSubmit={vi.fn()} />,
  )
}

describe('the avatar mood', () => {
  const base = { focus: null, showPassword: false, typedSinceStatus: false } as const

  it('thinks while signing in, and looks concerned after a failed try until the person types', () => {
    expect(avatarMood({ ...base, status: { kind: 'signing_in' } })).toBe('thinking')
    for (const status of [
      { kind: 'wrong' },
      { kind: 'locked', seconds: 60 },
      { kind: 'failed' },
    ] as const) {
      expect(avatarMood({ ...base, status })).toBe('concerned')
      expect(avatarMood({ ...base, status, typedSinceStatus: true })).toBe('ready')
    }
  })

  it('watches the login, and closes its eyes for a hidden password', () => {
    const ready = { kind: 'ready' } as const
    expect(avatarMood({ ...base, status: ready })).toBe('ready')
    expect(avatarMood({ ...base, status: ready, focus: 'identifier' })).toBe('watching')
    expect(avatarMood({ ...base, status: ready, focus: 'password' })).toBe('eyes_closed')
    expect(avatarMood({ ...base, status: ready, focus: 'password', showPassword: true })).toBe(
      'watching',
    )
  })
})

describe('the avatar on the sign-in page', () => {
  it('is for the eye only, and follows the cursor between the fields', async () => {
    const { user } = renderLogin()

    expect(avatar()).toHaveAttribute('aria-hidden', 'true')
    // The cursor starts in the first field.
    expect(avatar()).toHaveAttribute('data-mood', 'watching')
    await user.click(screen.getByLabelText('Password'))
    expect(avatar()).toHaveAttribute('data-mood', 'eyes_closed')
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    await user.click(screen.getByLabelText('Password'))
    expect(avatar()).toHaveAttribute('data-mood', 'watching')
  })

  it('looks concerned after a wrong try, and calm again once the person types', async () => {
    const { user } = renderLogin({ kind: 'wrong' })

    expect(avatar()).toHaveAttribute('data-mood', 'concerned')
    await user.type(screen.getByLabelText('Password'), 'a')
    expect(avatar()).toHaveAttribute('data-mood', 'eyes_closed')
  })

  it('waves once after a sign-out, and not on a plain visit', () => {
    const { unmount } = renderLogin({ kind: 'ready' }, 'signed_out')
    expect(document.querySelector('[data-slot=login-avatar-wave]')).not.toBeNull()
    unmount()

    renderLogin()
    expect(document.querySelector('[data-slot=login-avatar-wave]')).toBeNull()
  })
})
