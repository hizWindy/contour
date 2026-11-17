/**
 * Admin, People (PLAN-V9 E1, PLAN-V17 T3-7, PLAN-V19 T3-2..T3-4): who has an account, their
 * role, optional position, feature ticks across two groups, HubSpot owner, and starting/reset
 * passwords.
 */
import {
  Check,
  ChevronsUpDown,
  Copy,
  Eye,
  KeyRound,
  Pencil,
  Shield,
  ShieldCheck,
  UserPlus,
  UserRound,
} from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import { isApiProblem } from '@/api/client'
import {
  useAddPerson,
  useChangePerson,
  useMe,
  usePeople,
  useResetPersonPassword,
  type Person,
} from '@/api/hooks'
import { ownerOf, useHubSpotOwners, useSetHubSpotOwner } from '@/api/hooks/hubspot-owners'
import type { HubSpotOwnerLink, HubSpotOwnerOption } from '@/api/types'
import {
  ALL_FEATURES,
  DEFAULT_FEATURES_BY_ROLE,
  FEATURE_GROUPS,
  appsToFeatures,
  type Feature,
} from '@/auth/can'
import { ErrorState } from '@/components/error-state'
import { PendingCards } from '@/components/skeletons'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatRelative } from '@/lib/format'
import { toastProblem } from '@/lib/problems'
import { cn } from '@/lib/utils'
import { firstName } from '@/shell/home-words'
import { ROLE_NAMES, roleName } from '@/shell/roles'

const ROLES = [
  { id: 'admin', label: ROLE_NAMES.admin },
  { id: 'staff', label: ROLE_NAMES.staff },
  { id: 'viewer', label: ROLE_NAMES.viewer },
] as const
type AssignableRole = (typeof ROLES)[number]['id']

const ROLE_ICONS = {
  platform_admin: ShieldCheck,
  admin: Shield,
  staff: UserRound,
  viewer: Eye,
} as const

function RoleBadge({ role }: { role: string }) {
  const Icon = role in ROLE_ICONS ? ROLE_ICONS[role as keyof typeof ROLE_ICONS] : UserRound
  return (
    <Badge variant="outline">
      <Icon aria-hidden="true" />
      {roleName(role)}
    </Badge>
  )
}

function personFeatures(person: Person): Feature[] {
  if (person.role === 'platform_admin' || person.role === 'admin') {
    return [...ALL_FEATURES]
  }
  const features = person.features ?? []
  if (features.length > 0) {
    return ALL_FEATURES.filter((feature) => features.includes(feature))
  }
  if (person.apps.length > 0) {
    return appsToFeatures(person.apps)
  }
  return []
}

function adminTicksNote(role: string, self: boolean): string | null {
  if (role === 'platform_admin') {
    return self ? '(you are the Platform admin)' : '(the Platform admin has everything)'
  }
  if (role === 'admin') {
    return '(an Admin has everything)'
  }
  return null
}

function FeatureGroups({
  idPrefix,
  role,
  selected,
  disabled = false,
  self = false,
  onToggle,
}: {
  idPrefix: string
  role: string
  selected: readonly Feature[]
  disabled?: boolean
  self?: boolean
  onToggle: (feature: Feature, checked: boolean) => void
}) {
  const allOn = role === 'platform_admin' || role === 'admin'
  const selectedSet = new Set<string>(selected)
  const note = adminTicksNote(role, self)
  return (
    <div className="flex flex-col gap-4">
      {FEATURE_GROUPS.map((group) => (
        <fieldset key={group.app} className="flex flex-col gap-2">
          <legend className="text-ui font-semibold text-foreground">{group.label}</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {group.features.map((item) => {
              const boxId = `${idPrefix}-${item.key}`
              const checked = allOn || selectedSet.has(item.key)
              return (
                <label key={item.key} htmlFor={boxId} className="flex items-center gap-2 text-ui">
                  <Checkbox
                    id={boxId}
                    checked={checked}
                    disabled={allOn || disabled}
                    onCheckedChange={(next) => {
                      onToggle(item.key, next === true)
                    }}
                  />
                  <span>{item.label}</span>
                </label>
              )
            })}
          </div>
        </fieldset>
      ))}
      {note ? <span className="text-caption text-muted-foreground">{note}</span> : null}
    </div>
  )
}

