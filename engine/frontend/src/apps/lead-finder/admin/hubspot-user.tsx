/**
 * Each person's "HubSpot user" on Admin's People tab (PLAN-V23 T3-4, choices 12 and 13): where
 * their calls and tasks land in HubSpot. It is a field, not a role.
 *
 * - **The pick list** (a combobox: Popover with Command, filtering as you type) has "No HubSpot
 *   user" first, for someone with no HubSpot login (like a designer), then HubSpot's active users,
 *   the one closest to the person's name first, marked so. A user already linked to someone else
 *   says so ("Linked to Mia Sample"): the server still allows it (**TBC**, Al-khair).
 * - **The closest name** is suggested, never picked for you: "Closest name in HubSpot: Jo Sample."
 *   with "Use Jo Sample". The first names must agree (Jo and Joanne do), then the most letter pairs
 *   in common wins, from half of them up.
 * - **Add person** needs one choice. **People's change** takes "No HubSpot user" too, and saves at
 *   once. An account from before PLAN-V23 shows "Not set" until someone picks.
 *
 * The users come with ids and names only, never an email (`GET /hubspot/owners`). The rules (the
 * choice and the closest name) are in `hubspot-choice.ts`.
 */
import { ChevronsUpDown } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { Person } from '@/api/hooks'
import { ownerOf, useHubSpotOwners, useSetHubSpotOwner } from '@/api/hooks/hubspot-owners'
import type { HubSpotOwnerLink, HubSpotOwnerOption } from '@/api/types'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toastProblem } from '@/lib/problems'
import { cn } from '@/lib/utils'
import {
  choiceOf,
  closestOwner,
  hubSpotStateOf,
  sameChoice,
  type HubSpotChoice,
} from './hubspot-choice'

// --- Words --------------------------------------------------------------------------------------

export const HUBSPOT_USER = 'HubSpot user'
export const NO_HUBSPOT_USER = 'No HubSpot user'
export const NOT_SET = 'Not set'
const PICK_ONE = 'Pick their HubSpot user'
const NO_USER_HINT = 'For someone with no HubSpot login'
const CLOSEST_MARK = 'Closest to the name'
const FIND_LABEL = 'Find their HubSpot user'
const FIND_PLACEHOLDER = 'Find a HubSpot user'
const NO_SUCH_USER = 'No HubSpot user by that name.'
const USERS_LOADING = 'Loading the HubSpot users.'
const USERS_FAILED = "The HubSpot users couldn't be loaded."
const USERS_EMPTY = 'No HubSpot users to pick from yet.'
const TRY_AGAIN = 'Try again'

/** What the field means, under it. */
const LINKED_LINE = 'Their calls and tasks land under this user in HubSpot.'
const NONE_LINE =
  'Their calls go to HubSpot with no owner, signed with their name. They get no HubSpot tasks.'
/** A new person with no choice yet (PLAN-V23 choice 12: one is needed), and "Not set"'s line. */
export const PICK_A_CHOICE = 'Pick their HubSpot user, or No HubSpot user.'
/** Choice 13: someone with no HubSpot user starts with the Call logs tick only. */
export const NONE_TICKS_LINE =
  'They start with the Call logs tick. Tick Meetings if they write pre-reads.'

function closestWords(name: string): string {
  return `Closest name in HubSpot: ${name}.`
}

function takeWords(name: string): string {
  return `Use ${name}`
}

function linkedToWords(name: string): string {
  return `Linked to ${name}`
}

/** How a person's link was made, in words, or null when the server doesn't say. */
function howFound(owner: HubSpotOwnerLink): string | null {
  if (owner.matched_by === 'email') return 'Matched by email'
  if (owner.matched_by === 'person') return 'Set by hand'
  return null
}

// --- The table ------------------------------------------------------------------------------------

