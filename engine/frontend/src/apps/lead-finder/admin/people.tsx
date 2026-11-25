/**
 * Admin, People (PLAN-V9 E1, PLAN-V17 T3-7, PLAN-V19 T3-2..T3-4): who has an account, their
 * role, optional position, feature ticks in three groups (Companies, Assistant and Lead Finder,
 * PLAN-V22 choice 4), HubSpot user (PLAN-V23 T3-4, `hubspot-user.tsx`: a HubSpot user, "No
 * HubSpot user", or "Not set" for an older account), and starting/reset passwords.
 *
 * PLAN-V26 Part 2: Reset password has "Sign them out everywhere", the username can be changed,
 * a locked person's row has Unlock, and one button copies the sign-in details.
 *
 * PLAN-V28 T1-1: Edit person has "Live voice (paid by the minute)", a switch only the Platform
 * admin sets (this tab is theirs alone, and the server refuses anyone else).
 */
import {
  Check,
  Copy,
  Eye,
  History,
  KeyRound,
  Lock,
  LockOpen,
  Pencil,
  Shield,
  ShieldCheck,
  UserPlus,
  UserRound,
} from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { isApiProblem } from '@/api/client'
import {
  useAddPerson,
  useChangePerson,
  useMe,
  usePeople,
  useResetPersonPassword,
  useUnlockPerson,
  type Person,
} from '@/api/hooks'
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
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
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
import { formatRelative, formatTime } from '@/lib/format'
import { toastProblem } from '@/lib/problems'
import { firstName } from '@/shell/home-words'
import { ROLE_NAMES, roleName } from '@/shell/roles'
import { takenUsers, type HubSpotChoice } from './hubspot-choice'
import {
  HUBSPOT_USER,
  HubSpotUserCell,
  HubSpotUserField,
  NewHubSpotUserField,
  PICK_A_CHOICE,
} from './hubspot-user'

/** Each person's live voice switch (PLAN-V28 T1-1, "Words on screen"; the hint is TBC). */
const LIVE_VOICE = 'Live voice (paid by the minute)'
const LIVE_VOICE_HINT = 'The Assistant talks back. It needs the Call logs or Meetings tick.'

function liveVoiceDone(name: string, on: boolean): string {
  return on ? `Live voice is on for ${name}.` : `Live voice is off for ${name}.`
}

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
        <fieldset key={group.id} className="flex flex-col gap-2">
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

/** A new password with who signs in with it: their username, or their email without one. */
interface SignIn {
  name: string
  login: string
  password: string
}

/** What "Copy sign-in details" copies. The address is the site this admin is on (choice 7). */
function signInDetails({ login, password }: SignIn): string {
  return [
    `Contour HQ: ${window.location.origin}`,
    `Username: ${login}`,
    `Password: ${password}`,
  ].join('\n')
}

function MadePasswordBox({ made, onDone }: { made: SignIn; onDone?: () => void }) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(signInDetails(made))
    } catch {
      setCopyFailed(true) // the password is on screen, so it can still be selected
      return
    }
    setCopyFailed(false)
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
        Send this to {firstName(made.name)} yourself. It won&apos;t show again.
      </p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 rounded-md border bg-muted/40 px-3 py-2">
        <dt className="text-caption text-muted-foreground">Username</dt>
        <dd className="text-ui break-all text-foreground select-all">{made.login}</dd>
        <dt className="text-caption text-muted-foreground">Password</dt>
        <dd className="min-w-0">
          <code className="font-mono text-body font-semibold break-all text-foreground select-all">
            {made.password}
          </code>
        </dd>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy sign-in details'}
        </Button>
        {copyFailed ? (
          <p role="alert" className="text-caption text-foreground">
            Copying didn&apos;t work. Select the password and copy it.
          </p>
        ) : null}
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

/** What a reset does, before it is confirmed (PLAN-V26 choice 6). */
function resetWords(name: string, self: boolean, signOut: boolean): string {
  if (self) {
    return signOut
      ? "We'll make a new starting password for you and sign you out."
      : "We'll make a new starting password for you. You stay signed in."
  }
  return signOut
    ? `We'll make a new starting password for ${name} and sign them out on every device.`
    : `We'll make a new starting password for ${name}. It works at once, and their open browsers stay signed in.`
}

/** The ticks a new person starts with: the role's, or Call logs only with no HubSpot user. */
function startingTicks(role: AssignableRole, noHubSpotUser: boolean): readonly Feature[] {
  if (role === 'admin') return ALL_FEATURES
  // PLAN-V23 choice 13: "No HubSpot user" starts on the Call logs tick only.
  return noHubSpotUser ? ['companies.call_logs'] : DEFAULT_FEATURES_BY_ROLE[role]
}

