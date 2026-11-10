/**
 * Admin, People (PLAN-V9 E1, shorter in PLAN-V13 T1-9): who has an account, and which projects each
 * may use. A table with each person's role as a word and an icon; "Edit" opens a side sheet with
 * the project ticks, the role and whether they can sign in, and "Add a person" opens one with the
 * form. One tick per
 * project (from src/modules.ts, so a new project gets its tick by itself): "Lead Finder" and, since
 * PLAN-V10, "Companies". An Admin may use everything. Adding a person needs a starting
 * password under today's rules: give it to them in person, not by email. Changing your own
 * password is PLAN-V6 C4, still to come; a forgotten one is reset with `engine reset-password`.
 */
import { Eye, Pencil, ShieldCheck, UserPlus, UserRound } from 'lucide-react'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { useAddPerson, useChangePerson, useMe, usePeople, type Person } from '@/api/hooks'
import { isApiProblem } from '@/api/client'
import { ErrorState } from '@/components/error-state'
import { PendingCards } from '@/components/skeletons'
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
import { formatRelative } from '@/lib/format'
import { toastProblem } from '@/lib/problems'
import { MODULES } from '@/modules'
import { ROLE_NAMES, roleName } from '@/shell/roles'

const LEAD_FINDER = 'lead_finder'

interface Project {
  /** The backend's name, like "lead_finder". */
  app: string
  /** Its name on the tick, like "Lead Finder". */
  name: string
  /** In a sentence, like "the Lead Finder". */
  phrase: string
}

const PHRASES: Record<string, string> = {
  lead_finder: 'the Lead Finder',
  companies: 'the Companies page',
}

/** Every project that has a tick, in menu order. */
const PROJECTS: readonly Project[] = MODULES.flatMap((module) =>
  module.app
    ? [{ app: module.app, name: module.name, phrase: PHRASES[module.app] ?? module.name }]
    : [],
)
const ROLES = [
  { id: 'staff', label: ROLE_NAMES.staff },
  { id: 'admin', label: ROLE_NAMES.admin },
  { id: 'viewer', label: ROLE_NAMES.viewer },
] as const
type Role = (typeof ROLES)[number]['id']

function ProjectTick({ person, project }: { person: Person; project: Project }) {
  const change = useChangePerson()
  const id = useId()
  const admin = person.role === 'admin'
  const ticked = admin || person.apps.includes(project.app)
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-ui">
      <Checkbox
        id={id}
        checked={ticked}
        disabled={admin || change.isPending}
        onCheckedChange={(next) => {
          const apps = next
            ? [...person.apps.filter((app) => app !== project.app), project.app]
            : person.apps.filter((app) => app !== project.app)
          change.mutate(
            { userId: person.id, patch: { apps } },
            {
              onSuccess: () => {
                toast(
                  next
                    ? `${person.name} can use ${project.phrase}.`
                    : `${project.name} closed to ${person.name}.`,
                )
              },
              onError: toastProblem,
            },
          )
        }}
      />
      {project.name}
    </label>
  )
}

function ProjectTicks({ person, self }: { person: Person; self: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {PROJECTS.map((project) => (
        <ProjectTick key={project.app} person={person} project={project} />
      ))}
      {person.role === 'admin' ? (
        <span className="text-caption text-muted-foreground">
          {self ? '(you are a System admin)' : '(a System admin has every project)'}
        </span>
      ) : null}
    </div>
  )
}

const ROLE_ICONS = { admin: ShieldCheck, staff: UserRound, viewer: Eye } as const

function RoleBadge({ role }: { role: string }) {
  const Icon = ROLE_ICONS[role as Role] ?? UserRound
  return (
    <Badge variant="outline">
      <Icon aria-hidden="true" />
      {roleName(role)}
    </Badge>
  )
}

/** The projects a person may use, in words. */
function projectsOf(person: Person): string {
  if (person.role === 'admin') return 'Every project'
  const names = PROJECTS.filter((project) => person.apps.includes(project.app)).map(
    (project) => project.name,
  )
  return names.length > 0 ? names.join(', ') : 'None yet'
}

