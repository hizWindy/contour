/**
 * The Contour HQ sign-in page, as a picture of its state: the brand panel, then a card with
 * "Welcome back", the two fields, "Keep me signed in", and one Navy "Sign in" button.
 *
 * This part only draws and checks the form. Whoever shows it (the login page, or the mockup page
 * while the sign-in backend is built) owns the state and the request: it passes `status` and gets
 * the values in `onSubmit`. So every state can be shown with fake data (PLAN-V6, C1), and the
 * real page (C2) only adds the request.
 *
 * Easy to use: the cursor starts in the first field (in the password field when the username is
 * remembered), Enter signs in, password managers fill both fields (`autocomplete`), and a warning
 * shows while Caps Lock is on. Every state has an icon and words, never colour alone.
 */
import { zodResolver } from '@hookform/resolvers/zod'
import {
  ArrowBigUpDash,
  AtSign,
  CircleAlert,
  Clock,
  Eye,
  EyeOff,
  Hourglass,
  Info,
  LockKeyhole,
  LogOut,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import { useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { BrandPanel } from './brand-panel'
import {
  FAILED_TEXT,
  LAPTOP,
  lockedText,
  loginSchema,
  NOTICE_TEXT,
  WRONG_TEXT,
  type LoginNotice,
  type LoginStatus,
  type LoginValues,
} from './login-form'

const NOTICE_ICONS: Record<LoginNotice, LucideIcon> = {
  idle: Clock,
  expired: Clock,
  signed_out: LogOut,
}

export interface LoginViewProps {
  status: LoginStatus
  onSubmit: (values: LoginValues) => void
  /** Why the person is on this page (signed out after idle time, for example). */
  notice?: LoginNotice | null
  /** The email or username used last time on this device, filled in for them. */
  rememberedIdentifier?: string
}

/** A line with an icon and words: the notice above the form, or an error above the button. */
function Message({
  icon: Icon,
  tone,
  role,
  children,
}: {
  icon: LucideIcon
  tone: 'neutral' | 'error'
  role: 'status' | 'alert'
  children: ReactNode
}) {
  return (
    <p
      role={role}
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2 text-ui animate-in fade-in-0 duration-150',
        tone === 'error'
          ? 'border-destructive bg-destructive-soft text-destructive-ink'
          : 'bg-muted text-foreground',
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

function StatusMessage({ status }: { status: LoginStatus }) {
  switch (status.kind) {
    case 'signing_in':
      // The button says it too, but a change of button text is not read out.
      return (
        <p role="status" className="sr-only">
          Signing in.
        </p>
      )
    case 'wrong':
      return (
        <Message icon={CircleAlert} tone="error" role="alert">
          {WRONG_TEXT}
        </Message>
      )
    case 'locked':
      return (
        <Message icon={LockKeyhole} tone="error" role="alert">
          {lockedText(status.minutes)}
        </Message>
      )
    case 'failed':
      return (
        <Message icon={CircleAlert} tone="error" role="alert">
          {FAILED_TEXT}
        </Message>
      )
    default:
      return null
  }
}

export function LoginView({
  status,
  onSubmit,
  notice = null,
  rememberedIdentifier = '',
}: LoginViewProps) {
  const laptop = useMediaQuery(LAPTOP)
  const ids = useId()
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [forgotOpen, setForgotOpen] = useState(false)
  const signingIn = status.kind === 'signing_in'

  const {
    register,
    handleSubmit,
    setFocus,
    setValue,
    watch,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: rememberedIdentifier, password: '', keepSignedIn: false },
  })

  // The cursor starts where there is something to type: the password when the username is
  // remembered, otherwise the first field (`autoFocus` on each, below).
  const startInPassword = rememberedIdentifier !== ''

  // After a wrong password, the password is cleared and the cursor goes back to it.
  useEffect(() => {
    if (status.kind === 'wrong') {
      setValue('password', '')
      setFocus('password')
    }
  }, [status, setFocus, setValue])

  const capsCheck = (event: KeyboardEvent<HTMLInputElement>): void => {
    setCapsLock(event.getModifierState('CapsLock'))
  }

  const keepSignedIn = watch('keepSignedIn')
  const identifierId = `${ids}-identifier`
  const passwordId = `${ids}-password`
  const keepId = `${ids}-keep`
  const forgotId = `${ids}-forgot`
  const capsId = `${ids}-caps`
  const NoticeIcon = notice ? NOTICE_ICONS[notice] : null

  return (
    <div className="min-h-dvh bg-background lg:grid lg:grid-cols-2">
      <title>Sign in to Contour HQ</title>
      <BrandPanel layout={laptop ? 'side' : 'band'} />
      <main className="flex flex-col items-center justify-center px-4 pt-12 pb-12 sm:px-6 lg:px-16">
        <div className="flex w-full max-w-md flex-col gap-6 animate-in fade-in-0 slide-in-from-bottom-2 duration-250">
          <section
            aria-labelledby={`${ids}-title`}
            className="flex flex-col gap-6 rounded-lg border bg-card p-6 sm:p-8"
          >
            <div className="flex flex-col gap-1">
              <h1 id={`${ids}-title`} className="font-serif text-title">
                Welcome back
              </h1>
              <p className="text-ui text-muted-foreground">Sign in to Contour HQ</p>
            </div>

            {notice && NoticeIcon ? (
              <Message icon={NoticeIcon} tone="neutral" role="status">
                {NOTICE_TEXT[notice]}
              </Message>
            ) : null}

            <form
              noValidate
              className="flex flex-col gap-5"
              aria-busy={signingIn}
              onSubmit={(event) => {
                // While a sign-in is on its way, Enter does nothing more.
                if (signingIn) {
                  event.preventDefault()
                  return
                }
                void handleSubmit(onSubmit)(event)
              }}
            >
              <Field data-invalid={errors.identifier ? true : undefined}>
                <FieldLabel htmlFor={identifierId}>Email or username</FieldLabel>
                <InputGroup className="h-10 touch:h-11">
                  <InputGroupAddon>
                    <AtSign aria-hidden="true" />
                  </InputGroupAddon>
                  <InputGroupInput
                    id={identifierId}
                    type="text"
                    autoFocus={!startInPassword}
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-invalid={errors.identifier ? true : undefined}
                    aria-describedby={errors.identifier ? `${identifierId}-error` : undefined}
                    {...register('identifier')}
                  />
                </InputGroup>
                {errors.identifier ? (
                  <FieldError id={`${identifierId}-error`}>{errors.identifier.message}</FieldError>
                ) : null}
              </Field>

              <Field data-invalid={errors.password ? true : undefined}>
                <FieldLabel htmlFor={passwordId}>Password</FieldLabel>
                <InputGroup className="h-10 touch:h-11">
                  <InputGroupAddon>
                    <LockKeyhole aria-hidden="true" />
                  </InputGroupAddon>
                  <InputGroupInput
                    id={passwordId}
                    type={showPassword ? 'text' : 'password'}
                    autoFocus={startInPassword}
                    autoComplete="current-password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-invalid={errors.password ? true : undefined}
                    aria-describedby={
                      [errors.password ? `${passwordId}-error` : '', capsLock ? capsId : '']
                        .filter(Boolean)
                        .join(' ') || undefined
                    }
                    onKeyDown={capsCheck}
                    onKeyUp={capsCheck}
                    {...register('password', {
                      onBlur: () => {
                        setCapsLock(false)
                      },
                    })}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-xs"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                      aria-controls={passwordId}
                      className="touch:size-9"
                      onClick={() => {
                        setShowPassword((shown) => !shown)
                      }}
                    >
                      {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                {capsLock ? (
                  <p
                    id={capsId}
                    role="status"
                    className="flex items-center gap-2 text-caption text-review-ink"
                  >
                    <ArrowBigUpDash aria-hidden="true" className="size-4" />
                    Caps Lock is on.
                  </p>
                ) : null}
                {errors.password ? (
                  <FieldError id={`${passwordId}-error`}>{errors.password.message}</FieldError>
                ) : null}
              </Field>

              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <Field orientation="horizontal" className="w-auto items-start">
                  <Checkbox
                    id={keepId}
                    checked={keepSignedIn}
                    className="mt-0.5"
                    onCheckedChange={(checked) => {
                      setValue('keepSignedIn', checked === true)
                    }}
                  />
                  <div className="flex flex-col gap-0.5">
                    <FieldLabel htmlFor={keepId} className="font-normal">
                      Keep me signed in
                    </FieldLabel>
                    <FieldDescription>For 14 days on this device.</FieldDescription>
                  </div>
                </Field>
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  className="h-auto px-0 text-ui touch:h-auto"
                  aria-expanded={forgotOpen}
                  aria-controls={forgotId}
                  onClick={() => {
                    setForgotOpen((open) => !open)
                  }}
                >
                  Forgot password?
                </Button>
              </div>
              <div id={forgotId} className="empty:hidden">
                {forgotOpen ? (
                  <Message icon={Info} tone="neutral" role="status">
                    Ask your Contour HQ admin to reset it.
                  </Message>
                ) : null}
              </div>

              <StatusMessage status={status} />

              <Button type="submit" size="lg" className="w-full" aria-disabled={signingIn}>
                {signingIn ? (
                  <>
                    <Hourglass aria-hidden="true" />
                    Signing in.
                  </>
                ) : (
                  'Sign in'
                )}
              </Button>
            </form>
          </section>
          <p className="flex items-center gap-2 text-caption text-muted-foreground">
            <ShieldCheck aria-hidden="true" className="size-4 shrink-0" />
            Private system. Sign-ins are logged.
          </p>
        </div>
      </main>
    </div>
  )
}