/** "Locked until 3:40 pm after 10 wrong tries." with Unlock (PLAN-V26 choice 9). */
function LockedNote({ person }: { person: Person }) {
  const unlock = useUnlockPerson()
  const { lock } = person
  if (!lock) return null
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-normal whitespace-normal">
      <span className="flex items-start gap-1 text-caption text-foreground">
        <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        {`Locked until ${formatTime(lock.until)} after ${String(lock.wrong_tries)} wrong tries.`}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Unlock ${person.name}`}
        disabled={unlock.isPending}
        onClick={() => {
          unlock.mutate(person.id, {
            onSuccess: () => {
              toast(`${person.name} can try again now.`)
            },
            onError: toastProblem,
          })
        }}
      >
        <LockOpen aria-hidden="true" />
        Unlock
      </Button>
    </span>
  )
}

/**
 * The username, saved on its own (PLAN-V26 choice 8). The backend checks it: lower case, no @,
 * not taken.
 */
function UsernameField({ id, person }: { id: string; person: Person }) {
  const change = useChangePerson()
  const [draft, setDraft] = useState(person.username ?? '')
  const [error, setError] = useState<string | null>(null)
  const next = draft.trim()
  const changed = next !== (person.username ?? '')
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!changed || change.isPending) return
        setError(null)
        change.mutate(
          { userId: person.id, patch: { username: next === '' ? null : next } },
          {
            onSuccess: (saved) => {
              setDraft(saved.username ?? '')
              toast(
                saved.username
                  ? `${person.name} signs in as ${saved.username} now. Tell them.`
                  : `${person.name} signs in with their email now. Tell them.`,
              )
            },
            onError: (problem) => {
              const wrong = isApiProblem(problem)
                ? problem.errors.find((item) => item.field.replace(/^body\./, '') === 'username')
                : undefined
              if (wrong) setError(wrong.message)
              else toastProblem(problem)
            },
          },
        )
      }}
    >
      <Field>
        <FieldLabel htmlFor={id}>Username</FieldLabel>
        <div className="flex items-center gap-2">
          <Input
            id={id}
            value={draft}
            maxLength={64}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="None: they use their email"
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-hint`}
            onChange={(event) => {
              setDraft(event.target.value)
              setError(null)
            }}
          />
          <Button type="submit" variant="outline" size="sm" disabled={!changed || change.isPending}>
            Save
          </Button>
        </div>
        <FieldDescription id={`${id}-hint`}>
          Tell them if you change it: the old one stops at once. Their email always works.
        </FieldDescription>
        {error ? <FieldError>{error}</FieldError> : null}
      </Field>
    </form>
  )
}

/**
 * Edits to one person, applied at once: role, username, position, ticks, HubSpot user, sign-in and
 * password reset. `taken`: the HubSpot users linked to someone, and to whom.
 */