/** What a person can use, summarised in plain words for the People list. */
function accessOf(person: Person): string {
  if (person.role === 'platform_admin' || person.role === 'admin') return 'Everything'
  const enabled = new Set(personFeatures(person))
  if (enabled.size === 0) return 'None yet'
  if (enabled.size === ALL_FEATURES.length) return 'Everything'
  const parts: string[] = []
  for (const group of FEATURE_GROUPS) {
    const picked = group.features.filter((item) => enabled.has(item.key))
    if (picked.length === group.features.length) {
      parts.push(group.label)
    } else {
      parts.push(...picked.map((item) => item.label))
    }
  }
  return parts.join(', ')
}

function MadePasswordBox({
  name,
  password,
  onDone,
}: {
  name: string
  password: string
  onDone?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  const copy = (): void => {
    void navigator.clipboard?.writeText(password).catch(() => undefined)
    setCopied(true)
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
    }
    timerRef.current = window.setTimeout(() => {
      setCopied(false)
      timerRef.current = null
    }, 2000)
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <p className="text-ui text-foreground">
        Send this to {firstName(name)} yourself. It won&apos;t show again.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
        <code className="font-mono text-body font-semibold text-foreground select-all">
          {password}
        </code>
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {onDone ? (
        <div>
          <Button type="button" onClick={onDone}>
            Done
          </Button>
        </div>
      ) : null}
    </div>
  )
}

// --- The HubSpot owner (PLAN-V17 T3-7) ---------------------------------------------------------

const NO_OWNER = 'No HubSpot owner'
const OWNER_PURPOSE = 'The calls they send to HubSpot go in under this owner.'
const OWNERS_LOADING = 'Loading the HubSpot owners.'
const OWNERS_FAILED = "The HubSpot owners couldn't be loaded."
const OWNERS_EMPTY = 'No HubSpot owners to pick from yet.'
const NO_SUCH_OWNER = 'No owner by that name.'

/** How a person's owner was found, in words, or null when the server doesn't say. */
function howFound(owner: HubSpotOwnerLink): string | null {
  if (owner.matched_by === 'email') return 'Matched by email'
  if (owner.matched_by === 'person') return 'Set by hand'
  return null
}

/** The owner in the table: the name and how it was found, or that there is none. */
function OwnerCell({ person }: { person: Person }) {
  const owner = ownerOf(person)
  if (!owner) return <span className="text-muted-foreground">{NO_OWNER}</span>
  const how = howFound(owner)
  return (
    <span className="flex flex-col">
      <span>{owner.name}</span>
      {how ? <span className="text-caption text-muted-foreground">{how}</span> : null}
    </span>
  )
}

