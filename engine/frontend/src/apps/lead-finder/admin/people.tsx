/**
 * Admin, People (PLAN-V9 E1): who has an account, and which projects each may use. One tick per
 * project (from src/modules.ts, so a new project gets its tick by itself): "Lead Finder" and, since
 * PLAN-V10, "Companies". An Admin may use everything. Adding a person needs a starting
 * password under today's rules: give it to them in person, not by email. Changing your own
 * password is PLAN-V6 C4, still to come; a forgotten one is reset with `engine reset-password`.
 */
import { UserPlus } from 'lucide-react'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { useAddPerson, useChangePerson, useMe, usePeople, type Person } from '@/api/hooks'
import { isApiProblem } from '@/api/client'
import { ErrorState } from '@/components/error-state'
import { PendingCards } from '@/components/skeletons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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

function PersonRow({ person, self }: { person: Person; self: boolean }) {
  return (
    <li className="flex flex-col gap-2 border-b py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{person.name}</span>
          <Badge variant="outline">{roleName(person.role)}</Badge>
          {!person.active ? <Badge variant="outline">Can&apos;t sign in</Badge> : null}
          {self ? <span className="text-caption text-muted-foreground">You</span> : null}
        </span>
        <span className="text-caption break-all text-muted-foreground">{person.email}</span>
        <span className="text-caption text-muted-foreground">
          {person.last_signed_in_at
            ? `Last signed in ${formatRelative(person.last_signed_in_at)}`
            : 'Has not signed in yet'}
        </span>
      </div>
      <ProjectTicks person={person} self={self} />
    </li>
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
    <Card>
      <CardHeader>
        <CardTitle className="text-section font-semibold">Add a person</CardTitle>
        <CardDescription>
          They sign in with this email and the starting password. The password follows the same
          rules as every password: 14 characters or more; a few words in a row is fine.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-2"
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
          <div className="flex flex-col gap-2 sm:col-span-2">
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
          <div className="sm:col-span-2">
            <Button type="submit" disabled={add.isPending}>
              <UserPlus aria-hidden="true" />
              {add.isPending ? 'Adding.' : 'Add the person'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
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
            Tick a project to open it to a person. Without the tick it isn&apos;t in their menu, and
            its pages answer &quot;Not open to you&quot;.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {people.data.length === 0 ? (
            <p className="text-ui text-muted-foreground">
              Nobody has an account yet. Sign-in is off on this backend.
            </p>
          ) : (
            <ul aria-label="People">
              {people.data.map((person) => (
                <PersonRow key={person.id} person={person} self={person.id === myId} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <AddPerson />
    </div>
  )
}