/** The HubSpot user in the People table: the name and how it was found, or the mark. */
export function HubSpotUserCell({ person }: { person: Person }) {
  const owner = ownerOf(person)
  if (owner) {
    const how = howFound(owner)
    return (
      <span className="flex flex-col">
        <span>{owner.name}</span>
        {how ? <span className="text-caption text-muted-foreground">{how}</span> : null}
      </span>
    )
  }
  return (
    <span className="text-muted-foreground">
      {hubSpotStateOf(person) === 'none' ? NO_HUBSPOT_USER : NOT_SET}
    </span>
  )
}

// --- The pick list --------------------------------------------------------------------------------

interface PickerProps {
  id: string
  value: HubSpotChoice | null
  /** What the trigger says while nothing is picked. */
  empty: string
  onPick: (choice: HubSpotChoice) => void
  /** The person's name, for the closest user. */
  name: string
  /** Users linked to someone else: their id and that person's name. */
  taken: ReadonlyMap<string, string>
  disabled?: boolean
  invalid?: boolean
  describedBy?: string
}

/** The trigger and its list. The closest user comes first after "No HubSpot user". */
function HubSpotUserPicker({
  id,
  value,
  empty,
  onPick,
  name,
  taken,
  disabled = false,
  invalid = false,
  describedBy,
}: PickerProps) {
  const [open, setOpen] = useState(false)
  const owners = useHubSpotOwners()
  const list = owners.data ?? []
  const closest = closestOwner(name, list, new Set(taken.keys()))
  const ordered = closest ? [closest, ...list.filter((owner) => owner.id !== closest.id)] : list
  const shown = value === null ? empty : value.kind === 'none' ? NO_HUBSPOT_USER : value.owner.name

  const pick = (choice: HubSpotChoice): void => {
    setOpen(false)
    onPick(choice)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          className="w-full justify-between font-normal touch:h-11"
        >
          <span className={cn('truncate', value === null && 'text-muted-foreground')}>{shown}</span>
          <ChevronsUpDown aria-hidden="true" className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) gap-0 p-0">
        <Command label={FIND_LABEL}>
          <CommandInput placeholder={FIND_PLACEHOLDER} className="touch:text-body" />
          <CommandList>
            <CommandEmpty>{NO_SUCH_USER}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="none"
                keywords={[NO_HUBSPOT_USER, 'none', 'designer']}
                data-checked={value?.kind === 'none'}
                onSelect={() => {
                  pick({ kind: 'none' })
                }}
              >
                <span className="flex min-w-0 flex-col">
                  <span>{NO_HUBSPOT_USER}</span>
                  <span className="text-caption text-muted-foreground">{NO_USER_HINT}</span>
                </span>
              </CommandItem>
              {ordered.map((owner) => {
                const linkedTo = taken.get(owner.id)
                const mark =
                  owner.id === closest?.id
                    ? CLOSEST_MARK
                    : linkedTo
                      ? linkedToWords(linkedTo)
                      : null
                return (
                  <CommandItem
                    key={owner.id}
                    value={owner.id}
                    keywords={[owner.name]}
                    data-checked={value?.kind === 'user' && value.owner.id === owner.id}
                    onSelect={() => {
                      pick({ kind: 'user', owner })
                    }}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{owner.name}</span>
                      {mark ? (
                        <span className="text-caption text-muted-foreground">{mark}</span>
                      ) : null}
                    </span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {owners.isPending ? (
              <p role="status" className="px-3 pb-3 text-ui text-muted-foreground">
                {USERS_LOADING}
              </p>
            ) : owners.isError ? (
              <div role="alert" className="flex flex-col items-start gap-2 px-3 pb-3 text-ui">
                <p>{USERS_FAILED}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void owners.refetch()}
                >
                  {TRY_AGAIN}
                </Button>
              </div>
            ) : list.length === 0 ? (
              <p className="px-3 pb-3 text-ui text-muted-foreground">{USERS_EMPTY}</p>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** "Closest name in HubSpot: Jo Sample." and "Use Jo Sample", while nothing is picked. */
function Closest({
  name,
  taken,
  onUse,
  disabled = false,
}: {
  name: string
  taken: ReadonlyMap<string, string>
  onUse: (owner: HubSpotOwnerOption) => void
  disabled?: boolean
}) {
  const owners = useHubSpotOwners()
  const closest = closestOwner(name, owners.data ?? [], new Set(taken.keys()))
  if (!closest) return null
  return (
    <div
      data-slot="closest-user"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground"
    >
      <span>{closestWords(closest.name)}</span>
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="touch:h-11"
        disabled={disabled}
        onClick={() => {
          onUse(closest)
        }}
      >
        {takeWords(closest.name)}
      </Button>
    </div>
  )
}

// --- Add person -----------------------------------------------------------------------------------

/** Add person's field: one choice is needed, and nothing is saved until the person is added. */
export function NewHubSpotUserField({
  id,
  name,
  value,
  error,
  taken,
  onPick,
}: {
  id: string
  name: string
  value: HubSpotChoice | null
  error: string | undefined
  taken: ReadonlyMap<string, string>
  onPick: (choice: HubSpotChoice) => void
}) {
  const lineId = `${id}-line`
  return (
    <Field>
      <FieldLabel htmlFor={id}>{HUBSPOT_USER}</FieldLabel>
      <HubSpotUserPicker
        id={id}
        value={value}
        empty={PICK_ONE}
        name={name}
        taken={taken}
        invalid={Boolean(error)}
        describedBy={lineId}
        onPick={onPick}
      />
      <FieldDescription id={lineId}>
        {value?.kind === 'none' ? `${NONE_LINE} ${NONE_TICKS_LINE}` : LINKED_LINE}
      </FieldDescription>
      {error ? <FieldError>{error}</FieldError> : null}
      {value === null ? (
        <Closest
          name={name}
          taken={taken}
          onUse={(owner) => {
            onPick({ kind: 'user', owner })
          }}
        />
      ) : null}
    </Field>
  )
}

// --- People's change ------------------------------------------------------------------------------

/** People's field for one person: it saves at once, with a toast. */
export function HubSpotUserField({
  id,
  person,
  taken,
}: {
  id: string
  person: Person
  taken: ReadonlyMap<string, string>
}) {
  const setOwner = useSetHubSpotOwner()
  const saved = choiceOf(person)
  const saving: HubSpotChoice | null | undefined = setOwner.isPending
    ? setOwner.variables.owner
      ? { kind: 'user', owner: setOwner.variables.owner }
      : { kind: 'none' }
    : undefined
  const shown = saving ?? saved
  const owner = ownerOf(person)
  const how = saving === undefined && owner ? howFound(owner) : null
  const lineId = `${id}-line`
  const others = new Map([...taken].filter(([ownerId]) => ownerId !== owner?.id))

  const pick = (choice: HubSpotChoice): void => {
    if (sameChoice(choice, saved)) return
    setOwner.mutate(
      choice.kind === 'none'
        ? { userId: person.id, owner: null, noHubSpotUser: true }
        : { userId: person.id, owner: choice.owner },
      {
        onSuccess: () => {
          toast(
            choice.kind === 'none'
              ? `${person.name} has no HubSpot user now.`
              : `${person.name}'s HubSpot user is ${choice.owner.name} now.`,
          )
        },
        onError: toastProblem,
      },
    )
  }

  const line =
    shown === null
      ? PICK_A_CHOICE
      : shown.kind === 'none'
        ? NONE_LINE
        : how
          ? `${how}. ${LINKED_LINE}`
          : LINKED_LINE

  return (
    <Field>
      <FieldLabel htmlFor={id}>{HUBSPOT_USER}</FieldLabel>
      <HubSpotUserPicker
        id={id}
        value={shown}
        empty={NOT_SET}
        name={person.name}
        taken={others}
        disabled={setOwner.isPending}
        describedBy={lineId}
        onPick={pick}
      />
      <FieldDescription id={lineId}>{line}</FieldDescription>
      {shown === null ? (
        <Closest
          name={person.name}
          taken={others}
          disabled={setOwner.isPending}
          onUse={(found) => {
            pick({ kind: 'user', owner: found })
          }}
        />
      ) : null}
    </Field>
  )
}