function OwnerField({ person }: { person: Person }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const owners = useHubSpotOwners()
  const setOwner = useSetHubSpotOwner()
  const current = ownerOf(person)
  const saving = setOwner.isPending ? setOwner.variables : undefined
  const shown: HubSpotOwnerOption | null = saving ? saving.owner : current
  const how = saving || !current ? null : howFound(current)
  const list = owners.data ?? []

  const pick = (owner: HubSpotOwnerOption | null): void => {
    setOpen(false)
    if ((owner?.id ?? null) === (current?.id ?? null)) return
    setOwner.mutate(
      { userId: person.id, owner },
      {
        onSuccess: () => {
          toast(
            owner
              ? `${person.name}'s HubSpot owner is ${owner.name} now.`
              : `${person.name} has no HubSpot owner now.`,
          )
        },
        onError: toastProblem,
      },
    )
  }

  return (
    <Field>
      <FieldLabel htmlFor={`${id}-owner`}>HubSpot owner</FieldLabel>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={`${id}-owner`}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-describedby={`${id}-owner-line`}
            disabled={setOwner.isPending}
            className="w-full justify-between font-normal"
          >
            <span className={cn('truncate', shown ? undefined : 'text-muted-foreground')}>
              {shown?.name ?? NO_OWNER}
            </span>
            <ChevronsUpDown aria-hidden="true" className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) gap-0 p-0">
          <Command label="Find a HubSpot owner">
            <CommandInput placeholder="Find an owner" className="touch:text-body" />
            <CommandList>
              <CommandEmpty>{NO_SUCH_OWNER}</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="none"
                  keywords={['clear', 'no owner']}
                  data-checked={shown === null}
                  onSelect={() => {
                    pick(null)
                  }}
                >
                  None
                </CommandItem>
                {list.map((owner) => (
                  <CommandItem
                    key={owner.id}
                    value={owner.id}
                    keywords={[owner.name]}
                    data-checked={owner.id === shown?.id}
                    onSelect={() => {
                      pick(owner)
                    }}
                  >
                    <span className="truncate">{owner.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              {owners.isPending ? (
                <p role="status" className="px-3 pb-3 text-ui text-muted-foreground">
                  {OWNERS_LOADING}
                </p>
              ) : owners.isError ? (
                <div role="alert" className="flex flex-col items-start gap-2 px-3 pb-3 text-ui">
                  <p>{OWNERS_FAILED}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void owners.refetch()}
                  >
                    Try again
                  </Button>
                </div>
              ) : list.length === 0 ? (
                <p className="px-3 pb-3 text-ui text-muted-foreground">{OWNERS_EMPTY}</p>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <FieldDescription id={`${id}-owner-line`}>
        {how ? `${how}. ${OWNER_PURPOSE}` : OWNER_PURPOSE}
      </FieldDescription>
    </Field>
  )
}

/** Edits to one person, applied at once: role, position, ticks, owner, sign-in and password reset. */
function EditPerson({ person, self }: { person: Person; self: boolean }) {
  const change = useChangePerson()
  const resetPassword = useResetPersonPassword()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetResult, setResetResult] = useState<string | null>(null)
  const [positionDraft, setPositionDraft] = useState(person.position ?? '')
  const [positionError, setPositionError] = useState<string | null>(null)

  const handleOpenChange = (nextOpen: boolean): void => {
    setOpen(nextOpen)
    if (nextOpen) {
      setPositionDraft(person.position ?? '')
      setPositionError(null)
    } else {
      setConfirmReset(false)
      setResetResult(null)
      setPositionError(null)
      resetPassword.reset()
    }
  }

  const patch = (
    body: {
      role?: AssignableRole
      position?: string | null
      features?: Feature[]
      active?: boolean
    },
    done: string,
    onInvalidPosition?: (message: string) => void,
  ) => {
    change.mutate(
      { userId: person.id, patch: body },
      {
        onSuccess: () => {
          toast(done)
        },
        onError: (error) => {
          if (isApiProblem(error) && error.errors.length > 0 && onInvalidPosition) {
            const posErr = error.errors.find(
              (item) => item.field.replace(/^body\./, '') === 'position',
            )
            if (posErr) {
              onInvalidPosition(posErr.message)
              return
            }
          }
          toastProblem(error)
        },
      },
    )
  }

  const trimmedPosition = positionDraft.trim()
  const positionChanged = trimmedPosition !== (person.position ?? '')
  const currentFeatures = personFeatures(person)
  const isPlatformAdminPerson = person.role === 'platform_admin'

  const savePosition = (): void => {
    if (!positionChanged || change.isPending) return
    setPositionError(null)
    const nextValue = trimmedPosition === '' ? null : trimmedPosition
    patch(
      { position: nextValue },
      nextValue
        ? `${person.name}'s position is ${nextValue}.`
        : `${person.name}'s position cleared.`,
      setPositionError,
    )
  }

  const runReset = (): void => {
    resetPassword.mutate(person.id, {
      onSuccess: (answer) => {
        setConfirmReset(false)
        setResetResult(answer.starting_password)
      },
      onError: toastProblem,
    })
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label={`Edit ${person.name}`}>
          <Pencil aria-hidden="true" />
          Edit
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col gap-6 overflow-y-auto pb-6">
        <SheetHeader>
          <SheetTitle>{person.name}</SheetTitle>
          <SheetDescription>{person.email}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-4">
          <Field>
            <FieldLabel htmlFor={`${id}-role`}>Role</FieldLabel>
            {isPlatformAdminPerson ? (
              <>
                <Input id={`${id}-role`} value={roleName(person.role)} disabled />
                <FieldDescription>The Platform admin role can&apos;t be changed.</FieldDescription>
              </>
            ) : (
              <>
                <Select
                  value={person.role}
                  disabled={self || change.isPending}
                  onValueChange={(value) => {
                    const nextRole = value as AssignableRole
                    const features = [...DEFAULT_FEATURES_BY_ROLE[nextRole]]
                    patch(
                      { role: nextRole, features },
                      `${person.name} is ${roleName(nextRole)} now.`,
                    )
                  }}
                >
                  <SelectTrigger id={`${id}-role`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {self ? (
                  <FieldDescription>You can&apos;t change your own role.</FieldDescription>
                ) : null}
              </>
            )}
          </Field>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              savePosition()
            }}
          >
            <Field>
              <FieldLabel htmlFor={`${id}-position`}>Position</FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  id={`${id}-position`}
                  value={positionDraft}
                  maxLength={80}
                  placeholder="Optional, e.g. Sales Director"
                  aria-invalid={positionError ? true : undefined}
                  onChange={(event) => {
                    setPositionDraft(event.target.value)
                    setPositionError(null)
                  }}
                />
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  disabled={!positionChanged || change.isPending}
                >
                  Save
                </Button>
              </div>
              {positionError ? <FieldError>{positionError}</FieldError> : null}
            </Field>
          </form>

          <div className="flex flex-col gap-2">
            <span className="text-ui font-semibold text-foreground">Access</span>
            <FeatureGroups
              idPrefix={id}
              role={person.role}
              selected={currentFeatures}
              disabled={change.isPending}
              self={self}
              onToggle={(feature, checked) => {
                const next = checked
                  ? ALL_FEATURES.filter(
                      (item) => item === feature || currentFeatures.includes(item),
                    )
                  : currentFeatures.filter((item) => item !== feature)
                patch(
                  { features: next },
                  checked ? `${person.name} can use this now.` : `Turned off for ${person.name}.`,
                )
              }}
            />
          </div>

          <OwnerField person={person} />

          <label
            htmlFor={`${id}-active`}
            className="flex items-center justify-between gap-3 text-ui"
          >
            <span className="flex flex-col">
              <span className="font-semibold">Can sign in</span>
              <span className="text-caption text-muted-foreground">
                Off ends their sessions and keeps the account.
              </span>
            </span>
            <Switch
              id={`${id}-active`}
              checked={person.active}
              disabled={self || isPlatformAdminPerson || change.isPending}
              onCheckedChange={(on) => {
                patch(
                  { active: on },
                  on ? `${person.name} can sign in again.` : `${person.name} can't sign in now.`,
                )
              }}
            />
          </label>

          <div className="flex flex-col gap-3 border-t pt-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-ui font-semibold">Password</span>
                <span className="text-caption text-muted-foreground">
                  Make a new starting password and sign them out on every device.
                </span>
              </div>
              <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={resetPassword.isPending}
                  >
                    <KeyRound aria-hidden="true" />
                    Reset password
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset {person.name}&apos;s password?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {self
                        ? "We'll make a new starting password for you and sign you out."
                        : `We'll make a new starting password for ${person.name} and sign them out on every device.`}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={resetPassword.isPending}
                      onClick={(event) => {
                        event.preventDefault()
                        runReset()
                      }}
                    >
                      {resetPassword.isPending ? 'Resetting.' : 'Reset password'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            {resetResult !== null ? (
              <MadePasswordBox name={person.name} password={resetResult} />
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function PeopleTable({ people, myId }: { people: Person[]; myId: string | null }) {
  return (
    <Table compact aria-label="People">
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Role</TableHead>
          <TableHead className="max-md:hidden">Access</TableHead>
          <TableHead className="max-lg:hidden">HubSpot owner</TableHead>
          <TableHead className="max-sm:hidden">Last signed in</TableHead>
          <TableHead>
            <span className="sr-only">Edit</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {people.map((person) => {
          const self = person.id === myId
          return (
            <TableRow key={person.id}>
              <TableCell className="max-w-64">
                <span className="flex flex-col">
                  <span className="flex flex-wrap items-center gap-2 font-semibold">
                    {person.name}
                    {self ? (
                      <span className="text-caption font-normal text-muted-foreground">You</span>
                    ) : null}
                  </span>
                  {person.position ? (
                    <span className="truncate text-caption text-muted-foreground">
                      {person.position}
                    </span>
                  ) : null}
                  <span className="truncate text-caption text-muted-foreground">
                    {person.email}
                  </span>
                </span>
              </TableCell>
              <TableCell>
                <span className="flex flex-wrap items-center gap-2">
                  <RoleBadge role={person.role} />
                  {!person.active ? <Badge variant="outline">Can&apos;t sign in</Badge> : null}
                </span>
              </TableCell>
              <TableCell className="max-md:hidden">{accessOf(person)}</TableCell>
              <TableCell className="max-lg:hidden">
                <OwnerCell person={person} />
              </TableCell>
              <TableCell className="text-muted-foreground max-sm:hidden">
                {person.last_signed_in_at ? formatRelative(person.last_signed_in_at) : 'Not yet'}
              </TableCell>
              <TableCell className="text-right">
                <EditPerson person={person} self={self} />
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function AddPerson() {
  const add = useAddPerson()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [position, setPosition] = useState('')
  const [role, setRole] = useState<AssignableRole>('staff')
  const [picked, setPicked] = useState<ReadonlySet<Feature>>(
    () => new Set(DEFAULT_FEATURES_BY_ROLE.staff),
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [created, setCreated] = useState<{ name: string; password: string } | null>(null)

  const resetForm = (): void => {
    setName('')
    setEmail('')
    setPosition('')
    setRole('staff')
    setPicked(new Set(DEFAULT_FEATURES_BY_ROLE.staff))
    setErrors({})
  }

  const handleOpenChange = (nextOpen: boolean): void => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setCreated(null)
      resetForm()
      add.reset()
    }
  }

  const submit = (): void => {
    const missing: Record<string, string> = {}
    if (name.trim() === '') missing.name = 'Give a name.'
    if (email.trim() === '') missing.email = 'Give an email.'
    setErrors(missing)
    if (Object.keys(missing).length > 0) return
    const features =
      role === 'admin' ? [...ALL_FEATURES] : ALL_FEATURES.filter((feature) => picked.has(feature))
    const trimmedPosition = position.trim()
    add.mutate(
      {
        name: name.trim(),
        email: email.trim(),
        role,
        ...(trimmedPosition ? { position: trimmedPosition } : {}),
        features,
      },
      {
        onSuccess: (person) => {
          toast(`${person.name} can sign in now.`)
          setCreated({ name: person.name, password: person.starting_password })
          resetForm()
        },
        onError: (error) => {
          if (isApiProblem(error) && error.errors.length > 0) {
            const found: Record<string, string> = {}
            for (const item of error.errors) {
              found[item.field.replace(/^body\./, '')] = item.message
            }
            setErrors(found)
            return
          }
          toastProblem(error)
        },
      },
    )
  }

  const selectedFeatures =
    role === 'admin' ? [...ALL_FEATURES] : ALL_FEATURES.filter((feature) => picked.has(feature))

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button type="button" size="sm">
          <UserPlus aria-hidden="true" />
          Add a person
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col gap-4 overflow-y-auto pb-6">
        <SheetHeader>
          <SheetTitle>Add a person</SheetTitle>
          <SheetDescription>
            We make a starting password for them once. Send it to them yourself.
          </SheetDescription>
        </SheetHeader>
        {created ? (
          <div className="px-4">
            <MadePasswordBox
              name={created.name}
              password={created.password}
              onDone={() => {
                handleOpenChange(false)
              }}
            />
          </div>
        ) : (
          <form
            className="grid gap-4 px-4"
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <Field>
              <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
              <Input
                id={`${id}-name`}
                value={name}
                autoComplete="off"
                aria-invalid={errors.name ? true : undefined}
                onChange={(event) => {
                  setName(event.target.value)
                }}
              />
              {errors.name ? <FieldError>{errors.name}</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-email`}>Email</FieldLabel>
              <Input
                id={`${id}-email`}
                type="email"
                value={email}
                autoComplete="off"
                aria-invalid={errors.email ? true : undefined}
                onChange={(event) => {
                  setEmail(event.target.value)
                }}
              />
              {errors.email ? <FieldError>{errors.email}</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-position`}>Position (optional)</FieldLabel>
              <Input
                id={`${id}-position`}
                value={position}
                maxLength={80}
                placeholder="e.g. Sales Director"
                autoComplete="off"
                aria-invalid={errors.position ? true : undefined}
                onChange={(event) => {
                  setPosition(event.target.value)
                }}
              />
              {errors.position ? <FieldError>{errors.position}</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-role`}>Role</FieldLabel>
              <Select
                value={role}
                onValueChange={(value) => {
                  const nextRole = value as AssignableRole
                  setRole(nextRole)
                  setPicked(new Set(DEFAULT_FEATURES_BY_ROLE[nextRole]))
                }}
              >
                <SelectTrigger id={`${id}-role`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <FeatureGroups
              idPrefix={id}
              role={role}
              selected={selectedFeatures}
              onToggle={(feature, checked) => {
                const changed = new Set(picked)
                if (checked) changed.add(feature)
                else changed.delete(feature)
                setPicked(changed)
              }}
            />
            {errors.features ? (
              <span className="text-ui text-destructive">{errors.features}</span>
            ) : null}
            <div>
              <Button type="submit" disabled={add.isPending}>
                <UserPlus aria-hidden="true" />
                {add.isPending ? 'Adding.' : 'Add the person'}
              </Button>
            </div>
          </form>
        )}
      </SheetContent>
    </Sheet>
  )
}

export default function AdminPeopleTab() {
  const people = usePeople()
  const me = useMe()
  const myId = me.data?.state === 'signed_in' ? me.data.user.id : null
  if (people.error) {
    return (
      <ErrorState
        error={people.error}
        context="The people couldn't be loaded."
        onRetry={() => void people.refetch()}
      />
    )
  }
  if (!people.data) {
    return <PendingCards label="Loading the people." cards={2} />
  }
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-section font-semibold">Everyone with an account</CardTitle>
          <CardDescription>
            Turn ticks on or off for each person, or reset their password.
          </CardDescription>
          <CardAction>
            <AddPerson />
          </CardAction>
        </CardHeader>
        <CardContent>
          {people.data.length === 0 ? (
            <p className="text-ui text-muted-foreground">
              Nobody has an account yet. Sign-in is off on this backend.
            </p>
          ) : (
            <PeopleTable people={people.data} myId={myId} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