/** Edits to one person, applied at once as before: the ticks, the role, and signing in. */
function EditPerson({ person, self }: { person: Person; self: boolean }) {
  const change = useChangePerson()
  const id = useId()
  const patch = (body: { role?: Role; active?: boolean }, done: string) => {
    change.mutate(
      { userId: person.id, patch: body },
      {
        onSuccess: () => {
          toast(done)
        },
        onError: toastProblem,
      },
    )
  }
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label={`Edit ${person.name}`}>
          <Pencil aria-hidden="true" />
          Edit
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col gap-6">
        <SheetHeader>
          <SheetTitle>{person.name}</SheetTitle>
          <SheetDescription>{person.email}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-4">
          <Field>
            <FieldLabel htmlFor={`${id}-role`}>Role</FieldLabel>
            <Select
              value={person.role}
              disabled={self || change.isPending}
              onValueChange={(value) => {
                patch({ role: value as Role }, `${person.name} is ${roleName(value)} now.`)
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
            {self ? <FieldDescription>You can't change your own role.</FieldDescription> : null}
          </Field>
          <div className="flex flex-col gap-2">
            <span className="text-ui font-semibold">Projects</span>
            <ProjectTicks person={person} self={self} />
          </div>
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
              disabled={self || change.isPending}
              onCheckedChange={(on) => {
                patch(
                  { active: on },
                  on ? `${person.name} can sign in again.` : `${person.name} can't sign in now.`,
                )
              }}
            />
          </label>
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
          <TableHead className="max-md:hidden">Projects</TableHead>
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
              <TableCell className="max-md:hidden">{projectsOf(person)}</TableCell>
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
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('staff')
  // The Lead Finder starts ticked, as before. Who gets the Companies tick is TBC with Levi.
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set([LEAD_FINDER]))
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = (): void => {
    const missing: Record<string, string> = {}
    if (name.trim() === '') missing.name = 'Give a name.'
    if (email.trim() === '') missing.email = 'Give an email.'
    if (password === '') missing.password = 'Give a starting password.'
    setErrors(missing)
    if (Object.keys(missing).length > 0) return
    add.mutate(
      {
        name: name.trim(),
        email: email.trim(),
        role,
        apps:
          role === 'admin' ? [] : PROJECTS.map((item) => item.app).filter((app) => picked.has(app)),
        password,
      },
      {
        onSuccess: (person) => {
          toast(`${person.name} can sign in now. Give them the password in person.`)
          setName('')
          setEmail('')
          setPassword('')
          setErrors({})
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

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" size="sm">
          <UserPlus aria-hidden="true" />
          Add a person
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col gap-4 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add a person</SheetTitle>
          <SheetDescription>
            They sign in with this email and a starting password of 14 characters or more. Give it
            to them in person.
          </SheetDescription>
        </SheetHeader>
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
            <FieldLabel htmlFor={`${id}-role`}>Role</FieldLabel>
            <Select
              value={role}
              onValueChange={(value) => {
                setRole(value as Role)
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
          <Field>
            <FieldLabel htmlFor={`${id}-password`}>Starting password</FieldLabel>
            <Input
              id={`${id}-password`}
              type="password"
              value={password}
              autoComplete="new-password"
              aria-invalid={errors.password ? true : undefined}
              onChange={(event) => {
                setPassword(event.target.value)
              }}
            />
            {errors.password ? <FieldError>{errors.password}</FieldError> : null}
          </Field>
          <div className="flex flex-col gap-2">
            {PROJECTS.map((project) => (
              <label
                key={project.app}
                htmlFor={`${id}-${project.app}`}
                className="flex items-center gap-2 text-ui"
              >
                <Checkbox
                  id={`${id}-${project.app}`}
                  checked={picked.has(project.app) || role === 'admin'}
                  disabled={role === 'admin'}
                  onCheckedChange={(next) => {
                    const changed = new Set(picked)
                    if (next === true) changed.add(project.app)
                    else changed.delete(project.app)
                    setPicked(changed)
                  }}
                />
                Can use {project.phrase}
              </label>
            ))}
            {errors.apps ? <span className="text-ui text-destructive">{errors.apps}</span> : null}
          </div>
          <div>
            <Button type="submit" disabled={add.isPending}>
              <UserPlus aria-hidden="true" />
              {add.isPending ? 'Adding.' : 'Add the person'}
            </Button>
          </div>
        </form>
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
          <CardDescription>A project closed to someone isn&apos;t in their menu.</CardDescription>
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
