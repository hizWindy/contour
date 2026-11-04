import { fireEvent, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import {
  FAILED_TEXT,
  lockedText,
  WRONG_TEXT,
  type LoginNotice,
  type LoginStatus,
  type LoginValues,
} from './login-form'
import { LoginView } from './login-view'

function renderLogin(
  props: {
    status?: LoginStatus
    notice?: LoginNotice | null
    rememberedIdentifier?: string
  } = {},
) {
  const onSubmit = vi.fn<(values: LoginValues) => void>()
  const result = renderWithProviders(
    <LoginView
      status={props.status ?? { kind: 'ready' }}
      notice={props.notice ?? null}
      rememberedIdentifier={props.rememberedIdentifier}
      onSubmit={onSubmit}
    />,
  )
  return { ...result, onSubmit }
}

const identifier = () => screen.getByLabelText('Email or username')
const password = () => screen.getByLabelText('Password')

describe('the sign-in page', () => {
  it('welcomes the person and names Contour HQ, with no sign-up or social buttons', () => {
    renderLogin()

    expect(screen.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeInTheDocument()
    expect(screen.getByText('Sign in to Contour HQ')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Contour' })).toBeInTheDocument()
    expect(screen.getByText('HQ')).toBeInTheDocument()
    expect(screen.getByText('Private system. Sign-ins are logged.')).toBeInTheDocument()
    expect(screen.queryByText(/sign up|create an account|google|microsoft/i)).toBeNull()
  })

  it('lets password managers fill in both fields', () => {
    renderLogin()

    expect(identifier()).toHaveAttribute('autocomplete', 'username')
    expect(password()).toHaveAttribute('autocomplete', 'current-password')
    expect(password()).toHaveAttribute('type', 'password')
  })

  it('starts in the first field, or in the password when the username is remembered', () => {
    const first = renderLogin()
    expect(identifier()).toHaveFocus()
    first.unmount()

    renderLogin({ rememberedIdentifier: 'sample.admin' })
    expect(identifier()).toHaveValue('sample.admin')
    expect(password()).toHaveFocus()
  })

  it('signs in with Enter, and sends the trimmed name, the password and the choice', async () => {
    const { user, onSubmit } = renderLogin()

    await user.type(identifier(), '  sample.admin  ')
    await user.click(screen.getByRole('checkbox', { name: /Keep me signed in/ }))
    await user.type(password(), 'a long phrase of words{Enter}')

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      identifier: 'sample.admin',
      password: 'a long phrase of words',
      keepSignedIn: true,
    })
  })

  it('says which field is empty instead of sending', async () => {
    const { user, onSubmit } = renderLogin()

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Enter your email or username.')).toBeInTheDocument()
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    expect(identifier()).toHaveAttribute('aria-invalid', 'true')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows and hides the password with the eye button', async () => {
    const { user } = renderLogin()

    const eye = screen.getByRole('button', { name: 'Show password' })
    expect(eye).toHaveAttribute('aria-pressed', 'false')
    await user.click(eye)
    expect(password()).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(password()).toHaveAttribute('type', 'password')
  })

  it('warns while Caps Lock is on', () => {
    renderLogin()

    fireEvent.keyDown(password(), { key: 'A', modifierCapsLock: true })
    expect(screen.getByText('Caps Lock is on.')).toBeInTheDocument()
    expect(password()).toHaveAccessibleDescription('Caps Lock is on.')

    fireEvent.keyUp(password(), { key: 'CapsLock', modifierCapsLock: false })
    expect(screen.queryByText('Caps Lock is on.')).toBeNull()
  })

  it('says who resets a forgotten password, with no reset email', async () => {
    const { user } = renderLogin()

    const forgot = screen.getByRole('button', { name: 'Forgot password?' })
    expect(forgot).toHaveAttribute('aria-expanded', 'false')
    await user.click(forgot)

    expect(forgot).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Ask your Contour HQ admin to reset it.')).toBeInTheDocument()
  })
})

describe('each state has an icon and words', () => {
  it('signing in: the button says so, and Enter sends nothing more', async () => {
    const { user, onSubmit } = renderLogin({ status: { kind: 'signing_in' } })

    const button = screen.getByRole('button', { name: 'Signing in.' })
    expect(button.querySelector('svg')).not.toBeNull()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Signing in.')

    await user.type(identifier(), 'sample.admin')
    await user.type(password(), 'a long phrase of words{Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('a wrong email or password: one message for both, and the password is cleared', async () => {
    function Page() {
      const [status, setStatus] = useState<LoginStatus>({ kind: 'ready' })
      return (
        <LoginView
          status={status}
          onSubmit={() => {
            setStatus({ kind: 'wrong' })
          }}
        />
      )
    }
    const { user } = renderWithProviders(<Page />)

    await user.type(identifier(), 'sample.admin')
    await user.type(password(), 'not the right one{Enter}')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(WRONG_TEXT)
    expect(alert.querySelector('svg')).not.toBeNull()
    expect(password()).toHaveValue('')
    expect(password()).toHaveFocus()
    expect(identifier()).toHaveValue('sample.admin')
  })

  it('locked: says how long to wait, in whole minutes', () => {
    renderLogin({ status: { kind: 'locked', minutes: 11.2 } })

    expect(screen.getByRole('alert')).toHaveTextContent('Too many tries. Try again in 12 minutes.')
    expect(lockedText(1)).toBe('Too many tries. Try again in 1 minute.')
    expect(lockedText(0)).toBe('Too many tries. Try again in 1 minute.')
  })

  it('no answer: says nothing changed and when to try again', () => {
    renderLogin({ status: { kind: 'failed' } })

    expect(screen.getByRole('alert')).toHaveTextContent(FAILED_TEXT)
  })

  it.each([
    ['idle', 'You were signed out after 2 hours idle.'],
    ['expired', 'You were signed out after 12 hours. Sign in again.'],
    ['signed_out', 'You signed out.'],
  ] as const)('the %s notice shows above the form', (notice, text) => {
    renderLogin({ notice })

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(text)
    expect(status.querySelector('svg')).not.toBeNull()
  })
})