function EditPerson({
  person,
  self,
  taken,
}: {
  person: Person
  self: boolean
  taken: ReadonlyMap<string, string>
}) {
  const change = useChangePerson()
  const resetPassword = useResetPersonPassword()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [signOut, setSignOut] = useState(true)
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
      live_voice?: boolean
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
    resetPassword.mutate(
      { userId: person.id, signOut },
      {
        onSuccess: (answer) => {
          setConfirmReset(false)
          setResetResult(answer.starting_password)
        },
        onError: toastProblem,
      },
    )
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

          <UsernameField id={`${id}-username`} person={person} />

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

          {/* PLAN-V28 choice 16: live voice is paid by the minute, so the Platform admin turns it
              on for each person (this tab is theirs alone). Off for everyone to start. */}
          <label
            htmlFor={`${id}-live-voice`}
            className="flex items-center justify-between gap-3 text-ui"
          >
            <span className="flex flex-col">
              <span className="font-semibold">{LIVE_VOICE}</span>
              <span className="text-caption text-muted-foreground">{LIVE_VOICE_HINT}</span>
            </span>
            <Switch
              id={`${id}-live-voice`}
              checked={person.live_voice === true}
              disabled={change.isPending}
              onCheckedChange={(on) => {
                patch({ live_voice: on }, liveVoiceDone(person.name, on))
              }}
            />
          </label>

          <HubSpotUserField id={`${id}-hubspot`} person={person} taken={taken} />

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
                  Make a new starting password. It works at once.
                </span>
              </div>
              <AlertDialog
                open={confirmReset}
                onOpenChange={(next) => {
                  if (next) setSignOut(true) // on by default, each time
                  setConfirmReset(next)
                }}
              >
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
                      {resetWords(person.name, self, signOut)}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <label
                    htmlFor={`${id}-sign-out`}
                    className="flex min-h-11 items-center justify-between gap-3 text-ui"
                  >
                    <span className="font-semibold">
                      {self ? 'Sign me out everywhere' : 'Sign them out everywhere'}
                    </span>
                    <Switch
                      id={`${id}-sign-out`}
                      checked={signOut}
                      disabled={resetPassword.isPending}
                      onCheckedChange={setSignOut}
                    />
                  </label>
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
              <MadePasswordBox
                made={{
                  name: person.name,
                  login: person.username ?? person.email,
                  password: resetResult,
                }}
              />
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function PeopleTable({ people, myId }: { people: Person[]; myId: string | null }) {
  const taken = takenUsers(people)
  return (
    <Table compact aria-label="People">
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Role</TableHead>
          <TableHead className="max-md:hidden">Access</TableHead>
          <TableHead className="max-lg:hidden">{HUBSPOT_USER}</TableHead>
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
                  <LockedNote person={person} />
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
                <HubSpotUserCell person={person} />
              </TableCell>
              <TableCell className="text-muted-foreground max-sm:hidden">
                {person.last_signed_in_at ? formatRelative(person.last_signed_in_at) : 'Not yet'}
              </TableCell>
              <TableCell className="text-right">
                <span className="flex flex-wrap justify-end gap-1">
                  <Button asChild variant="ghost" size="sm">
                    <Link
                      to={`/admin/people/${person.id}`}
                      aria-label={`${person.name}'s activity`}
                    >
                      <History aria-hidden="true" />
                      Activity
                    </Link>
                  </Button>
                  <EditPerson person={person} self={self} taken={taken} />
                </span>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

/** The server's field names for the HubSpot choice, and its code for neither (PLAN-V23 T3-1). */
const HUBSPOT_FIELDS = new Set(['hubspot_owner_id', 'no_hubspot_user'])

function AddPerson({ taken }: { taken: ReadonlyMap<string, string> }) {
  const add = useAddPerson()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [position, setPosition] = useState('')
  const [role, setRole] = useState<AssignableRole>('staff')
  // PLAN-V23 choice 12: a new person needs their HubSpot user, or "No HubSpot user".
  const [hubspot, setHubspot] = useState<HubSpotChoice | null>(null)
  const [picked, setPicked] = useState<ReadonlySet<Feature>>(
    () => new Set(DEFAULT_FEATURES_BY_ROLE.staff),
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [created, setCreated] = useState<SignIn | null>(null)

  const resetForm = (): void => {
    setName('')
    setEmail('')
    setPosition('')
    setRole('staff')
    setHubspot(null)
    setPicked(new Set(DEFAULT_FEATURES_BY_ROLE.staff))
    setErrors({})
  }

  const pickHubspot = (choice: HubSpotChoice): void => {
    const wasNone = hubspot?.kind === 'none'
    const isNone = choice.kind === 'none'
    setHubspot(choice)
    setErrors((now) => {
      const next = { ...now }
      delete next.hubspot
      return next
    })
    // Into or out of "No HubSpot user", the ticks start again, as a role change does.
    if (wasNone !== isNone) setPicked(new Set(startingTicks(role, isNone)))
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
    if (hubspot === null) missing.hubspot = PICK_A_CHOICE
    setErrors(missing)
    if (Object.keys(missing).length > 0 || hubspot === null) return
    const features =
      role === 'admin' ? [...ALL_FEATURES] : ALL_FEATURES.filter((feature) => picked.has(feature))
    const trimmedPosition = position.trim()
    add.mutate(
      {
        name: name.trim(),
        email: email.trim(),
        role,
        ...(trimmedPosition ? { position: trimmedPosition } : {}),
        ...(hubspot.kind === 'none'
          ? { no_hubspot_user: true }
          : { hubspot_owner_id: hubspot.owner.id, no_hubspot_user: false }),
        features,
      },
      {
        onSuccess: (person) => {
          toast(`${person.name} can sign in now.`)
          setCreated({
            name: person.name,
            login: person.username ?? person.email,
            password: person.starting_password,
          })
          resetForm()
        },
        onError: (error) => {
          if (isApiProblem(error) && error.code === 'hubspot_choice_missing') {
            setErrors({ hubspot: PICK_A_CHOICE })
            return
          }
          if (isApiProblem(error) && error.errors.length > 0) {
            const found: Record<string, string> = {}
            for (const item of error.errors) {
              const field = item.field.replace(/^body\./, '')
              found[HUBSPOT_FIELDS.has(field) ? 'hubspot' : field] = item.message
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
              made={created}
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
                  setPicked(new Set(startingTicks(nextRole, hubspot?.kind === 'none')))
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
            <NewHubSpotUserField
              id={`${id}-hubspot`}
              name={name}
              value={hubspot}
              error={errors.hubspot}
              taken={taken}
              onPick={pickHubspot}
            />
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
            <AddPerson taken={takenUsers(people.data)} />
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
