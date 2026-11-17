/**
 * Who is signed in, "Change password", and "Sign out" (PLAN-V6 C3, PLAN-V13 T1-6, PLAN-V19 T3-3).
 * Two buttons open the same small menu with who you are (name, position, email, role), the
 * projects' own rows (Companies' "Check my mic", PLAN-V18 T3-4), "Change password" (with one
 * quiet prompt on a first sign-in), and "Sign out":
 *
 * - `SidebarAccount`, at the foot of the left menu, like the dashboards people know: your
 *   initials, your name and your role. Folded to icons, it shows the initials, with the name and
 *   role in a tooltip.
 * - `UserMenu`, at the end of the top bar, on a phone only, where the left menu is hidden behind
 *   its button.
 *
 * Nothing shows when sign-in is off on this backend, because there is no one to sign out of.
 */
import { ChevronDown, ChevronsUpDown, KeyRound, LogOut } from 'lucide-react'
import { Suspense, useId, useState } from 'react'
import { toast } from 'sonner'
import { isApiProblem } from '@/api/client'
import { useChangePassword, useLogout, useMe, type SignedInUser } from '@/api/hooks'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { toastProblem } from '@/lib/problems'
import { cn } from '@/lib/utils'
import { ROLE_NAMES } from './roles'
import { useVisibleModules } from './visible-modules'

/** The first letter of the first two words: "Sample Admin" gives "SA", "Al-khair" gives "A". */
function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter((word) => word !== '')
    .slice(0, 2)
    .map((word) => Array.from(word).at(0) ?? '')
  return letters.join('').toUpperCase() || '?'
}

/**
 * A small square with a person's initials. It is for the eye only: the name is always written
 * beside it or inside the menu, so a screen reader skips it.
 */
function Initials({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-md border border-input bg-card text-caption font-semibold text-foreground',
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  )
}

/**
 * The rows the projects bring (`AppModule.accountItems`), like "Check my mic" (PLAN-V18 T3-4),
 * each in its own `Suspense`: they may load late, and show nothing till then.
 */
function ProjectItems() {
  const modules = useVisibleModules()
  return modules.map((app) => {
    const Items = app.accountItems
    return Items ? (
      <Suspense key={app.id} fallback={null}>
        <Items />
      </Suspense>
    ) : null
  })
}

function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const change = useChangePassword()
  const id = useId()
  const [current, setCurrent] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [errors, setErrors] = useState<{ current?: string; new?: string }>({})

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) {
      setCurrent('')
      setNextPassword('')
      setErrors({})
      change.reset()
    }
    onOpenChange(nextOpen)
  }

  const submit = (): void => {
    const missing: { current?: string; new?: string } = {}
    if (current === '') missing.current = 'Give your current password.'
    if (nextPassword === '') missing.new = 'Give a new password.'
    setErrors(missing)
    if (missing.current || missing.new) return
    change.mutate(
      { current, new: nextPassword },
      {
        onSuccess: () => {
          toast('Password changed.')
          handleOpenChange(false)
        },
        onError: (error) => {
          if (isApiProblem(error)) {
            if (error.code === 'wrong_password') {
              setErrors({ current: error.detail ?? "That isn't your current password." })
              return
            }
            if (error.errors.length > 0) {
              const found: { current?: string; new?: string } = {}
              for (const item of error.errors) {
                const field = item.field.replace(/^body\./, '')
                if (field === 'current') found.current = item.message
                if (field === 'new') found.new = item.message
              }
              if (found.current || found.new) {
                setErrors(found)
                return
              }
            }
            if (error.status === 422 && error.detail) {
              setErrors({ new: error.detail })
              return
            }
          }
          toastProblem(error)
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            Use 14 characters or more. This signs out your other devices.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <Field>
            <FieldLabel htmlFor={`${id}-current`}>Current password</FieldLabel>
            <Input
              id={`${id}-current`}
              type="password"
              autoComplete="current-password"
              value={current}
              aria-invalid={errors.current ? true : undefined}
              onChange={(event) => {
                setCurrent(event.target.value)
              }}
            />
            {errors.current ? <FieldError>{errors.current}</FieldError> : null}
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-new`}>New password</FieldLabel>
            <Input
              id={`${id}-new`}
              type="password"
              autoComplete="new-password"
              value={nextPassword}
              aria-invalid={errors.new ? true : undefined}
              onChange={(event) => {
                setNextPassword(event.target.value)
              }}
            />
            {errors.new ? <FieldError>{errors.new}</FieldError> : null}
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                handleOpenChange(false)
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={change.isPending}>
              {change.isPending ? 'Saving.' : 'Save password'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** What the menu holds: who you are, the projects' own rows, "Change password", then "Sign out". */
function AccountMenuContent({
  user,
  firstSignIn,
  side,
  onChangePassword,
}: {
  user: SignedInUser
  firstSignIn: boolean
  side?: 'right' | 'bottom' | 'top'
  onChangePassword: () => void
}) {
  const logout = useLogout()
  return (
    <DropdownMenuContent align="end" side={side} className="w-64">
      <DropdownMenuLabel className="flex items-center gap-3 p-2 font-normal text-foreground">
        <Initials name={user.name} className="size-9 text-ui" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-ui font-semibold">{user.name}</span>
          {user.position ? (
            <span className="truncate text-caption text-muted-foreground">{user.position}</span>
          ) : null}
          <span className="truncate text-caption text-muted-foreground">{user.email}</span>
          <span className="text-caption text-muted-foreground">{ROLE_NAMES[user.role]}</span>
        </span>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <ProjectItems />
      {firstSignIn ? (
        <p className="px-2 py-1 text-caption text-muted-foreground">
          You signed in with a starting password.
        </p>
      ) : null}
      <DropdownMenuItem
        className="touch:min-h-11"
        onSelect={() => {
          onChangePassword()
        }}
      >
        <KeyRound aria-hidden="true" />
        Change password
      </DropdownMenuItem>
      <DropdownMenuItem
        className="touch:min-h-11"
        disabled={logout.isPending}
        onSelect={() => {
          logout.mutate(undefined)
        }}
      >
        <LogOut aria-hidden="true" />
        Sign out
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}

/** The signed-in person, or null when no one is (sign-in off, or still asking). */
function useSignedInAccount(): { user: SignedInUser; firstSignIn: boolean } | null {
  const me = useMe()
  if (me.data?.state !== 'signed_in') return null
  return { user: me.data.user, firstSignIn: me.data.firstSignIn === true }
}

/** The account at the end of the top bar. `className` hides it where the left menu shows it. */
export function UserMenu({ className }: { className?: string }) {
  const account = useSignedInAccount()
  const logout = useLogout()
  const [passwordOpen, setPasswordOpen] = useState(false)
  if (!account) {
    return null
  }
  const { user, firstSignIn } = account
  const { name } = user
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* From a tablet up the name shows beside the initials. A phone has room for the initials
              only, so the button is the same size as the search button next to it. */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn('shrink-0 gap-2 pr-2 pl-1.5 max-sm:w-10 max-sm:px-0', className)}
            aria-label={`Account menu, ${name}`}
            disabled={logout.isPending}
          >
            <Initials name={name} />
            <span className="max-w-40 truncate max-sm:hidden" title={name}>
              {name}
            </span>
            <ChevronDown aria-hidden="true" className="text-muted-foreground max-sm:hidden" />
          </Button>
        </DropdownMenuTrigger>
        <AccountMenuContent
          user={user}
          firstSignIn={firstSignIn}
          onChangePassword={() => {
            setPasswordOpen(true)
          }}
        />
      </DropdownMenu>
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </>
  )
}

/** The account at the foot of the left menu: initials, name and role. It opens the account menu. */
export function SidebarAccount() {
  const account = useSignedInAccount()
  const [passwordOpen, setPasswordOpen] = useState(false)
  if (!account) {
    return null
  }
  const { user, firstSignIn } = account
  const role = ROLE_NAMES[user.role]
  return (
    <>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={`${user.name}, ${role}`}
              aria-label={`Account menu, ${user.name}, ${role}`}
              className="data-[state=open]:bg-sidebar-accent"
            >
              <Initials name={user.name} className="size-8 text-ui" />
              <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
                <span className="truncate font-semibold">{user.name}</span>
                <span className="truncate text-caption text-muted-foreground">{role}</span>
              </span>
              <ChevronsUpDown aria-hidden="true" className="ml-auto size-4 text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <AccountMenuContent
            user={user}
            firstSignIn={firstSignIn}
            side="right"
            onChangePassword={() => {
              setPasswordOpen(true)
            }}
          />
        </DropdownMenu>
      </SidebarMenuItem>
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </>
  )
}
